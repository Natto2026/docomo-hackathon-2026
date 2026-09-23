import 'dart:async';
import 'dart:typed_data';
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:image_picker/image_picker.dart';
import '../models/place.dart';
import '../services/api_client.dart';
import '../services/browser_places.dart';
import '../services/location_service.dart';
import '../widgets/location_icon.dart';

class CreatePostScreen extends StatefulWidget {
  const CreatePostScreen({super.key, required this.onCreated, this.initialPlace});
  final VoidCallback onCreated;
  /// 地図の店アイコンから開いたときの店。指定されていればその店を選んだ状態で始める。
  final NearbyPlace? initialPlace;
  @override State<CreatePostScreen> createState() => _CreatePostScreenState();
}

class _CreatePostScreenState extends State<CreatePostScreen> {
  /// この距離以内に施設があれば「その店にいる」とみなして自動で選ぶ。
  static const autoSelectMeters = 60;
  /// 候補は近い順にこの件数だけ出す。
  static const maxCandidates = 3;

  final bodyController = TextEditingController();
  final categoryController = TextEditingController();
  final placeNameController = TextEditingController();
  final api = ApiClient();
  final location = LocationService();
  XFile? image;
  Uint8List? imageBytes;
  bool loading = false;
  bool locating = true;
  String postType = 'normal';
  String? error;
  LatLng? postLocation;

  /// 投稿場所の周辺にある施設の候補と、その中で選んだもの。
  List<NearbyPlace> places = [];
  NearbyPlace? selectedPlace;
  bool placesLoading = false;
  bool placesSearched = false;
  /// 候補の取得自体に失敗した(近くに無いのとは区別して再試行を出す)
  bool placesFailed = false;
  /// 候補の出どころ(google / osm)。表示用。
  String placesSource = '';
  /// 地図の店アイコンを押したときに何を検出したかの説明(表示用)。
  String? poiStatus;
  /// 「場所の名前」に入力した文字での場所検索。
  Timer? searchDebounce;
  List<NearbyPlace> searchResults = [];
  bool searching = false;
  /// 現在地(白縁の青い丸で常に表示。投稿場所のピンとは別)。
  LatLng? myLocation;
  BitmapDescriptor? locationIcon;

  @override
  void initState() {
    super.initState();
    LocationIcon.get().then((icon) { if (mounted) setState(() => locationIcon = icon); }).catchError((_) {});
    final preset = widget.initialPlace;
    if (preset != null) {
      // 店が決まっているので現在地は取らず、その店を選んだ状態で開く
      locating = false;
      places = [preset];
      placesSearched = true;
      placesSource = preset.id.startsWith('osm-') || preset.id.startsWith('nominatim-') ? 'osm' : 'google';
      selectPlace(preset);
      loadPlaces(LatLng(preset.latitude, preset.longitude));
      // 現在地の青ピンは別途取得する(失敗しても投稿には影響しない)
      location.current().then((point) { if (mounted) setState(() => myLocation = LatLng(point.latitude, point.longitude)); }).catchError((_) {});
    } else {
      loadLocation();
    }
  }

  /// 「場所の名前」の入力で場所を検索する(入力が止まって 0.5 秒後)。
  void onPlaceNameChanged(String value) {
    final chosen = selectedPlace;
    if (chosen != null && value.trim() != chosen.name) setState(() => selectedPlace = null);
    searchDebounce?.cancel();
    final query = value.trim();
    if (query.length < 2 || postLocation == null || (chosen != null && query == chosen.name)) {
      if (searchResults.isNotEmpty) setState(() => searchResults = []);
      return;
    }
    searchDebounce = Timer(const Duration(milliseconds: 500), () => searchByName(query));
  }

