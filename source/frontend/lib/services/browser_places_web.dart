import 'dart:convert';
import 'dart:js_interop';
import '../models/place.dart';

/// web/index.html.template で定義している JS 関数。Maps JavaScript API の Places ライブラリで周辺の店を探す。
@JS('nearbyPlaces')
external JSPromise<JSString> _nearbyPlaces(JSNumber latitude, JSNumber longitude, JSNumber radius, JSNumber max);

@JS('readPoiClick')
external JSString? _readPoiClick();

@JS('clearPoiClick')
external void _clearPoiClick();

@JS('readLastPoiCard')
external JSString? _readLastPoiCard();

@JS('clearLastPoiCard')
external void _clearLastPoiCard();

NearbyPlace? _placeFromJson(Map<String, dynamic> item, {required double latitude, required double longitude}) {
  final placeLatitude = (item['latitude'] as num?)?.toDouble();
  final placeLongitude = (item['longitude'] as num?)?.toDouble();
  final id = item['id'] as String?;
  final name = item['name'] as String?;
  if (placeLatitude == null || placeLongitude == null || id == null || name == null || name.isEmpty) return null;
  return NearbyPlace(
    id: id,
    name: name,
    address: (item['address'] as String?)?.trim().isNotEmpty == true ? (item['address'] as String).trim() : null,
    latitude: placeLatitude,
    longitude: placeLongitude,
    distanceMeters: distanceBetweenMeters(latitude, longitude, placeLatitude, placeLongitude).round(),
    primaryType: item['primaryType'] as String?,
  );
}

/// 地図と同じ Google のデータで周辺の店・施設を近い順に返す。
/// Places API (New) がキーで有効になっていない、JS 関数が無いなどで使えない場合は null。
Future<List<NearbyPlace>?> searchBrowserPlaces({required double latitude, required double longitude, int radius = 300, int max = 3}) async {
  try {
    final raw = (await _nearbyPlaces(latitude.toJS, longitude.toJS, radius.toJS, max.toJS).toDart).toDart;
    final items = (jsonDecode(raw) as List<dynamic>).whereType<Map<String, dynamic>>();
    final places = items.map((item) => _placeFromJson(item, latitude: latitude, longitude: longitude)).whereType<NearbyPlace>().toList();
    places.sort((a, b) => a.distanceMeters.compareTo(b.distanceMeters));
    return places;
  } catch (_) {
    return null;
  }
}

String? _clean(Object? value) => value is String && value.trim().isNotEmpty ? value.trim() : null;

/// 直近に地図上の店アイコン(Google の POI)が押されていればその情報。
/// クリックの捕捉(placeId 付き)と、店カードの描画監視(店名・住所)の両方を見る。
/// 座標が取れない場合は [fallbackLatitude] / [fallbackLongitude](タップ地点)を使う。
PoiClick? readPoiClick({required double fallbackLatitude, required double fallbackLongitude}) {
  String? placeId;
  double? latitude;
  double? longitude;
  String? name;
  String? address;
  try {
    final raw = _readPoiClick()?.toDart;
    if (raw != null) {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      placeId = _clean(json['placeId']);
      latitude = (json['latitude'] as num?)?.toDouble();
      longitude = (json['longitude'] as num?)?.toDouble();
      name = _clean(json['name']);
      address = _clean(json['address']);
    }
  } catch (_) {}
  try {
    final raw = _readLastPoiCard()?.toDart;
    if (raw != null) {
      final json = jsonDecode(raw) as Map<String, dynamic>;
      name ??= _clean(json['name']);
      address ??= _clean(json['address']);
    }
  } catch (_) {}
  if (placeId == null && name == null) return null;
  final resolvedLatitude = latitude ?? fallbackLatitude;
  final resolvedLongitude = longitude ?? fallbackLongitude;
  return PoiClick(
    placeId: placeId ?? 'google-poi-${resolvedLatitude.toStringAsFixed(6)},${resolvedLongitude.toStringAsFixed(6)}',
    latitude: resolvedLatitude,
    longitude: resolvedLongitude,
    name: name,
    address: address,
  );
}

void clearPoiClick() {
  try {
    _clearPoiClick();
  } catch (_) {}
  try {
    _clearLastPoiCard();
  } catch (_) {}
}
