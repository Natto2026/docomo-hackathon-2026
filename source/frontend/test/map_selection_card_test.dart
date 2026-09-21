import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/place.dart';
import 'package:local_area_sns/models/post.dart';
import 'package:local_area_sns/widgets/map_selection_card.dart';

final now = DateTime.parse('2026-09-10T00:30:00.000Z');

Post buildPost({required String id, required String body, String postType = 'normal', bool withPlace = true, String createdAt = '2026-09-09T10:00:00.000Z'}) => Post.fromJson({
      'id': id,
      'authorId': 'demo-user-2',
      'authorName': 'さくら',
      'body': body,
      'latitude': 34.7036,
      'longitude': 135.4962,
      if (withPlace) 'placeName': 'スターバックス',
      if (withPlace) 'placeId': 'osm-node-1',
      if (withPlace) 'placeAddress': '大阪府大阪市北区梅田0-0',
      if (withPlace) 'placeType': 'cafe',
      'postType': postType,
      'likeCount': 2,
      'commentCount': 1,
      'distanceMeters': 350,
      'createdAt': createdAt,
    });

Widget wrap(Widget child) => MaterialApp(home: Scaffold(body: Align(alignment: Alignment.bottomCenter, child: child)));

void main() {
  test('placeTypeLabel は既知の分類を日本語にし、未知はそのまま返す', () {
    expect(placeTypeLabel('cafe'), 'カフェ');
    expect(placeTypeLabel('convenience'), 'コンビニ');
    expect(placeTypeLabel('weird_type'), 'weird_type');
    expect(placeTypeLabel(null), isNull);
  });

  test('Post.placeKey は店があれば店ごと、無ければ投稿ごとになる', () {
    final withPlace = buildPost(id: 'p1', body: 'a');
    final noPlace = Post.fromJson({'id': 'p2', 'body': 'b', 'latitude': 1.0, 'longitude': 2.0});
    expect(withPlace.placeKey, 'osm-node-1');
    expect(noPlace.placeKey, 'post:p2');
  });

  test('リアルタイム投稿は投稿から1時間だけ燃える', () {
    final fresh = buildPost(id: 'r1', body: 'x', postType: 'realtime', createdAt: '2026-09-10T00:10:00.000Z');
    final old = buildPost(id: 'r2', body: 'y', postType: 'realtime', createdAt: '2026-09-09T22:00:00.000Z');
    final normal = buildPost(id: 'n1', body: 'z', createdAt: '2026-09-10T00:10:00.000Z');
    expect(fresh.burningAt(now), isTrue);
    expect(fresh.remainingBurnAt(now), const Duration(minutes: 40));
    expect(old.burningAt(now), isFalse);
    expect(old.remainingBurnAt(now), Duration.zero);
    expect(normal.burningAt(now), isFalse);
  });

  testWidgets('カードは投稿内容だけを並べ、店名・住所は出さない', (tester) async {
    final posts = [buildPost(id: 'p1', body: '今なら空いてます', postType: 'realtime', createdAt: '2026-09-10T00:10:00.000Z'), buildPost(id: 'p2', body: '新作が出てた')];
    Post? opened;
    var closed = false;

    await tester.pumpWidget(wrap(MapSelectionCard(posts: posts, now: now, onOpenPost: (post) => opened = post, onClose: () => closed = true)));

    expect(find.text('投稿 2件'), findsOneWidget);
    expect(find.text('さくら'), findsNWidgets(2));
    expect(find.text('今なら空いてます'), findsOneWidget);
    expect(find.text('新作が出てた'), findsOneWidget);
    expect(find.text('🔥 あと41分'), findsOneWidget);
    expect(find.text('スターバックス'), findsNothing);
    expect(find.textContaining('テスト市'), findsNothing);

    await tester.tap(find.text('新作が出てた'));
    await tester.pump();
    expect(opened?.id, 'p2');

    await tester.tap(find.byIcon(Icons.close));
    await tester.pump();
    expect(closed, isTrue);
  });

  testWidgets('4件以上は折りたたまれ、「他 n件を見る」で全部出る', (tester) async {
    final posts = List.generate(5, (i) => buildPost(id: 'p$i', body: '投稿$i'));

    await tester.pumpWidget(wrap(MapSelectionCard(posts: posts, now: now, onOpenPost: (_) {}, onClose: () {})));

    expect(find.text('投稿2'), findsOneWidget);
    expect(find.text('投稿3'), findsNothing);
    expect(find.text('他 2件を見る'), findsOneWidget);

    await tester.ensureVisible(find.text('他 2件を見る'));
    await tester.tap(find.text('他 2件を見る'));
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('投稿4'));
    expect(find.text('投稿4'), findsOneWidget);
    expect(find.text('他 2件を見る'), findsNothing);
  });
}