  Future<void> searchByName(String query) async {
    final point = postLocation;
    if (point == null) return;
    setState(() => searching = true);
    try {
      final result = await api.searchPlaces(query: query, latitude: point.latitude, longitude: point.longitude);
      if (mounted && placeNameController.text.trim() == query) setState(() => searchResults = result.places.take(5).toList());
    } catch (_) {
      if (mounted) setState(() => searchResults = []);
    } finally {
      if (mounted) setState(() => searching = false);
    }
  }

  /// 検索結果から店を選ぶ。ピンをその店へ移し、周辺候補も更新する。
  void pickSearchResult(NearbyPlace place) {
    setState(() {
      selectPlace(place);
      searchResults = [];
      placesSource = place.id.startsWith('osm-') || place.id.startsWith('nominatim-') ? 'osm' : 'google';
      poiStatus = '検索した「${place.name}」を投稿場所にしました';
    });
    loadPlaces(LatLng(place.latitude, place.longitude));
  }

  @override
  void dispose() {
    searchDebounce?.cancel();
    bodyController.dispose();
    categoryController.dispose();
    placeNameController.dispose();
    super.dispose();
  }

  Future<void> loadLocation() async {
    setState(() => locating = true);
    try {
      final point = await location.current();
      if (!mounted) return;
      final current = LatLng(point.latitude, point.longitude);
      setState(() { postLocation = current; myLocation = current; selectedPlace = null; });
      await loadPlaces(current);
    } catch (_) {
      if (mounted) setState(() => error = '現在地を取得できませんでした');
    } finally {
      if (mounted) setState(() => locating = false);
    }
  }

  /// 指定地点の周辺にある店・施設を取得し、すぐ近く(60m 以内)なら自動で投稿場所にする。
  /// まず地図と同じ Google のデータ(ブラウザ側)を試し、使えなければバックエンド(OpenStreetMap)に切り替える。
  Future<void> loadPlaces(LatLng point) async {
    setState(() { placesLoading = true; placesFailed = false; });
    try {
      var found = await searchBrowserPlaces(latitude: point.latitude, longitude: point.longitude, max: maxCandidates);
      var source = 'google';
      if (found == null) {
        final result = await api.fetchNearbyPlaces(latitude: point.latitude, longitude: point.longitude);
        found = result.places;
        source = result.provider;
      }
      if (!mounted) return;
      final all = found; // closure 内で使うため、null でないことが確定した変数に写す
      final chosen = selectedPlace;
      final nearest3 = all.take(maxCandidates).toList();
      // 店アイコンから開いた店は候補に無くても先頭に残す
      if (chosen != null && !nearest3.any((place) => place.id == chosen.id)) nearest3.insert(0, chosen);
      setState(() {
        places = nearest3.take(maxCandidates + 1).toList();
        placesSource = source;
        placesSearched = true;
        final nearest = all.isNotEmpty ? all.first : null;
        if (chosen == null && nearest != null && nearest.distanceMeters <= autoSelectMeters && placeNameController.text.trim().isEmpty) {
          selectPlace(nearest);
        }
      });
    } catch (_) {
      if (mounted) {
        setState(() {
          // 検索に失敗しても、店アイコンから指定された店は候補に残す
          final chosen = selectedPlace;
          places = chosen != null ? [chosen] : [];
          placesSearched = true;
          placesFailed = true;
        });
      }
    } finally {
      if (mounted) setState(() => placesLoading = false);
    }
  }

  /// 施設を選ぶ(null で解除)。選ぶと場所名を埋め、ピンも施設の位置へ移す。
  void selectPlace(NearbyPlace? place) {
    selectedPlace = place;
    placeNameController.text = place?.name ?? '';
    if (place != null) postLocation = LatLng(place.latitude, place.longitude);
  }

