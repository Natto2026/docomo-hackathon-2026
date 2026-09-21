import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/user.dart';
import 'package:local_area_sns/screens/follow_requests_screen.dart';
import 'package:local_area_sns/services/api_client.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient(this.requests);
  final List<AppUser> requests;
  final approved = <String>[];
  final rejected = <String>[];

  @override
  Future<List<AppUser>> fetchFollowRequests() async => requests;

  @override
  Future<void> approveFollowRequest(String followerId) async => approved.add(followerId);

  @override
  Future<void> rejectFollowRequest(String followerId) async => rejected.add(followerId);
}

const sakura = AppUser(id: 'demo-user-2', name: 'さくら', bio: 'カフェ好き');
const taro = AppUser(id: 'demo-user-3', name: 'たろう');

void main() {
  testWidgets('届いたリクエストが一覧に表示される', (tester) async {
    final api = _FakeApiClient(const [sakura, taro]);

    await tester.pumpWidget(MaterialApp(home: FollowRequestsScreen(apiClient: api)));
    await tester.pumpAndSettle();

    expect(find.text('さくら'), findsOneWidget);
    expect(find.text('たろう'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '承認'), findsNWidgets(2));
  });

  testWidgets('承認するとAPIが呼ばれ、一覧から消える', (tester) async {
    final api = _FakeApiClient(const [sakura]);

    await tester.pumpWidget(MaterialApp(home: FollowRequestsScreen(apiClient: api)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, '承認'));
    await tester.pumpAndSettle();

    expect(api.approved, ['demo-user-2']);
    expect(find.text('さくらさんをフォロワーに追加しました'), findsOneWidget);
    expect(find.text('新しいフォローリクエストはありません'), findsOneWidget);
  });

  testWidgets('拒否するとAPIが呼ばれ、一覧から消える', (tester) async {
    final api = _FakeApiClient(const [sakura]);

    await tester.pumpWidget(MaterialApp(home: FollowRequestsScreen(apiClient: api)));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(OutlinedButton, '拒否'));
    await tester.pumpAndSettle();

    expect(api.rejected, ['demo-user-2']);
    expect(find.text('新しいフォローリクエストはありません'), findsOneWidget);
  });

  testWidgets('リクエストが無い場合は空メッセージを表示する', (tester) async {
    final api = _FakeApiClient(const []);

    await tester.pumpWidget(MaterialApp(home: FollowRequestsScreen(apiClient: api)));
    await tester.pumpAndSettle();

    expect(find.text('新しいフォローリクエストはありません'), findsOneWidget);
  });
}
