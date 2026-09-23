import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:intl/intl.dart';
import '../models/post.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/map_links.dart';
import '../widgets/follow_button.dart';
import '../widgets/user_avatar.dart';
import 'user_profile_screen.dart';

/// 投稿詳細。投稿を削除したときは Navigator.pop(context, true) で戻る。
class PostDetailScreen extends StatefulWidget {
  const PostDetailScreen({super.key, required this.post});
  final Post post;

  @override
  State<PostDetailScreen> createState() => _PostDetailScreenState();
}

class _PostDetailScreenState extends State<PostDetailScreen> {
  final api = ApiClient();
  final commentController = TextEditingController();
  late Post post = widget.post;
  AppUser? author;
  bool loading = true;
  bool liking = false;
  bool liked = false;
  bool commenting = false;
  bool followBusy = false;
  bool deleting = false;
  /// 鍵アカウントの投稿で、閲覧が許可されなくなった(403)
  bool locked = false;
  String? error;

  bool get isOwner => post.authorId == ApiClient.currentUserId;

  @override
  void initState() {
    super.initState();
    refresh();
  }

  @override
  void dispose() {
    commentController.dispose();
    super.dispose();
  }

  Future<void> refresh() async {
    setState(() { loading = true; error = null; });
    try {
      final latest = await api.fetchPost(widget.post.id);
      final currentLiked = await api.isPostLiked(widget.post.id);
      if (mounted) {
        setState(() {
          post = latest;
          liked = currentLiked;
          locked = false;
        });
      }
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.isForbidden) {
        setState(() => locked = true);
      } else {
        setState(() => error = e.isNotFound ? 'この投稿は削除されています' : e.message);
      }
    } catch (_) {
      if (mounted) setState(() => error = '投稿の最新情報を取得できませんでした');
    } finally {
      if (mounted) setState(() => loading = false);
    }
    // 投稿者情報は取れなくても詳細表示には影響させない。
    try {
      final profile = await api.fetchUser(post.authorId);
      if (mounted) setState(() => author = profile);
    } catch (_) {}
  }

  Future<void> like() async {
    if (liking) return;
    setState(() => liking = true);
    try {
      final result = liked ? await api.unlikePost(post.id) : await api.likePost(post.id);
      if (mounted) {
        setState(() {
          post = post.copyWith(likeCount: result.likeCount);
          liked = result.liked;
        });
      }
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => liking = false);
    }
  }

  Future<void> toggleFollow() async {
    final target = author;
    if (target == null || followBusy) return;
    setState(() => followBusy = true);
    try {
      final result = (target.isFollowing || target.isPending) ? await api.unfollowUser(target.id) : await api.followUser(target.id);
      if (mounted) setState(() => author = target.applyFollow(result));
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => followBusy = false);
    }
  }

  Future<void> openAuthorProfile() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => UserProfileScreen(userId: post.authorId)));
    if (mounted) refresh();
  }

  Future<bool> confirm(String title, String message) async {
    final result = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(onPressed: () => Navigator.pop(dialogContext, false), child: const Text('キャンセル')),
          FilledButton(onPressed: () => Navigator.pop(dialogContext, true), child: const Text('削除する')),
        ],
      ),
    );
    return result ?? false;
  }

  /// 自分の投稿を削除して一覧へ戻る。
  Future<void> deletePost() async {
    if (deleting) return;
    if (!await confirm('投稿を削除', 'この投稿を削除します。元に戻せません。')) return;
    if (!mounted) return;
    setState(() { deleting = true; error = null; });
    try {
      await api.deletePost(post.id);
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('投稿を削除しました')));
      Navigator.pop(context, true);
    } catch (e) {
      if (mounted) setState(() { error = e.toString().replaceFirst('Exception: ', ''); deleting = false; });
    }
  }

  Future<void> deleteComment(Comment comment) async {
    if (!await confirm('コメントを削除', 'このコメントを削除します。')) return;
    if (!mounted) return;
    try {
      await api.deleteComment(postId: post.id, commentId: comment.id);
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    }
  }

  Future<void> addComment() async {
    final body = commentController.text.trim();
    if (body.isEmpty || body.length > 300) {
      setState(() => error = 'コメントは1〜300文字で入力してください');
      return;
    }
    setState(() { commenting = true; error = null; });
    try {
      await api.addComment(postId: post.id, body: body);
      commentController.clear();
      await refresh();
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => commenting = false);
    }
  }

  Widget _authorRow() => Row(children: [
        Expanded(
          child: InkWell(
            onTap: openAuthorProfile,
            borderRadius: BorderRadius.circular(8),
            child: Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(mainAxisSize: MainAxisSize.min, children: [
                UserAvatar(name: post.authorName, avatarUrl: author?.avatarUrl, radius: 14),
                const SizedBox(width: 8),
                Flexible(child: Text(post.authorName, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16))),
                const Icon(Icons.chevron_right, size: 18),
              ]),
            ),
          ),
        ),
        if (author != null && !isOwner)
          FollowButton(user: author!, busy: followBusy, compact: true, onPressed: toggleFollow),
      ]);

  Widget _lockedBody(BuildContext context) => Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.lock_outline, size: 48),
            const SizedBox(height: 12),
            const Text('この投稿は鍵アカウントのものです', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16)),
            const SizedBox(height: 4),
            Text('${post.authorName}さんのフォローが承認されると見られるようになります', textAlign: TextAlign.center, style: Theme.of(context).textTheme.bodySmall),
            const SizedBox(height: 16),
            Wrap(spacing: 8, children: [
              OutlinedButton(onPressed: openAuthorProfile, child: const Text('プロフィールを見る')),
              FilledButton(onPressed: () => Navigator.pop(context), child: const Text('戻る')),
            ]),
          ]),
        ),
      );

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: const Text('投稿詳細'),
      actions: [
        if (isOwner && !locked)
          IconButton(tooltip: '投稿を削除', onPressed: deleting ? null : deletePost, icon: const Icon(Icons.delete_outline)),
        IconButton(onPressed: loading ? null : refresh, icon: const Icon(Icons.refresh)),
      ],
    ),
    body: locked
        ? _lockedBody(context)
        : Stack(children: [
      ListView(children: [
        if (post.imageUrl != null)
          Container(
            constraints: const BoxConstraints(maxHeight: 420),
            width: double.infinity,
            color: Colors.black12,
            child: Image.network(post.imageUrl!, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const SizedBox(height: 120, child: Center(child: Icon(Icons.broken_image)))),
          ),
        Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          _authorRow(),
          const SizedBox(height: 8),
          Row(children: [
            if (post.postType == 'realtime')
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: Colors.redAccent, borderRadius: BorderRadius.circular(12)),
                child: const Text('リアルタイム', style: TextStyle(color: Colors.white, fontSize: 11)),
              ),
            if (post.postType == 'realtime' && post.category != null) const SizedBox(width: 6),
            if (post.category != null)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                decoration: BoxDecoration(color: Colors.teal.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                child: Text(post.category!, style: const TextStyle(color: Colors.teal, fontSize: 11)),
              ),
          ]),
          const SizedBox(height: 10), Text(post.body, style: const TextStyle(fontSize: 18)),
          const SizedBox(height: 12), Text(DateFormat('yyyy年M月d日 H:mm').format(post.createdAt.toLocal())),
          if (post.distanceMeters != null) Text('現在地から ${_distance(post.distanceMeters!)}'),
          const SizedBox(height: 12),
          Row(children: [FilledButton.icon(onPressed: liking ? null : like, icon: Icon(liked ? Icons.favorite : Icons.favorite_border), label: Text(liked ? 'いいねを取り消す ${post.likeCount}' : 'いいね ${post.likeCount}')), const SizedBox(width: 12), Text('コメント ${post.commentCount}')]),
          if (error != null) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(error!, style: const TextStyle(color: Colors.red))),
          const SizedBox(height: 20),
          Row(children: [
            const Text('投稿場所', style: TextStyle(fontWeight: FontWeight.bold)),
            const Spacer(),
            TextButton.icon(
              onPressed: () => openInGoogleMaps(latitude: post.latitude, longitude: post.longitude, name: post.placeName, placeId: post.placeId),
              icon: const Icon(Icons.open_in_new, size: 16),
              label: const Text('Google マップで開く'),
            ),
          ]),
          if (post.placeName != null) ...[
            Row(children: [
              Icon(Icons.place, size: 18, color: Theme.of(context).colorScheme.primary),
              const SizedBox(width: 4),
              Expanded(child: Text(post.placeName!, style: const TextStyle(fontWeight: FontWeight.bold))),
            ]),
            if (post.placeTypeText != null || post.placeAddress != null)
              Padding(
                padding: const EdgeInsets.only(left: 22),
                child: Text([if (post.placeTypeText != null) post.placeTypeText!, if (post.placeAddress != null) post.placeAddress!].join('・'), style: Theme.of(context).textTheme.bodySmall),
              ),
            const SizedBox(height: 8),
          ],
          ClipRRect(
            borderRadius: BorderRadius.circular(8),
            child: SizedBox(
              height: 160,
              child: GoogleMap(
                initialCameraPosition: CameraPosition(target: LatLng(post.latitude, post.longitude), zoom: 15),
                markers: {Marker(markerId: MarkerId(post.id), position: LatLng(post.latitude, post.longitude))},
                zoomControlsEnabled: false,
                scrollGesturesEnabled: false,
                rotateGesturesEnabled: false,
                tiltGesturesEnabled: false,
                zoomGesturesEnabled: false,
              ),
            ),
          ),
          const SizedBox(height: 8),
          Text('緯度 ${post.latitude.toStringAsFixed(6)} / 経度 ${post.longitude.toStringAsFixed(6)}', style: Theme.of(context).textTheme.bodySmall),
          const SizedBox(height: 20), const Text('コメント', style: TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(height: 8), TextField(controller: commentController, maxLength: 300, maxLines: 3, decoration: const InputDecoration(hintText: 'コメントを入力', border: OutlineInputBorder())),
          Align(alignment: Alignment.centerRight, child: FilledButton(onPressed: commenting ? null : addComment, child: Text(commenting ? '送信中...' : 'コメントする'))),
          if (post.comments.isEmpty) const Padding(padding: EdgeInsets.symmetric(vertical: 16), child: Text('まだコメントはありません')),
          ...post.comments.map((comment) => ListTile(
                contentPadding: EdgeInsets.zero,
                title: Text(comment.authorName),
                subtitle: Text(comment.body),
                trailing: (comment.authorId == ApiClient.currentUserId || isOwner)
                    ? IconButton(tooltip: 'コメントを削除', icon: const Icon(Icons.delete_outline, size: 20), onPressed: () => deleteComment(comment))
                    : null,
              )),
        ])),
      ]),
      if (loading) const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator()),
    ]),
  );

  static String _distance(int meters) => meters < 1000 ? '${meters}m' : '${(meters / 1000).toStringAsFixed(1)}km';
}