  /// 地図をタップ / ピンを動かしたとき。施設の選択を解除し、新しい地点の周辺を探し直す。
  /// 地図上の店アイコンを押していた場合は、Google の店カードに出た店名・住所をそのまま採用する。
  Future<void> movePostLocation(LatLng value) async {
    setState(() {
      postLocation = value;
      selectedPlace = null;
      placeNameController.clear();
      poiStatus = null;
    });
    final tapped = await waitForTappedPoi(value);
    if (!mounted) return;
    if (tapped != null) {
      setState(() {
        selectPlace(tapped);
        placesSource = 'google';
      });
    }
    await loadPlaces(tapped != null ? LatLng(tapped.latitude, tapped.longitude) : value);
  }

  /// 店アイコンが押されていれば、Google の店カードが描画されて店名が読めるまで(最大 3 秒)待つ。
  /// 読めなかった場合は座標から店名・住所を逆引きして代わりにする。
  Future<NearbyPlace?> waitForTappedPoi(LatLng tapPoint) async {
    // Google の店カードは押した少し後に描画されるので、最大 3 秒待ちながら読み取る
    PoiClick? click;
    for (var attempt = 0; attempt < 20; attempt++) {
      click = readPoiClick(fallbackLatitude: tapPoint.latitude, fallbackLongitude: tapPoint.longitude);
      if (click != null && click.name != null) break;
      await Future<void>.delayed(const Duration(milliseconds: 150));
      if (!mounted) return null;
    }
    clearPoiClick();
    if (click == null) return null;
    final fromCard = click.toPlace();
    if (fromCard != null) {
      if (mounted) setState(() => poiStatus = '地図の店「${fromCard.name}」を投稿場所にしました');
      return fromCard;
    }
    // Google のカードから読み取れなかった: 座標から逆引き
    try {
      final resolved = await api.fetchPlaceAt(latitude: click.latitude, longitude: click.longitude);
      final name = resolved.name ?? '地図上の店・施設';
      if (mounted) setState(() => poiStatus = '店カードの文字を読み取れなかったため、座標から「$name」を採用しました。違う場合は名前を直してください');
      return NearbyPlace(id: click.placeId, name: name, address: resolved.address, latitude: click.latitude, longitude: click.longitude, distanceMeters: 0);
    } catch (_) {
      if (mounted) setState(() => poiStatus = '店アイコンは押されましたが店名を取得できませんでした。名前を手入力してください');
      return null;
    }
  }

  Future<void> pick(ImageSource source) async {
    final picked = await ImagePicker().pickImage(source: source);
    if (picked != null) {
      final bytes = await picked.readAsBytes();
      if (mounted) setState(() { image = picked; imageBytes = bytes; });
    }
  }

