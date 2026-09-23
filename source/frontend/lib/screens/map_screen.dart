import 'dart:async';
import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import '../models/place.dart' show NearbyPlace, distanceBetweenMeters;
import '../models/post.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../services/map_links.dart';
import '../widgets/flame_icons.dart';
import '../widgets/location_icon.dart';
import '../widgets/map_selection_card.dart';
import 'post_detail_screen.dart';

/// 投稿画面を開く。店アイコンから開いたときは、その店を選んだ状態で開く。
typedef CreatePostCallback = void Function([NearbyPlace? place]);

class MapScreen extends StatefulWidget {
  const MapScreen({super.key, required this.onCreatePost, required this.refreshKey});
  final CreatePostCallback onCreatePost;
  final int refreshKey;

  /// 店が分からない投稿を「同じ場所」とみなす距離。
  static const groupRadiusMeters = 35.0;
  /// 店名が同じ投稿を「同じ店」とみなす距離。同じ名前のチェーン店が別の場所にあっても混ざらないようにする。
  static const namedGroupRadiusMeters = 150.0;

  /// 同じ場所の投稿を1つのピンにまとめる。
  /// 店IDが同じなら同じ店。店名だけの投稿は名前が同じかつ近いもの同士。
  /// 店が分からない投稿は近いもの同士でまとめる。
  static Map<String, List<Post>> groupPosts(List<Post> posts) {
    final groups = <String, List<Post>>{};
    // まとめ先のキー -> 代表の投稿(最初に見つかった=最新)
    final anchors = <String, Post>{};
    for (final post in posts) {
      if (post.placeId != null) {
        final key = 'id:${post.placeId}';
        anchors.putIfAbsent(key, () => post);
        groups.putIfAbsent(key, () => []).add(post);
        continue;
      }
      final named = post.placeName != null;
      final prefix = named ? 'name:${post.placeName}' : 'spot';
      final radius = named ? namedGroupRadiusMeters : groupRadiusMeters;
      String? matched;
      for (final entry in anchors.entries) {
        if (!entry.key.startsWith('$prefix@')) continue;
        if (distanceBetweenMeters(post.latitude, post.longitude, entry.value.latitude, entry.value.longitude) <= radius) {
          matched = entry.key;
          break;
        }
      }
      final key = matched ?? '$prefix@${post.id}';
      anchors.putIfAbsent(key, () => post);
      groups.putIfAbsent(key, () => []).add(post);
    }
    return groups;
  }

  @override State<MapScreen> createState() => _MapScreenState();
}
class _MapScreenState extends State<MapScreen> {
  static const demo = LatLng(34.7025, 135.4959);
  /// 閲覧できる範囲(現在地からの半径)。バックエンドの radius と合わせる。
  static const visibleRadiusMeters = 5000.0;
  /// 円を画面に収めるときの余白(px)。
  static const fitPadding = 0.0;
  /// 円を大きく見せるため、実際の半径より小さい範囲を画面に合わせる(円は短い辺から少しはみ出す)。
  static const circleFitScale = 0.72;
  /// 初回のズームイン演出の開始ズーム(県くらいが見える広さ)。
  static const introZoom = 9.0;
  static const introPause = Duration(milliseconds: 600);
  /// 燃えるピンのコマ送り間隔。
  static const burnTick = Duration(milliseconds: 450);

  /// 最後に表示していたカメラ位置。別タブから戻ったとき(Web では地図が作り直される)に復元する。
  /// State が作り直されても残るよう static にしている。
  static CameraPosition? savedCamera;
  /// 最後に取得した現在地。savedCamera と同様に画面を離れても保持する。
  static LatLng? savedCenter;
  /// 炎アイコンは一度作れば使い回す。
  static List<BitmapDescriptor>? flameFrames;
  /// 現在地アイコン(白縁の青い丸)。
  static BitmapDescriptor? locationIcon;

  final api = ApiClient();
  final location = LocationService();
  GoogleMapController? controller;
  LatLng center = savedCenter ?? demo;
  List<Post> posts = [];
  /// 選択中のピン。店のピンなら同じ店の投稿すべて、投稿単体のピンなら1件。
  List<Post>? selected;
  String? selectedKey;
  String? error;
  bool loading = true;
  /// 最初の現在地取得が終わったか。終わるまで地図を覆って固定地点が見えないようにする。
  bool located = savedCamera != null;
  Timer? burnTimer;
  int burnFrame = 0;

