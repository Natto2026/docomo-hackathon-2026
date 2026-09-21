import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/user.dart';

void main() {
  test('AppUser.fromJson が全項目を読み取る', () {
    final user = AppUser.fromJson({
      'id': 'demo-user-2',
      'name': 'さくら',
      'bio': ' カフェ好き ',
      'avatarUrl': 'http://localhost:3000/uploads/a.png',
      'isPrivate': true,
      'postCount': 3,
      'followerCount': 2,
      'followingCount': 1,
      'isFollowing': false,
      'followStatus': 'pending',
      'canViewPosts': false,
      'pendingRequestCount': 4,
    });

    expect(user.id, 'demo-user-2');
    expect(user.name, 'さくら');
    expect(user.bio, 'カフェ好き');
    expect(user.avatarUrl, 'http://localhost:3000/uploads/a.png');
    expect(user.isPrivate, isTrue);
    expect(user.postCount, 3);
    expect(user.followerCount, 2);
    expect(user.followingCount, 1);
    expect(user.isFollowing, isFalse);
    expect(user.isPending, isTrue);
    expect(user.canViewPosts, isFalse);
    expect(user.pendingRequestCount, 4);
  });

  test('AppUser.fromJson は欠けている項目に既定値を使う', () {
    final user = AppUser.fromJson({'id': 'x'});

    expect(user.name, '匿名ユーザー');
    expect(user.bio, isNull);
    expect(user.avatarUrl, isNull);
    expect(user.isPrivate, isFalse);
    expect(user.postCount, 0);
    expect(user.followerCount, 0);
    expect(user.followingCount, 0);
    expect(user.isFollowing, isFalse);
    expect(user.followStatus, 'none');
    expect(user.canViewPosts, isTrue);
    expect(user.pendingRequestCount, 0);
  });

  test('copyWith はフォロー状態とフォロワー数だけを更新する', () {
    const user = AppUser(id: 'u', name: 'たろう', postCount: 5, followerCount: 1);
    final updated = user.copyWith(isFollowing: true, followStatus: 'accepted', followerCount: 2);

    expect(updated.isFollowing, isTrue);
    expect(updated.followStatus, 'accepted');
    expect(updated.followerCount, 2);
    expect(updated.postCount, 5);
    expect(updated.name, 'たろう');
  });

  test('applyFollow は鍵アカウントへのリクエストでは閲覧不可のままにする', () {
    const locked = AppUser(id: 'p', name: '鍵', isPrivate: true, canViewPosts: false);
    final pending = locked.applyFollow(const FollowResult(following: false, status: 'pending', followerCount: 0));
    expect(pending.isPending, isTrue);
    expect(pending.canViewPosts, isFalse);

    final accepted = locked.applyFollow(const FollowResult(following: true, status: 'accepted', followerCount: 1));
    expect(accepted.isFollowing, isTrue);
    expect(accepted.canViewPosts, isTrue);
    expect(accepted.followerCount, 1);
  });

  test('initial は名前の先頭1文字を返し、空なら ? を返す', () {
    expect(const AppUser(id: 'a', name: 'さくら').initial, 'さ');
    expect(const AppUser(id: 'b', name: '🍣ずし').initial, '🍣');
    expect(AppUser.initialOf('   '), '?');
  });
}
