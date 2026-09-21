import 'package:flutter/material.dart';
import '../models/user.dart';
import 'user_avatar.dart';

/// タイムライン上部に出す自分の情報。鍵アカウントの切り替えとフォローリクエストへの導線を持つ。
class MyProfileHeader extends StatelessWidget {
  const MyProfileHeader({
    super.key,
    required this.user,
    required this.onPrivacyChanged,
    required this.onOpenRequests,
    required this.onOpenProfile,
    this.onSwitchUser,
    this.onChangeAvatar,
    this.busy = false,
  });

  final AppUser user;
  final ValueChanged<bool> onPrivacyChanged;
  final VoidCallback onOpenRequests;
  final VoidCallback onOpenProfile;
  /// 開発用のユーザー切り替え。null なら切り替えボタンを出さない。
  final VoidCallback? onSwitchUser;
  /// プロフィール写真の変更。null なら写真アイコンをタップしても何もしない。
  final VoidCallback? onChangeAvatar;
  final bool busy;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final small = theme.textTheme.bodySmall;
    return Card(
      margin: const EdgeInsets.fromLTRB(12, 12, 12, 4),
      child: Padding(
        padding: const EdgeInsets.fromLTRB(12, 12, 4, 4),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Row(children: [
            GestureDetector(
              onTap: onChangeAvatar,
              child: Stack(clipBehavior: Clip.none, children: [
                UserAvatar.of(user, radius: 24),
                if (onChangeAvatar != null)
                  Positioned(
                    right: -2,
                    bottom: -2,
                    child: Container(
                      padding: const EdgeInsets.all(3),
                      decoration: BoxDecoration(shape: BoxShape.circle, color: theme.colorScheme.primary),
                      child: Icon(Icons.camera_alt, size: 12, color: theme.colorScheme.onPrimary),
                    ),
                  ),
              ]),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: InkWell(
                onTap: onOpenProfile,
                borderRadius: BorderRadius.circular(8),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Row(children: [
                    Flexible(child: Text(user.name, style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16), overflow: TextOverflow.ellipsis)),
                    if (user.isPrivate) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.lock, size: 16)),
                  ]),
                  Text(user.isPrivate ? '鍵アカウント' : '公開アカウント', style: small),
                  Text('投稿 ${user.postCount}・フォロワー ${user.followerCount}・フォロー中 ${user.followingCount}', style: small, maxLines: 1, overflow: TextOverflow.ellipsis),
                ]),
              ),
            ),
            if (onSwitchUser != null)
              IconButton(
                tooltip: 'ユーザー切り替え(開発用)',
                onPressed: onSwitchUser,
                icon: const Icon(Icons.swap_horiz),
              ),
            IconButton(
              tooltip: 'プロフィールを開く',
              onPressed: onOpenProfile,
              icon: const Icon(Icons.chevron_right),
            ),
          ]),
          SwitchListTile(
            contentPadding: const EdgeInsets.only(right: 8),
            dense: true,
            secondary: const Icon(Icons.lock_outline),
            title: const Text('鍵アカウントにする'),
            subtitle: Text(user.isPrivate ? '承認したフォロワーだけが投稿を見られます' : '誰でも投稿を見られます', style: small),
            value: user.isPrivate,
            onChanged: busy ? null : onPrivacyChanged,
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: onOpenRequests,
              icon: const Icon(Icons.person_add_alt_1, size: 18),
              label: Text(user.pendingRequestCount > 0 ? 'フォローリクエスト ${user.pendingRequestCount}件' : 'フォローリクエスト'),
            ),
          ),
        ]),
      ),
    );
  }
}