  @override
  void initState() {
    super.initState();
    if (locationIcon == null) {
      LocationIcon.get().then((icon) {
        locationIcon = icon;
        if (mounted) setState(() {});
      }).catchError((_) {});
    }
    if (flameFrames == null) {
      FlameIcons.generate().then((frames) {
        flameFrames = frames;
        if (mounted) setState(() {});
      }).catchError((_) {});
    }
  }

  @override
  void dispose() {
    burnTimer?.cancel();
    super.dispose();
  }

  @override
  void didUpdateWidget(covariant MapScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    // 投稿後やユーザー切り替え後は投稿だけ読み直し、カメラは動かさない
    if (oldWidget.refreshKey != widget.refreshKey) refreshPosts();
  }

  /// 中心から半径 [radiusMeters] の円がぴったり収まる矩形。
  static LatLngBounds boundsAround(LatLng center, double radiusMeters) {
    const metersPerDegree = 111320.0;
    final latitudeDelta = radiusMeters / metersPerDegree;
    final longitudeDelta = radiusMeters / (metersPerDegree * math.cos(center.latitude * math.pi / 180));
    return LatLngBounds(
      southwest: LatLng(center.latitude - latitudeDelta, center.longitude - longitudeDelta),
      northeast: LatLng(center.latitude + latitudeDelta, center.longitude + longitudeDelta),
    );
  }

  /// 現在地を中心に、5km の円が画面に収まるようカメラを合わせる。
  Future<void> fitCircle() async {
    final map = controller;
    if (map == null) return;
    await map.animateCamera(CameraUpdate.newLatLngBounds(boundsAround(center, visibleRadiusMeters * circleFitScale), fitPadding));
  }

  /// 地図が(再)作成されたとき。前回の位置があれば復元し、無ければ初回の演出付きで現在地へ寄る。
  Future<void> onMapCreated(GoogleMapController map) async {
    controller = map;
    final previous = savedCamera;
    if (previous != null) {
      await map.moveCamera(CameraUpdate.newCameraPosition(previous));
      if (mounted) setState(() => located = true);
      await refreshPosts();
      return;
    }
    await locateWithIntro();
  }

  /// 初回: 現在地を取得し、広域表示から 5km の円へズームインして「ここを見ている」と分かるようにする。
  Future<void> locateWithIntro() async {
    setState(() => loading = true);
    try {
      final point = await location.current();
      center = LatLng(point.latitude, point.longitude);
      savedCenter = center;
      await controller?.moveCamera(CameraUpdate.newLatLngZoom(center, introZoom));
      if (mounted) setState(() => located = true);
      await Future<void>.delayed(introPause);
      if (!mounted) return;
      await fitCircle();
      await fetchPosts();
    } catch (_) {
      if (mounted) setState(() => error = '投稿を読み込めませんでした');
    } finally {
      if (mounted) setState(() { loading = false; located = true; });
    }
  }

  /// 現在地を取り直して投稿を再取得する。カメラは動かさない。
  Future<void> refreshPosts() async {
    setState(() => loading = true);
    try {
      final point = await location.current();
      center = LatLng(point.latitude, point.longitude);
      savedCenter = center;
      await fetchPosts();
    } catch (_) {
      if (mounted) setState(() => error = '投稿を読み込めませんでした');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> fetchPosts() async {
    final result = await api.fetchPosts(latitude: center.latitude, longitude: center.longitude);
    if (!mounted) return;
    setState(() {
      posts = result;
      error = null;
      // 選択中の投稿が消えていたら閉じる
      final current = selected;
      if (current != null) {
        final ids = result.map((post) => post.id).toSet();
        final remaining = current.where((post) => ids.contains(post.id)).toList();
        selected = remaining.isEmpty ? null : remaining;
        if (selected == null) selectedKey = null;
      }
    });
    syncBurnTimer();
  }

  /// 燃えている投稿があるときだけコマ送りのタイマーを回す。
  void syncBurnTimer() {
    final anyBurning = posts.any((post) => post.isBurning);
    if (anyBurning && burnTimer == null) {
      burnTimer = Timer.periodic(burnTick, (_) {
        if (!mounted) return;
        if (!posts.any((post) => post.isBurning)) {
          syncBurnTimer();
          return;
        }
        setState(() => burnFrame = (burnFrame + 1) % FlameIcons.frameCount);
      });
    } else if (!anyBurning && burnTimer != null) {
      burnTimer!.cancel();
      burnTimer = null;
      if (mounted) setState(() {});
    }
  }

  /// 現在地ボタン: 現在地を取り直して円に合わせ、投稿も読み直す。
  Future<void> recenter() async {
    await refreshPosts();
    await fitCircle();
  }

  /// 詳細画面へ。削除して戻ってきたら(true)マーカーを読み直す。
  Future<void> openDetail(Post post) async {
    final deleted = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => PostDetailScreen(post: post)));
    if (deleted == true && mounted) {
      clearSelection();
      refreshPosts();
    }
  }

