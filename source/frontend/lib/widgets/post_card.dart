import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/post.dart';

class PostCard extends StatelessWidget {
  const PostCard({super.key, required this.post, required this.onTap, this.onAuthorTap});
  final Post post;
  final VoidCallback onTap;
  /// 投稿者名をタップしたときの処理。null なら名前は通常のテキストになる。
  final VoidCallback? onAuthorTap;

  @override
  Widget build(BuildContext context) {
    final time = DateFormat('M/d H:mm').format(post.createdAt.toLocal());
    return Card(
      margin: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          if (post.imageUrl != null)
            Container(
              constraints: const BoxConstraints(maxHeight: 280),
              width: double.infinity,
              color: Colors.black12,
              child: Image.network(post.imageUrl!, fit: BoxFit.contain, errorBuilder: (_, __, ___) => const SizedBox(height: 80, child: Center(child: Icon(Icons.broken_image)))),
            ),
          Padding(
            padding: const EdgeInsets.all(12),
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              GestureDetector(
                onTap: onAuthorTap,
                child: Row(mainAxisSize: MainAxisSize.min, children: [
                  Text(post.authorName, style: const TextStyle(fontWeight: FontWeight.bold)),
                  if (onAuthorTap != null) ...[
                    const SizedBox(width: 4),
                    Icon(Icons.person_outline, size: 16, color: Theme.of(context).colorScheme.primary),
                  ],
                ]),
              ),
              const SizedBox(height: 6),
              if (post.postType == 'realtime' || post.category != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Wrap(spacing: 6, children: [
                    if (post.postType == 'realtime')
                      Builder(builder: (context) {
                        final remaining = post.remainingBurnAt(DateTime.now());
                        final burning = remaining > Duration.zero;
                        return Container(
                          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                          decoration: BoxDecoration(color: burning ? Colors.deepOrange : Colors.redAccent, borderRadius: BorderRadius.circular(12)),
                          child: Text(burning ? '🔥 リアルタイム(あと${remaining.inMinutes + 1}分)' : 'リアルタイム', style: const TextStyle(color: Colors.white, fontSize: 11)),
                        );
                      }),
                    if (post.category != null)
                      Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
                        decoration: BoxDecoration(color: Colors.teal.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(12)),
                        child: Text(post.category!, style: const TextStyle(color: Colors.teal, fontSize: 11)),
                      ),
                  ]),
                ),
              if (post.placeName != null)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(children: [
                    Icon(Icons.place, size: 14, color: Theme.of(context).colorScheme.primary),
                    const SizedBox(width: 4),
                    Flexible(child: Text(post.placeName!, style: Theme.of(context).textTheme.bodySmall?.copyWith(fontWeight: FontWeight.bold), overflow: TextOverflow.ellipsis)),
                  ]),
                ),
              Text(post.body, maxLines: 3, overflow: TextOverflow.ellipsis),
              const SizedBox(height: 10),
              Row(children: [
                Text(time, style: Theme.of(context).textTheme.bodySmall),
                if (post.distanceMeters != null) ...[
                  const SizedBox(width: 12),
                  Text(_distanceLabel(post.distanceMeters!), style: Theme.of(context).textTheme.bodySmall),
                ],
                const Spacer(),
                Text('♡ ${post.likeCount}'),
                const SizedBox(width: 12),
                Text('コメント ${post.commentCount}'),
              ]),
            ]),
          ),
        ]),
      ),
    );
  }

  static String _distanceLabel(int meters) => meters < 1000 ? '${meters}m' : '${(meters / 1000).toStringAsFixed(1)}km';
}
