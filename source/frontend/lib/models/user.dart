/// フォロー / 解除 API の結果。
class FollowResult {
  const FollowResult({required this.following, required this.status, required this.followerCount});
  final bool following;
  /// none / pending(鍵アカウントへの未承認リクエスト) / accepted
  final String status;
  final int followerCount;
}

class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    this.bio,
    this.avatarUrl,
    this.isPrivate = false,
    this.postCount = 0,
    this.followerCount = 0,
    this.followingCount = 0,
    this.isFollowing = false,
    this.followStatus = 'none',
    this.canViewPosts = true,
    this.pendingRequestCount = 0,
  });

  final String id;
  final String name;
  final String? bio;
  /// プロフィール写真の URL。未設定なら null。
  final String? avatarUrl;
  /// 鍵アカウントかどうか
  final bool isPrivate;
  final int postCount;
  final int followerCount;
  final int followingCount;
  /// 自分がこのユーザーを(承認済みで)フォローしているか
  final bool isFollowing;
  /// none / pending / accepted
  final String followStatus;
  /// 自分がこのユーザーの投稿を見られるか(公開 / 本人 / 承認済みフォロワー)
  final bool canViewPosts;
  /// このユーザーに届いている未承認のフォローリクエスト数(自分の情報でのみ意味がある)
  final int pendingRequestCount;

  bool get isPending => followStatus == 'pending';

  /// アバター用の頭文字。絵文字などサロゲートペアも1文字として扱う。
  static String initialOf(String name) {
    final trimmed = name.trim();
    return trimmed.isEmpty ? '?' : String.fromCharCode(trimmed.runes.first);
  }

  String get initial => initialOf(name);

  AppUser copyWith({
    bool? isPrivate,
    int? followerCount,
    int? followingCount,
    bool? isFollowing,
    String? followStatus,
    bool? canViewPosts,
    int? pendingRequestCount,
  }) =>
      AppUser(
        id: id,
        name: name,
        bio: bio,
        avatarUrl: avatarUrl,
        isPrivate: isPrivate ?? this.isPrivate,
        postCount: postCount,
        followerCount: followerCount ?? this.followerCount,
        followingCount: followingCount ?? this.followingCount,
        isFollowing: isFollowing ?? this.isFollowing,
        followStatus: followStatus ?? this.followStatus,
        canViewPosts: canViewPosts ?? this.canViewPosts,
        pendingRequestCount: pendingRequestCount ?? this.pendingRequestCount,
      );

  /// フォロー / 解除 API の結果をこのユーザーに反映する。
  AppUser applyFollow(FollowResult result) => copyWith(
        isFollowing: result.following,
        followStatus: result.status,
        followerCount: result.followerCount,
        canViewPosts: !isPrivate || result.following,
      );

  static String? _nonEmpty(Object? value) {
    if (value is! String) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  factory AppUser.fromJson(Map<String, dynamic> json) {
    final isPrivate = json['isPrivate'] as bool? ?? false;
    final isFollowing = json['isFollowing'] as bool? ?? false;
    return AppUser(
      id: json['id'] as String? ?? '',
      name: json['name'] as String? ?? '匿名ユーザー',
      bio: _nonEmpty(json['bio']),
      avatarUrl: _nonEmpty(json['avatarUrl']),
      isPrivate: isPrivate,
      postCount: (json['postCount'] as num?)?.toInt() ?? 0,
      followerCount: (json['followerCount'] as num?)?.toInt() ?? 0,
      followingCount: (json['followingCount'] as num?)?.toInt() ?? 0,
      isFollowing: isFollowing,
      followStatus: json['followStatus'] as String? ?? (isFollowing ? 'accepted' : 'none'),
      canViewPosts: json['canViewPosts'] as bool? ?? (!isPrivate || isFollowing),
      pendingRequestCount: (json['pendingRequestCount'] as num?)?.toInt() ?? 0,
    );
  }
}
