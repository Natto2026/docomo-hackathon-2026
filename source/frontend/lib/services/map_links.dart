import 'map_links_stub.dart' if (dart.library.js_interop) 'map_links_web.dart' as platform;

/// Google マップで場所を開くための URL。
/// Google Places の ID があれば店そのものを、無ければ座標を指定する。
Uri googleMapsUri({required double latitude, required double longitude, String? name, String? placeId}) {
  final isGooglePlace = placeId != null && !placeId.startsWith('osm-') && !placeId.startsWith('nominatim-');
  if (isGooglePlace && name != null && name.isNotEmpty) {
    return Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': name, 'query_place_id': placeId});
  }
  return Uri.https('www.google.com', '/maps/search/', {'api': '1', 'query': '$latitude,$longitude'});
}

/// Google マップを新しいタブで開く(Web)。開けなければ false。
bool openInGoogleMaps({required double latitude, required double longitude, String? name, String? placeId}) {
  return platform.openUrl(googleMapsUri(latitude: latitude, longitude: longitude, name: name, placeId: placeId));
}