  Future<void> submit() async {
    final body = bodyController.text.trim();
    if (body.isEmpty || body.length > 500) { setState(() => error = '本文は1〜500文字で入力してください'); return; }
    final point = postLocation;
    if (point == null) { setState(() => error = '投稿場所を取得できませんでした'); return; }
    final placeName = placeNameController.text.trim();
    // 候補から選んだ施設の名前がそのまま残っている場合だけ、施設ID と住所も送る
    final fromCandidate = selectedPlace != null && selectedPlace!.name == placeName ? selectedPlace : null;
    setState(() { loading = true; error = null; });
    try {
      await api.createPost(
        body: body,
        latitude: point.latitude,
        longitude: point.longitude,
        image: image,
        category: categoryController.text,
        postType: postType,
        placeName: placeName,
        placeId: fromCandidate?.id,
        placeAddress: fromCandidate?.address,
        placeType: fromCandidate?.primaryType,
      );
      if (!mounted) return;
      // 画面は閉じない(戻るかどうかは利用者に任せる)。メッセージを出して入力欄だけ空にする
      widget.onCreated();
      resetForm();
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('投稿しました'), duration: Duration(seconds: 2)));
    } catch (e) { if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', '')); }
    finally { if (mounted) setState(() => loading = false); }
  }

  /// 投稿後に本文・カテゴリ・画像・場所名を空に戻す。位置と施設候補はそのまま残す。
  void resetForm() {
    bodyController.clear();
    categoryController.clear();
    placeNameController.clear();
    setState(() {
      image = null;
      imageBytes = null;
      postType = 'normal';
      selectedPlace = null;
      error = null;
    });
  }

  Widget _placePicker(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      if (poiStatus != null)
        Padding(
          padding: const EdgeInsets.only(bottom: 6),
          child: Text(poiStatus!, style: small?.copyWith(color: Theme.of(context).colorScheme.primary)),
        ),
      if (placesLoading)
        Padding(
          padding: const EdgeInsets.only(bottom: 8),
          child: Row(children: [
            const SizedBox(width: 14, height: 14, child: CircularProgressIndicator(strokeWidth: 2)),
            const SizedBox(width: 8),
            Text('周辺の店・施設を探しています...', style: small),
          ]),
        ),
      if (places.isNotEmpty) ...[
        Text('この場所の店・施設(近い順${places.length}件${placesSource == 'google' ? '・Google マップ' : placesSource == 'osm' ? '・OpenStreetMap' : ''})', style: small),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: [
            ChoiceChip(
              label: const Text('指定しない'),
              selected: selectedPlace == null,
              onSelected: (_) => setState(() => selectPlace(null)),
            ),
            ...places.map((place) => ChoiceChip(
                  avatar: const Icon(Icons.place_outlined, size: 16),
                  label: Text('${place.name}(${place.distanceLabel}${place.typeLabel != null ? '・${place.typeLabel}' : ''})', overflow: TextOverflow.ellipsis),
                  selected: selectedPlace?.id == place.id,
                  onSelected: (_) => setState(() => selectPlace(place)),
                )),
          ],
        ),
        const SizedBox(height: 8),
      ],
      TextField(
        controller: placeNameController,
        decoration: InputDecoration(
          labelText: '場所の名前(任意)',
          hintText: '店名を入力すると周辺から検索します',
          border: const OutlineInputBorder(),
          prefixIcon: const Icon(Icons.storefront_outlined),
          suffixIcon: searching
              ? const Padding(padding: EdgeInsets.all(12), child: SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2)))
              : IconButton(tooltip: 'この名前で検索', icon: const Icon(Icons.search), onPressed: () { final q = placeNameController.text.trim(); if (q.length >= 2) searchByName(q); }),
        ),
        onChanged: onPlaceNameChanged,
        onSubmitted: (value) { final q = value.trim(); if (q.length >= 2) searchByName(q); },
      ),
      if (searchResults.isNotEmpty) ...[
        const SizedBox(height: 6),
        Text('検索結果(近い順)', style: small),
        const SizedBox(height: 4),
        Wrap(
          spacing: 6,
          runSpacing: 4,
          children: searchResults.map((place) => ActionChip(
                avatar: const Icon(Icons.search, size: 16),
                label: Text('${place.name}(${place.distanceLabel}${place.typeLabel != null ? '・${place.typeLabel}' : ''})', overflow: TextOverflow.ellipsis),
                onPressed: () => pickSearchResult(place),
              )).toList(),
        ),
      ],
      if (placesFailed && !placesLoading)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Row(children: [
            Expanded(child: Text('店・施設の候補を取得できませんでした(地図サービスが混雑中)。名前は手入力できます', style: small?.copyWith(color: Colors.red))),
            TextButton.icon(
              onPressed: postLocation == null ? null : () => loadPlaces(postLocation!),
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('再試行'),
            ),
          ]),
        )
      else if (placesSearched && !placesLoading && places.isEmpty)
        Padding(
          padding: const EdgeInsets.only(top: 4),
          child: Text('この地点の近くに登録された店・施設は見つかりませんでした。名前は手入力できます', style: small),
        ),
    ]);
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(title: const Text('投稿する')),
    body: ListView(padding: const EdgeInsets.all(16), children: [
      TextField(controller: bodyController, maxLength: 500, maxLines: 5, decoration: const InputDecoration(labelText: 'いま見つけたこと', border: OutlineInputBorder())),
      const SizedBox(height: 12),
      TextField(controller: categoryController, decoration: const InputDecoration(labelText: 'カテゴリ（任意・例：カフェ）', border: OutlineInputBorder())),
      const SizedBox(height: 12),
      Row(children: [
        const Text('投稿タイプ', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(width: 12),
        Expanded(
          child: SegmentedButton<String>(
            segments: const [
              ButtonSegment(value: 'normal', label: Text('通常'), icon: Icon(Icons.article_outlined)),
              ButtonSegment(value: 'realtime', label: Text('リアルタイム'), icon: Icon(Icons.bolt)),
            ],
            selected: {postType},
            onSelectionChanged: (value) => setState(() => postType = value.first),
          ),
        ),
      ]),
      const SizedBox(height: 12),
      if (imageBytes != null)
        Container(
          constraints: const BoxConstraints(maxHeight: 320),
          width: double.infinity,
          color: Colors.black12,
          child: Image.memory(imageBytes!, fit: BoxFit.contain),
        ),
      Row(children: [
        Expanded(child: OutlinedButton.icon(onPressed: () => pick(ImageSource.camera), icon: const Icon(Icons.camera_alt), label: const Text('カメラ'))),
        const SizedBox(width: 8),
        Expanded(child: OutlinedButton.icon(onPressed: () => pick(ImageSource.gallery), icon: const Icon(Icons.photo), label: const Text('ギャラリー'))),
      ]),
      const SizedBox(height: 20),
      Row(children: [
        const Text('投稿場所', style: TextStyle(fontWeight: FontWeight.bold)),
        const Spacer(),
        TextButton.icon(onPressed: locating ? null : loadLocation, icon: const Icon(Icons.my_location), label: const Text('現在地を再取得')),
      ]),
      Text('地図の店アイコンを押すと、その店が投稿場所になります', style: Theme.of(context).textTheme.bodySmall),
      const SizedBox(height: 8),
      _placePicker(context),
      const SizedBox(height: 8),
      SizedBox(
        height: 220,
        child: Stack(children: [
          if (postLocation != null)
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: postLocation!, zoom: 15),
                markers: {
                  // 現在地は青いピンで常に表示(投稿場所とは別)
                  if (myLocation != null)
                    Marker(
                      markerId: const MarkerId('my-location'),
                      position: myLocation!,
                      icon: locationIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
                      anchor: const Offset(0.5, 0.5),
                      infoWindow: const InfoWindow(title: '現在地'),
                      zIndexInt: 100,
                    ),
                  Marker(
                    markerId: const MarkerId('post-location'),
                    position: postLocation!,
                    draggable: true,
                    infoWindow: selectedPlace != null ? InfoWindow(title: selectedPlace!.name) : const InfoWindow(title: '投稿場所'),
                    onDragEnd: movePostLocation,
                    zIndexInt: 2,
                  ),
                },
                onTap: movePostLocation,
                myLocationEnabled: true,
                zoomControlsEnabled: false,
              ),
            ),
          if (locating) const Center(child: CircularProgressIndicator()),
        ]),
      ),
      if (postLocation != null)
        Padding(
          padding: const EdgeInsets.only(top: 6),
          child: Text(
            selectedPlace != null
                ? '${selectedPlace!.name}${selectedPlace!.address != null ? '・${selectedPlace!.address}' : ''}'
                : '緯度 ${postLocation!.latitude.toStringAsFixed(6)} / 経度 ${postLocation!.longitude.toStringAsFixed(6)}',
            style: Theme.of(context).textTheme.bodySmall,
          ),
        ),
      if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(error!, style: const TextStyle(color: Colors.red))),
      const SizedBox(height: 12),
      FilledButton(onPressed: loading ? null : submit, child: Text(loading ? '投稿中...' : '投稿する')),
    ]),
  );
}
