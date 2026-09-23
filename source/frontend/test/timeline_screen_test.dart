import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/post.dart';
import 'package:local_area_sns/models/user.dart';
import 'package:local_area_sns/screens/timeline_screen.dart';
import 'package:local_area_sns/services/api_client.dart';
import 'package:local_area_sns/services/location_service.dart';

class _FakeLocationService extends LocationService {
  @override
  Future<({double latitude, double longitude})> current() async => (latitude: 34.7025, longitude: 135.4959);
}

class _FakeApiClient extends ApiClient {
  _FakeApiClient({this.postsToReturn, this.errorToThrow, this.me});
  final List<Post>? postsToReturn;
  final Object? errorToThrow;
  AppUser? me;
  final privacyChanges = <bool>[];

  @override
  Future<List<Post>> fetchPosts({required double latitude, required double longitude, bool followingOnly = false}) async {
    if (errorToThrow != null) throw errorToThrow!;
    return postsToReturn ?? [];
  }

  @override
  Future<AppUser> fetchUser(String id) async {
    final current = me;
    if (current == null) throw Exception('ユーザーが見つかりません');
    return current;
  }

  @override
  Future<AppUser> updatePrivacy({required bool isPrivate}) async {
    privacyChanges.add(isPrivate);
    me = me!.copyWith(isPrivate: isPrivate);
    return me!;
  }
}

Post buildPost({String id = 'post-001', String body = 'テスト本文'}) => Post.fromJson({
      'id': id,
      'authorName': 'デモユーザー',
      'body': body,
      'latitude': 34.7025,
      'longitude': 135.4959,
      'createdAt': '2026-09-09T10:00:00.000Z',
    });

const me = AppUser(id: 'demo-user-1', name: 'デモユーザー', postCount: 4, followerCount: 7, followingCount: 2, pendingRequestCount: 1);

Widget _wrap(_FakeApiClient api, {int refreshKey = 0}) => MaterialApp(
      home: Scaffold(body: TimelineScreen(refreshKey: refreshKey, apiClient: api, locationService: _FakeLocationService())),
    );

void main() {
  testWidgets('投稿がある場合はタイムラインに一覧表示される', (tester) async {
    final api = _FakeApiClient(postsToReturn: [buildPost(id: 'post-1', body: '一件目'), buildPost(id: 'post-2', body: '二件目')]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('一件目'), findsOneWidget);
    expect(find.text('二件目'), findsOneWidget);
  });

  testWidgets('投稿がない場合は空状態メッセージを表示する', (tester) async {
    final api = _FakeApiClient(postsToReturn: []);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('近くの投稿はまだありません'), findsOneWidget);
  });

  testWidgets('API通信中はローディング表示になる', (tester) async {
    final api = _FakeApiClient(postsToReturn: []);

    await tester.pumpWidget(_wrap(api));

    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('APIエラー時はエラーメッセージと再読み込みボタンを表示する', (tester) async {
    final api = _FakeApiClient(errorToThrow: Exception('通信に失敗しました'));

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('投稿を読み込めませんでした'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, '再読み込み'), findsOneWidget);
  });

  testWidgets('自分の情報がタイムライン上部に表示される', (tester) async {
    final api = _FakeApiClient(postsToReturn: [], me: me);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('公開アカウント'), findsOneWidget);
    expect(find.text('投稿 4・フォロワー 7・フォロー中 2'), findsOneWidget);
    expect(find.text('フォローリクエスト 1件'), findsOneWidget);
    expect(find.byIcon(Icons.camera_alt), findsOneWidget); // 写真変更の導線
    expect(find.byType(Switch), findsOneWidget);
  });

  testWidgets('自分の情報が取れなくてもタイムラインは表示される', (tester) async {
    final api = _FakeApiClient(postsToReturn: [buildPost(body: '本文だけ')]);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    expect(find.text('本文だけ'), findsOneWidget);
    expect(find.byType(Switch), findsNothing);
  });

  testWidgets('再読み込みで自分の情報が取れなくなったらヘッダーを消す', (tester) async {
    final api = _FakeApiClient(postsToReturn: [], me: me);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();
    expect(find.byType(Switch), findsOneWidget);

    api.me = null; // ユーザー切り替え直後に取得が失敗した状況
    await tester.pumpWidget(_wrap(api, refreshKey: 1));
    await tester.pumpAndSettle();

    expect(find.byType(Switch), findsNothing);
    expect(find.text('公開アカウント'), findsNothing);
  });

  testWidgets('スイッチで鍵アカウントに切り替えるとAPIが呼ばれ表示が変わる', (tester) async {
    final api = _FakeApiClient(postsToReturn: [], me: me);

    await tester.pumpWidget(_wrap(api));
    await tester.pumpAndSettle();

    await tester.tap(find.byType(Switch));
    await tester.pumpAndSettle();

    expect(api.privacyChanges, [true]);
    expect(find.text('鍵アカウント'), findsOneWidget);
    expect(find.text('公開アカウント'), findsNothing);
    expect(find.text('鍵アカウントにしました'), findsOneWidget);
  });
}
