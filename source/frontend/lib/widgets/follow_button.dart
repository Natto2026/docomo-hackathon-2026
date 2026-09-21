import 'package:flutter/material.dart';
import '../models/user.dart';

/// フォロー状態に応じて表示が変わるボタン。
/// - 未フォロー: 「フォロー」(相手が鍵アカウントなら「フォローをリクエスト」)
/// - リクエスト中: 「リクエスト済み」(押すと取り消し)
/// - フォロー中: 「フォロー中」(押すと解除)
class FollowButton extends StatelessWidget {
  const FollowButton({super.key, required this.user, required this.onPressed, this.busy = false, this.compact = false});

  final AppUser user;
  final VoidCallback onPressed;
  final bool busy;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final style = compact ? const ButtonStyle(visualDensity: VisualDensity.compact) : null;
    final onTap = busy ? null : onPressed;
    if (user.isFollowing) {
      return OutlinedButton.icon(
        style: style,
        onPressed: onTap,
        icon: const Icon(Icons.check, size: 18),
        label: const Text('フォロー中'),
      );
    }
    if (user.isPending) {
      return OutlinedButton.icon(
        style: style,
        onPressed: onTap,
        icon: const Icon(Icons.hourglass_top, size: 18),
        label: const Text('リクエスト済み'),
      );
    }
    if (user.isPrivate) {
      return FilledButton.icon(
        style: style,
        onPressed: onTap,
        icon: const Icon(Icons.lock_outline, size: 18),
        label: Text(compact ? 'リクエスト' : 'フォローをリクエスト'),
      );
    }
    return FilledButton.icon(
      style: style,
      onPressed: onTap,
      icon: const Icon(Icons.person_add_alt_1, size: 18),
      label: const Text('フォロー'),
    );
  }
}
