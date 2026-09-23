import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:http_parser/http_parser.dart';
import 'package:image_picker/image_picker.dart';
import 'package:mime/mime.dart';
import '../models/place.dart';
import '../models/post.dart';
import '../models/user.dart';
import 'session.dart';

/// サーバーがエラーを返したときの例外。statusCode で 403(閲覧不可)などを判別できる。
class ApiException implements Exception {
  const ApiException(this.statusCode, this.message);
  final int statusCode;
  final String message;
  bool get isForbidden => statusCode == 403;
  bool get isNotFound => statusCode == 404;
  @override
  String toString() => message;
}

class LikeResult {
  const LikeResult({required this.likeCount, required this.liked});
  final int likeCount;
  final bool liked;
}

/// ユーザーの投稿一覧。鍵アカウントで閲覧できない場合は locked が true で posts は空。
class UserPostsResult {
  const UserPostsResult({required this.posts, required this.locked});
  final List<Post> posts;
  final bool locked;
}

class ApiClient {
  ApiClient({String? baseUrl})
      : baseUrl = baseUrl ??
            _configuredBaseUrl;

  /// 操作中のユーザー。認証未導入のため既定はデモユーザーで、開発用に [Session] で切り替えられる。
  static String get currentUserId => Session.instance.userId;
  static String get currentUserName => Session.instance.userName;

  static String get _configuredBaseUrl {
    const configured = String.fromEnvironment('API_BASE_URL');
    if (configured.isNotEmpty) return configured;
    return kIsWeb ? 'http://localhost:3000/api' : 'http://10.0.2.2:3000/api';
  }

  final String baseUrl;
  static const _jsonHeaders = {'Content-Type': 'application/json'};

  Future<List<Post>> fetchPosts({required double latitude, required double longitude, bool followingOnly = false}) async {
    final uri = Uri.parse('$baseUrl/posts').replace(queryParameters: {
      'latitude': '$latitude',
      'longitude': '$longitude',
      'radius': '5000',
      'sort': 'new',
      'viewerId': currentUserId,
      if (followingOnly) 'followingOf': currentUserId,
    });
    final response = await http.get(uri);
    _check(response);
    return _postList(response);
  }

