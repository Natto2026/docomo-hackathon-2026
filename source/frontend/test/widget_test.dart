// This is a basic Flutter widget test.
//
// To perform an interaction with a widget in your test, use the WidgetTester
// utility in the flutter_test package. For example, you can send tap and scroll
// gestures. You can also use WidgetTester to find child widgets in the widget
// tree, read text, and verify that the values of widget properties are correct.

import 'package:flutter_test/flutter_test.dart';

import 'package:local_area_sns/main.dart';

void main() {
  testWidgets('アプリのホーム画面を表示できる', (WidgetTester tester) async {
    await tester.pumpWidget(const LocalAreaSnsApp());

    expect(find.text('マップ'), findsOneWidget);
    expect(find.text('タイムライン'), findsOneWidget);
    expect(find.text('ユーザー'), findsOneWidget);
    expect(find.text('投稿'), findsOneWidget);
  });
}
