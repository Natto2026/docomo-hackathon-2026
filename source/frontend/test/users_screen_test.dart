import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/user.dart';
import 'package:local_area_sns/screens/users_screen.dart';
import 'package:local_area_sns/services/api_client.dart';

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.usersToReturn = const [], this.errorToThrow});
  final List<AppUser> usersToReturn;
  final Object? errorToThrow;
  int followCalls = 0;
  int unfollowCalls = 0;

  @override
  Future<List<AppUser>> fetchUsers() async {
    if (errorToThrow != null) throw errorToThrow!;
    return usersToReturn;
  }

  @override
  Future<FollowResult> followUser(String id) async {
    followCalls++;
    final target = usersToReturn.firstWhere((user) => user.id == id);
    return target.isPrivate
        ? const FollowResult(following: false, status: 'pending', followerCount: 0)
        : const FollowResult(following: true, status: 'accepted', followerCount: 1);
  }

  @override
  Future<FollowResult> unfollowUser(String id) async {
    unfollowCalls++;
    return const FollowResult(following: false, status: 'none', followerCount: 0);
  }
}

const self = AppUser(id: 'demo-user-1', name: 'デモユーザー', postCount: 4);
const other = AppUser(id: 'demo-user-2', name: 'さくら', postCount: 2, followerCount: 0);
const privateUser = AppUser(id: 'demo-user-3', name: 'たろう', postCount: 1, isPrivate: true, canViewPosts: false);

Widget _wrap(_FakeApiClient api) => MaterialApp(home: Scaffold(body: UsersScreen(refreshKey: 0, apiClient: api)));

void main() {
  testWidgets('ユーザー一覧に名前と投稿数が表示され、自分にはフォローボタンが出ない', (tester) async {
    final api = _FakeApiClient(usersToReturn: const [self, other]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('デモユーザー'), findsOneWidget);
    expect(find.text('さくら'), findsOneWidget);
    expect(find.text('投稿 2・フォロワー 0'), findsOneWidget);
    expect(find.text('あなた'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'フォロー'), findsOneWidget);
  });

  testWidgets('フォローボタンを押すとAPIが呼ばれ、表示がフォロー中に変わる', (tester) async {
    final api = _FakeApiClient(usersToReturn: const [other]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    await tester.tap(find.widgetWithText(FilledButton, 'フォロー'));
    await tester.pumpAndSettle();

    expect(api.followCalls, 1);
    expect(find.widgetWithText(OutlinedButton, 'フォロー中'), findsOneWidget);
    expect(find.text('投稿 2・フォロワー 1'), findsOneWidget);

    await tester.tap(find.widgetWithText(OutlinedButton, 'フォロー中'));
    await tester.pumpAndSettle();

    expect(api.unfollowCalls, 1);
    expect(find.widgetWithText(FilledButton, 'フォロー'), findsOneWidget);
  });

  testWidgets('鍵アカウントには鍵アイコンとリクエストボタンが出て、押すとリクエスト済みになる', (tester) async {
    final api = _FakeApiClient(usersToReturn: const [privateUser]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.byIcon(Icons.lock), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'リクエスト'), findsOneWidget);

    await tester.tap(find.widgetWithText(FilledButton, 'リクエスト'));
    await tester.pumpAndSettle();

    expect(api.followCalls, 1);
    expect(find.widgetWithText(OutlinedButton, 'リクエスト済み'), findsOneWidget);
    expect(find.text('たろうさんにフォローをリクエストしました'), findsOneWidget);

    // リクエスト済みを押すと取り消し
    await tester.tap(find.widgetWithText(OutlinedButton, 'リクエスト済み'));
    await tester.pumpAndSettle();

    expect(api.unfollowCalls, 1);
    expect(find.widgetWithText(FilledButton, 'リクエスト'), findsOneWidget);
  });

  testWidgets('APIエラー時はエラーメッセージと再読み込みボタンを表示する', (tester) async {
    final api = _FakeApiClient(errorToThrow: Exception('通信に失敗しました'));

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('ユーザーを読み込めませんでした'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '再読み込み'), findsOneWidget);
  });
}