  Future<Post> fetchPost(String id) async {
    final uri = Uri.parse('$baseUrl/posts/$id').replace(queryParameters: {'viewerId': currentUserId});
    final response = await http.get(uri);
    _check(response);
    return Post.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  Future<bool> isPostLiked(String id) async {
    final uri = Uri.parse('$baseUrl/posts/$id/like').replace(queryParameters: {'userId': currentUserId});
    final response = await http.get(uri);
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return json['liked'] as bool? ?? false;
  }

  Future<LikeResult> likePost(String id) async {
    final response = await http.post(
      Uri.parse('$baseUrl/posts/$id/like'),
      headers: _jsonHeaders,
      body: jsonEncode({'userId': currentUserId}),
    );
    _check(response);
    return _likeResult(response);
  }

  Future<LikeResult> unlikePost(String id) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/posts/$id/like'),
      headers: _jsonHeaders,
      body: jsonEncode({'userId': currentUserId}),
    );
    _check(response);
    return _likeResult(response);
  }

  /// 自分の投稿を削除する。
  Future<void> deletePost(String id) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/posts/$id'),
      headers: _jsonHeaders,
      body: jsonEncode({'userId': currentUserId}),
    );
    _check(response);
  }

  /// 自分のコメント(または自分の投稿へのコメント)を削除する。
  Future<void> deleteComment({required String postId, required String commentId}) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/posts/$postId/comments/$commentId'),
      headers: _jsonHeaders,
      body: jsonEncode({'userId': currentUserId}),
    );
    _check(response);
  }

  Future<Comment> addComment({required String postId, required String body}) async {
    final response = await http.post(
      Uri.parse('$baseUrl/posts/$postId/comments'),
      headers: _jsonHeaders,
      body: jsonEncode({'body': body, 'authorId': currentUserId, 'authorName': currentUserName}),
    );
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return Comment.fromJson(json['comment'] as Map<String, dynamic>);
  }

  Future<Post> createPost({
    required String body,
    required double latitude,
    required double longitude,
    XFile? image,
    String? category,
    String postType = 'normal',
    String? placeName,
    String? placeId,
    String? placeAddress,
    String? placeType,
  }) async {
    final trimmedPlace = placeName?.trim() ?? '';
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/posts'))
      ..fields.addAll({
        'authorId': currentUserId,
        'authorName': currentUserName,
        'body': body,
        'latitude': '$latitude',
        'longitude': '$longitude',
        'postType': postType,
        if (category != null && category.trim().isNotEmpty) 'category': category.trim(),
        if (trimmedPlace.isNotEmpty) 'placeName': trimmedPlace,
        if (trimmedPlace.isNotEmpty && placeId != null) 'placeId': placeId,
        if (trimmedPlace.isNotEmpty && placeAddress != null) 'placeAddress': placeAddress,
        if (trimmedPlace.isNotEmpty && placeType != null) 'placeType': placeType,
      });
    if (image != null) {
      final bytes = await image.readAsBytes();
      final mimeType = image.mimeType ?? lookupMimeType(image.name, headerBytes: bytes) ?? 'image/jpeg';
      request.files.add(http.MultipartFile.fromBytes('image', bytes, filename: image.name, contentType: MediaType.parse(mimeType)));
    }
    final response = await request.send();
    final result = await http.Response.fromStream(response);
    _check(result);
    return Post.fromJson((jsonDecode(result.body) as Map<String, dynamic>)['post'] as Map<String, dynamic>);
  }

  // ---- 周辺の施設 ----

  /// 地点の周辺(既定 300m)にある店・施設を近い順に返す。
  Future<NearbyPlacesResult> fetchNearbyPlaces({required double latitude, required double longitude, int radius = 300}) async {
    final uri = Uri.parse('$baseUrl/places/nearby').replace(queryParameters: {
      'latitude': '$latitude',
      'longitude': '$longitude',
      'radius': '$radius',
    });
    final response = await http.get(uri);
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return NearbyPlacesResult(
      places: ((json['places'] as List<dynamic>?) ?? []).map((item) => NearbyPlace.fromJson(item as Map<String, dynamic>)).toList(),
      provider: json['provider'] as String? ?? 'unknown',
    );
  }

  /// 名前で店・施設を探す(場所検索)。地点の周辺を優先して近い順に返す。
  Future<NearbyPlacesResult> searchPlaces({required String query, required double latitude, required double longitude}) async {
    final uri = Uri.parse('$baseUrl/places/search').replace(queryParameters: {
      'q': query,
      'latitude': '$latitude',
      'longitude': '$longitude',
    });
    final response = await http.get(uri);
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return NearbyPlacesResult(
      places: ((json['places'] as List<dynamic>?) ?? []).map((item) => NearbyPlace.fromJson(item as Map<String, dynamic>)).toList(),
      provider: json['provider'] as String? ?? 'unknown',
    );
  }

  /// 座標から、その地点の店名(あれば)と住所を逆引きする。
  Future<({String? name, String? address})> fetchPlaceAt({required double latitude, required double longitude}) async {
    final uri = Uri.parse('$baseUrl/places/address').replace(queryParameters: {'latitude': '$latitude', 'longitude': '$longitude'});
    final response = await http.get(uri);
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    String? clean(Object? value) => value is String && value.trim().isNotEmpty ? value.trim() : null;
    return (name: clean(json['name']), address: clean(json['address']));
  }

  /// 座標から住所を逆引きする。店名はあるのに住所が無い投稿の表示を補う。
  Future<String?> fetchAddress({required double latitude, required double longitude}) async =>
      (await fetchPlaceAt(latitude: latitude, longitude: longitude)).address;

  // ---- ユーザー / フォロー ----

  Future<List<AppUser>> fetchUsers() async {
    final uri = Uri.parse('$baseUrl/users').replace(queryParameters: {'viewerId': currentUserId});
    final response = await http.get(uri);
    _check(response);
    return _userList(response);
  }

  Future<AppUser> fetchUser(String id) async {
    final uri = Uri.parse('$baseUrl/users/$id').replace(queryParameters: {'viewerId': currentUserId});
    final response = await http.get(uri);
    _check(response);
    return AppUser.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  /// 自分(デモユーザー)の情報。
  Future<AppUser> fetchMe() => fetchUser(currentUserId);

  /// 自分のアカウントを鍵付き / 公開に切り替える。
  Future<AppUser> updatePrivacy({required bool isPrivate}) async {
    final response = await http.patch(
      Uri.parse('$baseUrl/users/$currentUserId'),
      headers: _jsonHeaders,
      body: jsonEncode({'isPrivate': isPrivate, 'userId': currentUserId}),
    );
    _check(response);
    return AppUser.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  /// 自分のプロフィール写真を登録する。
  Future<AppUser> uploadAvatar(XFile image) async {
    final request = http.MultipartRequest('POST', Uri.parse('$baseUrl/users/$currentUserId/avatar'))
      ..fields['userId'] = currentUserId;
    final bytes = await image.readAsBytes();
    final mimeType = image.mimeType ?? lookupMimeType(image.name, headerBytes: bytes) ?? 'image/jpeg';
    request.files.add(http.MultipartFile.fromBytes('image', bytes, filename: image.name, contentType: MediaType.parse(mimeType)));
    final result = await http.Response.fromStream(await request.send());
    _check(result);
    return AppUser.fromJson(jsonDecode(result.body) as Map<String, dynamic>);
  }

  /// 自分のプロフィール写真を削除する。
  Future<AppUser> removeAvatar() async {
    final response = await http.delete(
      Uri.parse('$baseUrl/users/$currentUserId/avatar'),
      headers: _jsonHeaders,
      body: jsonEncode({'userId': currentUserId}),
    );
    _check(response);
    return AppUser.fromJson(jsonDecode(response.body) as Map<String, dynamic>);
  }

  /// 指定ユーザーの投稿のうち、現在地から5km以内のものを返す。鍵アカウントで未承認なら locked。
  Future<UserPostsResult> fetchUserPosts(String id, {required double latitude, required double longitude}) async {
    final uri = Uri.parse('$baseUrl/users/$id/posts').replace(queryParameters: {
      'latitude': '$latitude',
      'longitude': '$longitude',
      'radius': '5000',
      'viewerId': currentUserId,
    });
    final response = await http.get(uri);
    _check(response);
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return UserPostsResult(
      posts: (json['posts'] as List<dynamic>).map((item) => Post.fromJson(item as Map<String, dynamic>)).toList(),
      locked: json['locked'] as bool? ?? false,
    );
  }

  Future<FollowResult> followUser(String id) async {
    final response = await http.post(
      Uri.parse('$baseUrl/users/$id/follow'),
      headers: _jsonHeaders,
      body: jsonEncode({'followerId': currentUserId}),
    );
    _check(response);
    return _followResult(response);
  }

  /// フォロー解除。未承認リクエストの取り消しも同じ。
  Future<FollowResult> unfollowUser(String id) async {
    final response = await http.delete(
      Uri.parse('$baseUrl/users/$id/follow'),
      headers: _jsonHeaders,
      body: jsonEncode({'followerId': currentUserId}),
    );
    _check(response);
    return _followResult(response);
  }

  /// 自分に届いている未承認のフォローリクエスト。
  Future<List<AppUser>> fetchFollowRequests() async {
    final response = await http.get(Uri.parse('$baseUrl/users/$currentUserId/requests'));
    _check(response);
    return _userList(response);
  }

  Future<void> approveFollowRequest(String followerId) async {
    final response = await http.post(Uri.parse('$baseUrl/users/$currentUserId/requests/$followerId/approve'));
    _check(response);
  }

  Future<void> rejectFollowRequest(String followerId) async {
    final response = await http.post(Uri.parse('$baseUrl/users/$currentUserId/requests/$followerId/reject'));
    _check(response);
  }

  List<Post> _postList(http.Response response) {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['posts'] as List<dynamic>).map((item) => Post.fromJson(item as Map<String, dynamic>)).toList();
  }

  List<AppUser> _userList(http.Response response) {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return (json['users'] as List<dynamic>).map((item) => AppUser.fromJson(item as Map<String, dynamic>)).toList();
  }

  LikeResult _likeResult(http.Response response) {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return LikeResult(
      likeCount: (json['likeCount'] as num?)?.toInt() ?? 0,
      liked: json['liked'] as bool? ?? false,
    );
  }

  FollowResult _followResult(http.Response response) {
    final json = jsonDecode(response.body) as Map<String, dynamic>;
    return FollowResult(
      following: json['following'] as bool? ?? false,
      status: json['status'] as String? ?? 'none',
      followerCount: (json['followerCount'] as num?)?.toInt() ?? 0,
    );
  }

  void _check(http.Response response) {
    if (response.statusCode >= 200 && response.statusCode < 300) return;
    // サーバーは JSON の error を返す想定だが、プロキシや想定外の失敗で HTML やテキストが返ることもある
    String? message;
    try {
      final body = jsonDecode(response.body);
      if (body is Map<String, dynamic> && body['error'] is String) message = body['error'] as String;
    } catch (_) {}
    throw ApiException(response.statusCode, message ?? '通信に失敗しました(HTTP ${response.statusCode})');
  }
}
