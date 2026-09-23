import 'package:flutter_test/flutter_test.dart';
import 'package:local_area_sns/models/post.dart';

void main() {
  group('Post.fromJson', () {
    test('parses a full post payload', () {
      final json = {
        'id': 'post-001',
        'authorId': 'demo-user-1',
        'authorName': 'デモユーザー',
        'body': 'テスト本文',
        'imageUrl': 'http://localhost:3000/uploads/sample.jpg',
        'latitude': 34.7025,
        'longitude': 135.4959,
        'category': 'カフェ',
        'placeName': 'テストカフェ',
        'placeId': 'place-1',
        'placeAddress': 'テスト市 1',
        'postType': 'realtime',
        'likeCount': 3,
        'commentCount': 1,
        'createdAt': '2026-09-09T10:00:00.000Z',
        'distanceMeters': 250.4,
        'comments': [
          {
            'id': 'comment-1',
            'postId': 'post-001',
            'authorId': 'demo-user-1',
            'authorName': 'デモユーザー',
            'body': 'いいね',
            'createdAt': '2026-09-09T10:05:00.000Z',
          },
        ],
      };

      final post = Post.fromJson(json);

      expect(post.id, 'post-001');
      expect(post.authorName, 'デモユーザー');
      expect(post.body, 'テスト本文');
      expect(post.imageUrl, 'http://localhost:3000/uploads/sample.jpg');
      expect(post.latitude, 34.7025);
      expect(post.longitude, 135.4959);
      expect(post.category, 'カフェ');
      expect(post.placeName, 'テストカフェ');
      expect(post.placeId, 'place-1');
      expect(post.placeAddress, 'テスト市 1');
      expect(post.postType, 'realtime');
      expect(post.likeCount, 3);
      expect(post.commentCount, 1);
      expect(post.distanceMeters, 250);
      expect(post.comments, hasLength(1));
      expect(post.comments.first.body, 'いいね');
    });

    test('applies defaults when optional fields are missing', () {
      final post = Post.fromJson(const {
        'id': 'post-002',
        'body': '最小構成',
        'latitude': 1.0,
        'longitude': 2.0,
      });

      expect(post.authorName, '匿名ユーザー');
      expect(post.imageUrl, isNull);
      expect(post.category, isNull);
      expect(post.placeName, isNull);
      expect(post.placeAddress, isNull);
      expect(post.postType, 'normal');
      expect(post.likeCount, 0);
      expect(post.commentCount, 0);
      expect(post.comments, isEmpty);
    });

    test('treats blank imageUrl as null', () {
      final post = Post.fromJson(const {
        'id': 'post-003',
        'body': '空文字画像',
        'latitude': 1.0,
        'longitude': 2.0,
        'imageUrl': '   ',
      });

      expect(post.imageUrl, isNull);
    });
  });

  group('Post.copyWith', () {
    test('overrides likeCount and commentCount while keeping other fields', () {
      final original = Post.fromJson(const {
        'id': 'post-004',
        'authorName': 'デモユーザー',
        'body': '本文',
        'latitude': 1.0,
        'longitude': 2.0,
        'likeCount': 1,
        'commentCount': 2,
      });

      final updated = original.copyWith(likeCount: 5);

      expect(updated.likeCount, 5);
      expect(updated.commentCount, 2);
      expect(updated.id, original.id);
      expect(updated.body, original.body);
    });
  });
}
