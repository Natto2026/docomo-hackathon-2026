import 'place.dart';

class Comment {
  const Comment({required this.id, required this.postId, required this.authorId, required this.authorName, required this.body, required this.createdAt});
  final String id;
  final String postId;
  final String authorId;
  final String authorName;
  final String body;
  final DateTime createdAt;

  factory Comment.fromJson(Map<String, dynamic> json) => Comment(
    id: json['id'] as String? ?? '',
    postId: json['postId'] as String? ?? '',
    authorId: json['authorId'] as String? ?? '',
    authorName: json['authorName'] as String? ?? '匿名ユーザー',
    body: json['body'] as String? ?? '',
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
  );
}

class Post {
  const Post({
    required this.id,
    required this.authorId,
    required this.authorName,
    required this.body,
    this.imageUrl,
    required this.latitude,
    required this.longitude,
    this.category,
    this.placeName,
    this.placeId,
    this.placeAddress,
    this.placeType,
    required this.postType,
    required this.likeCount,
    required this.commentCount,
    required this.createdAt,
    this.distanceMeters,
    this.comments = const [],
  });
  final String id;
  final String authorId;
  final String authorName;
  final String body;
  final String? imageUrl;
  final double latitude;
  final double longitude;
  final String? category;
  /// 投稿場所の店・施設名(任意)
  final String? placeName;
  final String? placeId;
  final String? placeAddress;
  /// 施設の種類(cafe など)。表示には [placeTypeLabel] を使う
  final String? placeType;
  final String postType;
  final int likeCount;
  final int commentCount;
  final DateTime createdAt;
  final int? distanceMeters;
  final List<Comment> comments;

  /// 同じ店の投稿を地図上でまとめるためのキー。店が無ければ投稿ごと。
  String get placeKey => placeId ?? (placeName != null ? 'name:$placeName' : 'post:$id');
  String? get placeTypeText => placeTypeLabel(placeType);

  /// リアルタイム投稿が地図上で「燃える」時間。
  static const burnDuration = Duration(hours: 1);

  /// [now] の時点で燃えているか(リアルタイム投稿かつ投稿から1時間以内)。
  bool burningAt(DateTime now) {
    if (postType != 'realtime') return false;
    final elapsed = now.difference(createdAt);
    return !elapsed.isNegative && elapsed < burnDuration;
  }

  bool get isBurning => burningAt(DateTime.now());

  /// 燃え残り時間。燃えていなければ 0。
  Duration remainingBurnAt(DateTime now) {
    if (!burningAt(now)) return Duration.zero;
    return burnDuration - now.difference(createdAt);
  }

  Post copyWith({
    int? likeCount,
    int? commentCount,
    List<Comment>? comments,
  }) => Post(
    id: id,
    authorId: authorId,
    authorName: authorName,
    body: body,
    imageUrl: imageUrl,
    latitude: latitude,
    longitude: longitude,
    category: category,
    placeName: placeName,
    placeId: placeId,
    placeAddress: placeAddress,
    placeType: placeType,
    postType: postType,
    likeCount: likeCount ?? this.likeCount,
    commentCount: commentCount ?? this.commentCount,
    createdAt: createdAt,
    distanceMeters: distanceMeters,
    comments: comments ?? this.comments,
  );

  static String? _nonEmpty(Object? value) {
    if (value is! String) return null;
    final trimmed = value.trim();
    return trimmed.isEmpty ? null : trimmed;
  }

  factory Post.fromJson(Map<String, dynamic> json) => Post(
    id: json['id'] as String? ?? '',
    authorId: json['authorId'] as String? ?? '',
    authorName: json['authorName'] as String? ?? '匿名ユーザー',
    body: json['body'] as String? ?? '',
    imageUrl: _nonEmpty(json['imageUrl']),
    latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
    longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
    category: json['category'] as String?,
    placeName: _nonEmpty(json['placeName']),
    placeId: _nonEmpty(json['placeId']),
    placeAddress: _nonEmpty(json['placeAddress']),
    placeType: _nonEmpty(json['placeType']),
    postType: json['postType'] as String? ?? 'normal',
    likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
    commentCount: (json['commentCount'] as num?)?.toInt() ?? 0,
    createdAt: DateTime.tryParse(json['createdAt'] as String? ?? '') ?? DateTime.fromMillisecondsSinceEpoch(0),
    distanceMeters: (json['distanceMeters'] as num?)?.round(),
    comments: ((json['comments'] as List<dynamic>?) ?? []).whereType<Map<String, dynamic>>().map(Comment.fromJson).toList(),
  );
}
