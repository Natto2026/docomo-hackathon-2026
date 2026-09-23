import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/place.dart';
import 'package:local_area_sns/screens/create_post_screen.dart';

void main() {
  testWidgets('本文が空の場合はバリデーションエラーを表示する', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CreatePostScreen(onCreated: () {})));
    await tester.pump();

    await tester.dragUntilVisible(
      find.widgetWithText(FilledButton, '投稿する'),
      find.byType(ListView),
      const Offset(0, -300),
    );
    await tester.tap(find.widgetWithText(FilledButton, '投稿する'));
    await tester.pump();

    expect(find.text('本文は1〜500文字で入力してください'), findsOneWidget);
  });

  testWidgets('本文は500文字を超えて入力できない（maxLengthで制限される）', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CreatePostScreen(onCreated: () {})));
    await tester.pump();

    await tester.enterText(find.byType(TextField).first, 'あ' * 501);
    await tester.pump();

    expect(find.text('500/500'), findsOneWidget);
  });

  testWidgets('投稿タイプの切替UIが表示される', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CreatePostScreen(onCreated: () {})));
    await tester.pump();

    expect(find.text('通常'), findsOneWidget);
    expect(find.text('リアルタイム'), findsOneWidget);
  });

  testWidgets('店を指定して開くと、その店が選ばれた状態で始まる', (tester) async {
    const place = NearbyPlace(id: 'ChIJ123', name: 'テスト喫茶', address: 'テスト市', latitude: 34.7025, longitude: 135.4959, distanceMeters: 0, primaryType: 'cafe');

    await tester.pumpWidget(MaterialApp(home: CreatePostScreen(onCreated: () {}, initialPlace: place)));
    await tester.pump();

    await tester.dragUntilVisible(find.text('場所の名前(任意)'), find.byType(ListView), const Offset(0, -300));

    expect(find.widgetWithText(TextField, 'テスト喫茶'), findsOneWidget);
    expect(find.textContaining('テスト喫茶(0m・カフェ)'), findsOneWidget);
  });

  testWidgets('投稿場所として場所の名前を入力できる', (tester) async {
    await tester.pumpWidget(MaterialApp(home: CreatePostScreen(onCreated: () {})));
    await tester.pump();

    await tester.dragUntilVisible(
      find.text('場所の名前(任意)'),
      find.byType(ListView),
      const Offset(0, -300),
    );

    expect(find.text('場所の名前(任意)'), findsOneWidget);
    await tester.enterText(find.widgetWithText(TextField, '場所の名前(任意)'), '駅前のカフェ');
    await tester.pump();

    expect(find.text('駅前のカフェ'), findsOneWidget);
  });
}
