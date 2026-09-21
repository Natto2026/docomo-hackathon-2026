import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/post.dart';
import 'user_avatar.dart';

/// 地図のピンを押したときに下に出すカード。投稿内容だけを並べる(店名・住所はピンの上の吹き出しに出す)。
class MapSelectionCard extends StatefulWidget {
  const MapSelectionCard({super.key, required this.posts, required this.onOpenPost, required this.onClose, this.headerTitle, this.headerSubtitle, this.now});

  /// 同じピンにまとまった投稿(新しい順)。
  final List<Post> posts;
  final void Function(Post post) onOpenPost;
  final VoidCallback onClose;
  /// Google の店カードが出なかったときだけ、店名・住所をここに補う(通常は null)。
  final String? headerTitle;
  final String? headerSubtitle;
  /// テスト用に現在時刻を差し替えられる。
  final DateTime? now;

  /// 最初に見せる投稿の件数。超えた分は「他 n件を見る」で開く。
  static const collapsedCount = 3;

  @override
  State<MapSelectionCard> createState() => _MapSelectionCardState();
}

class _MapSelectionCardState extends State<MapSelectionCard> {
  bool expanded = false;

  DateTime get now => widget.now ?? DateTime.now();

  Widget _badge(Post post) {
    if (post.postType != 'realtime') return const SizedBox.shrink();
    final remaining = post.remainingBurnAt(now);
    final burning = remaining > Duration.zero;
    return Container(
      margin: const EdgeInsets.only(left: 6),
      padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 1),
      decoration: BoxDecoration(color: burning ? Colors.deepOrange : Colors.redAccent, borderRadius: BorderRadius.circular(10)),
      child: Text(burning ? '🔥 あと${remaining.inMinutes + 1}分' : 'リアルタイム', style: const TextStyle(color: Colors.white, fontSize: 10)),
    );
  }

  Widget _postRow(BuildContext context, Post post) {
    final small = Theme.of(context).textTheme.bodySmall;
    return InkWell(
      onTap: () => widget.onOpenPost(post),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          UserAvatar(name: post.authorName, radius: 14),
          const SizedBox(width: 8),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Row(children: [
                Flexible(child: Text(post.authorName, style: const TextStyle(fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis)),
                _badge(post),
                const Spacer(),
                Text(DateFormat('M/d H:mm').format(post.createdAt.toLocal()), style: small),
              ]),
              Text(post.body, maxLines: 2, overflow: TextOverflow.ellipsis),
              Text('♡ ${post.likeCount}・コメント ${post.commentCount}', style: small),
            ]),
          ),
          const Icon(Icons.chevron_right, size: 18),
        ]),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final small = Theme.of(context).textTheme.bodySmall;
    final posts = widget.posts;
    final visible = expanded ? posts : posts.take(MapSelectionCard.collapsedCount).toList();
    final hidden = posts.length - visible.length;

    return Card(
      elevation: 6,
      child: ConstrainedBox(
        constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.4),
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(12, 4, 4, 0),
            child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Expanded(
                child: widget.headerTitle != null
                    ? Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text(widget.headerTitle!, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 15)),
                        if (widget.headerSubtitle != null) Text(widget.headerSubtitle!, style: small, maxLines: 2, overflow: TextOverflow.ellipsis),
                        Text('投稿 ${posts.length}件', style: small),
                      ])
                    : Padding(padding: const EdgeInsets.only(top: 8), child: Text('投稿 ${posts.length}件', style: small)),
              ),
              IconButton(tooltip: '閉じる', visualDensity: VisualDensity.compact, onPressed: widget.onClose, icon: const Icon(Icons.close, size: 20)),
            ]),
          ),
          Flexible(
            child: SingleChildScrollView(
              padding: const EdgeInsets.fromLTRB(12, 0, 12, 8),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                for (var i = 0; i < visible.length; i++) ...[
                  if (i > 0) const Divider(height: 1),
                  _postRow(context, visible[i]),
                ],
                if (hidden > 0)
                  Center(child: TextButton(onPressed: () => setState(() => expanded = true), child: Text('他 $hidden件を見る'))),
              ]),
            ),
          ),
        ]),
      ),
    );
  }
}
