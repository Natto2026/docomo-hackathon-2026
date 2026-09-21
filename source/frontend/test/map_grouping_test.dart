import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/post.dart';
import 'package:local_area_sns/screens/map_screen.dart';

Post buildPost({
  required String id,
  required double latitude,
  required double longitude,
  String? placeName,
  String? placeId,
}) =>
    Post.fromJson({
      'id': id,
      'authorId': 'demo-user-1',
      'authorName': 'デモユーザー',
      'body': id,
      'latitude': latitude,
      'longitude': longitude,
      if (placeName != null) 'placeName': placeName,
      if (placeId != null) 'placeId': placeId,
      'createdAt': '2026-09-10T00:00:00.000Z',
    });

void main() {
  group('同じ場所の投稿をピンにまとめる', () {
    test('同じ店の投稿は1つのピンにまとまる', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'a', latitude: 34.7, longitude: 135.5, placeName: 'テスト食堂', placeId: 'osm-node-1'),
        buildPost(id: 'b', latitude: 34.7001, longitude: 135.5001, placeName: 'テスト食堂', placeId: 'osm-node-1'),
      ]);

      expect(groups, hasLength(1));
      expect(groups.values.first, hasLength(2));
    });

    test('店が分からない投稿も、近ければ同じピンにまとまる', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'a', latitude: 34.7, longitude: 135.5),
        // 約11m north
        buildPost(id: 'b', latitude: 34.7001, longitude: 135.5),
        // 約22m north
        buildPost(id: 'c', latitude: 34.7002, longitude: 135.5),
      ]);

      expect(groups, hasLength(1));
      expect(groups.values.first.map((post) => post.id), ['a', 'b', 'c']);
    });

    test('離れた投稿は別のピンになる', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'a', latitude: 34.7, longitude: 135.5),
        // 約1.1km north
        buildPost(id: 'far', latitude: 34.71, longitude: 135.5),
      ]);

      expect(groups, hasLength(2));
    });

    test('同じ店名でも遠く離れていれば別のピンになる', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'a', latitude: 34.7, longitude: 135.5, placeName: 'こぐま商店'),
        // 同じ名前だが約1.1km離れている(別の店)
        buildPost(id: 'far', latitude: 34.71, longitude: 135.5, placeName: 'こぐま商店'),
      ]);

      expect(groups, hasLength(2));
    });

    test('同じ店名で近ければ1つのピンにまとまる', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'a', latitude: 34.7, longitude: 135.5, placeName: 'こぐま商店'),
        // 約33m
        buildPost(id: 'b', latitude: 34.7003, longitude: 135.5, placeName: 'こぐま商店'),
      ]);

      expect(groups, hasLength(1));
      expect(groups.values.first, hasLength(2));
    });

    test('店の投稿と、近くの店なし投稿は混ざらない', () {
      final groups = MapScreen.groupPosts([
        buildPost(id: 'shop', latitude: 34.7, longitude: 135.5, placeName: 'テスト食堂', placeId: 'osm-node-1'),
        buildPost(id: 'plain', latitude: 34.7, longitude: 135.5),
      ]);

      expect(groups, hasLength(2));
    });
  });
}
