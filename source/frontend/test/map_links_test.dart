import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/services/map_links.dart';

void main() {
  test('Google Places の ID があれば店を直接指す URL になる', () {
    final uri = googleMapsUri(latitude: 34.7, longitude: 135.5, name: 'テスト喫茶', placeId: 'ChIJabc123');
    expect(uri.host, 'www.google.com');
    expect(uri.path, '/maps/search/');
    expect(uri.queryParameters['api'], '1');
    expect(uri.queryParameters['query'], 'テスト喫茶');
    expect(uri.queryParameters['query_place_id'], 'ChIJabc123');
  });

  test('OSM 由来の ID や店が無い場合は座標を指す URL になる', () {
    final osm = googleMapsUri(latitude: 34.7, longitude: 135.5, name: 'テスト神社', placeId: 'osm-node-1');
    expect(osm.queryParameters['query'], '34.7,135.5');
    expect(osm.queryParameters.containsKey('query_place_id'), isFalse);

    final plain = googleMapsUri(latitude: 34.7025, longitude: 135.4959);
    expect(plain.queryParameters['query'], '34.7025,135.4959');
  });
}
