import '../models/place.dart';

/// Web 以外では Google Places のブラウザ検索は使えない(null = 未対応)。
Future<List<NearbyPlace>?> searchBrowserPlaces({required double latitude, required double longitude, int radius = 300, int max = 3}) async => null;

PoiClick? readPoiClick({required double fallbackLatitude, required double fallbackLongitude}) => null;

void clearPoiClick() {}