  void clearSelection() => setState(() { selected = null; selectedKey = null; });

  /// 店名や住所が無い投稿のために、座標から逆引きした施設名・住所をピンごとに覚えておく。
  final resolvedAddresses = <String, String>{};
  final resolvedNames = <String, String>{};

  void selectGroup(String markerKey, List<Post> group) {
    setState(() { selected = group; selectedKey = markerKey; });
    // 再描画でピンが作り直されると吹き出しが閉じるため、描画後に改めて開く
    showBubble(markerKey);
    final first = group.first;
    // 店名・住所が無い投稿は、座標から逆引きして吹き出しに出す
    if ((first.placeName == null || first.placeAddress == null) && !resolvedNames.containsKey(markerKey) && !resolvedAddresses.containsKey(markerKey)) {
      resolveAddress(markerKey, first);
    }
  }

  void showBubble(String markerKey) {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted && selectedKey == markerKey) controller?.showMarkerInfoWindow(MarkerId(markerKey));
    });
  }

  Future<void> resolveAddress(String markerKey, Post post) async {
    try {
      final resolved = await api.fetchPlaceAt(latitude: post.latitude, longitude: post.longitude);
      if (!mounted) return;
      final address = resolved.address;
      final name = resolved.name;
      if (address != null || name != null) {
        setState(() {
          if (address != null) resolvedAddresses[markerKey] = address;
          if (name != null) resolvedNames[markerKey] = name;
        });
        // 店名・住所が入った吹き出しに更新する
        showBubble(markerKey);
      }
    } catch (_) {}
  }

  /// ピンの上に出す吹き出し。Google の店カードと同じく店名と住所だけ。押すと Google マップで開く。
  InfoWindow _infoWindowFor(String key, List<Post> group) {
    final first = group.first;
    return InfoWindow(
      title: first.placeName ?? resolvedNames[key] ?? '投稿場所',
      snippet: first.placeAddress ?? resolvedAddresses[key] ?? first.placeTypeText,
      onTap: () => openInGoogleMaps(latitude: first.latitude, longitude: first.longitude, name: first.placeName, placeId: first.placeId),
    );
  }

  /// 同じ場所の投稿を1つのピンにまとめる。
  Map<String, List<Post>> get groups => MapScreen.groupPosts(posts);

  BitmapDescriptor _iconFor(String key, List<Post> group) {
    if (key == selectedKey) return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueCyan);
    final frames = flameFrames;
    if (frames != null && group.any((post) => post.isBurning)) return frames[burnFrame % frames.length];
    if (group.any((post) => post.postType == 'realtime')) return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueRed);
    if (group.first.placeName != null) return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueOrange);
    return BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueViolet);
  }

  Set<Marker> get markers {
    final result = groups.entries.map((entry) {
      final first = entry.value.first;
      return Marker(
        markerId: MarkerId(entry.key),
        position: LatLng(first.latitude, first.longitude),
        icon: _iconFor(entry.key, entry.value),
        infoWindow: _infoWindowFor(entry.key, entry.value),
        consumeTapEvents: true,
        zIndexInt: 2,
        onTap: () => selectGroup(entry.key, entry.value),
      );
    }).toSet();
    // 現在地は白縁の青い丸で常に表示する(Web では標準の青い点が出ないため)。選択や読み直しで消えない
    if (located) {
      result.add(Marker(
        markerId: const MarkerId('my-location'),
        position: center,
        icon: locationIcon ?? BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
        anchor: const Offset(0.5, 0.5),
        infoWindow: const InfoWindow(title: '現在地'),
        zIndexInt: 100,
      ));
    }
    return result;
  }

  /// 現在地を中心にした半径5kmの閲覧範囲(薄い赤)と、燃えている投稿の足元の光。
  Set<Circle> get circles {
    final result = <Circle>{
      Circle(
        circleId: const CircleId('visible-radius'),
        center: center,
        radius: visibleRadiusMeters,
        fillColor: Colors.red.withValues(alpha: 0.08),
        strokeColor: Colors.red.withValues(alpha: 0.45),
        strokeWidth: 2,
      ),
    };
    final pulse = [0.0, 0.5, 1.0][burnFrame % 3];
    for (final entry in groups.entries) {
      if (!entry.value.any((post) => post.isBurning)) continue;
      final first = entry.value.first;
      result.add(Circle(
        circleId: CircleId('burn-${entry.key}'),
        center: LatLng(first.latitude, first.longitude),
        radius: 90 + 90 * pulse,
        fillColor: Colors.deepOrange.withValues(alpha: 0.28 - 0.12 * pulse),
        strokeColor: Colors.deepOrange.withValues(alpha: 0.5 - 0.3 * pulse),
        strokeWidth: 1,
      ));
    }
    return result;
  }

  Widget _legend(BuildContext context) => Card(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
          child: Text('青い丸=現在地  赤い円=半径5km  ●橙=店  ●紫=投稿  ●赤=リアルタイム(1時間は🔥)', style: Theme.of(context).textTheme.bodySmall),
        ),
      );

  /// 下のカードは投稿内容だけ。店名・住所は Google の店カードに任せ、
  /// それが出ない場所(店アイコンの無い地点)のときだけ見出しに補う。
  Widget _card(List<Post> current) {
    final first = current.first;
    final key = selectedKey;
    final title = first.placeName ?? (key != null ? resolvedNames[key] : null);
    final subtitle = first.placeAddress ?? (key != null ? resolvedAddresses[key] : null);
    return MapSelectionCard(
      posts: current,
      headerTitle: title,
      headerSubtitle: subtitle,
      onOpenPost: openDetail,
      onClose: clearSelection,
    );
  }

  @override
  Widget build(BuildContext context) {
    final current = selected;
    final showCard = current != null && current.isNotEmpty;
    return Stack(
      children: [
        GoogleMap(
          initialCameraPosition: savedCamera ?? CameraPosition(target: center, zoom: introZoom),
          myLocationEnabled: true,
          myLocationButtonEnabled: false,
          markers: markers,
          circles: circles,
          // 地図(ピン以外)を押したら選択を閉じる。Google の店アイコンの店カードはそのまま出る
          onTap: (_) => clearSelection(),
          onMapCreated: onMapCreated,
          // 利用者が動かした位置とズームを覚えておき、タブを戻ったときに復元する
          onCameraMove: (position) => savedCamera = position,
        ),
        if (!located)
          Positioned.fill(
            child: ColoredBox(
              color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.9),
              child: const Center(
                child: Column(mainAxisSize: MainAxisSize.min, children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 12),
                  Text('現在地を取得しています...'),
                ]),
              ),
            ),
          ),
        if (located && loading) const Positioned(top: 16, left: 16, right: 16, child: Card(child: Padding(padding: EdgeInsets.all(12), child: Text('近くの投稿を読み込み中...')))),
        if (error != null) Positioned(top: 16, left: 16, right: 16, child: Card(child: Padding(padding: const EdgeInsets.all(12), child: Text(error!)))),
        if (!showCard) Positioned(left: 16, bottom: 16, right: 88, child: Align(alignment: Alignment.bottomLeft, child: _legend(context))),
        // 右下のボタン群。カードが開いているときはカードの上に乗せ、現在地ボタンは隠す
        Positioned(
          left: 16,
          right: 16,
          bottom: 16,
          child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.end, children: [
            if (!showCard) ...[
              FloatingActionButton.small(heroTag: 'fit-circle', tooltip: '現在地の範囲に戻す', onPressed: recenter, child: const Icon(Icons.my_location)),
              const SizedBox(height: 8),
            ],
            FloatingActionButton(heroTag: 'create-post', onPressed: () => widget.onCreatePost(), child: const Icon(Icons.add)),
            if (showCard) ...[
              const SizedBox(height: 8),
              SizedBox(width: double.infinity, child: _card(current)),
            ],
          ]),
        ),
      ],
    );
  }
}
