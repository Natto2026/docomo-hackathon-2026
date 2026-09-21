import 'package:flutter/material.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/session.dart';
import 'user_avatar.dart';

/// 開発用のユーザー切り替えシート。認証が入るまでの仮機能。
class UserSwitcherSheet extends StatelessWidget {
  const UserSwitcherSheet({super.key, required this.users, required this.currentId});

  final List<AppUser> users;
  final String currentId;

  /// ユーザー一覧を取得してシートを開き、選ばれたユーザーを返す(キャンセルは null)。
  static Future<AppUser?> show(BuildContext context, ApiClient api) async {
    List<AppUser> users;
    try {
      users = await api.fetchUsers();
    } catch (_) {
      if (context.mounted) ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('ユーザー一覧を取得できませんでした')));
      return null;
    }
    if (!context.mounted) return null;
    return showModalBottomSheet<AppUser>(
      context: context,
      builder: (_) => UserSwitcherSheet(users: users, currentId: Session.instance.userId),
    );
  }

  @override
  Widget build(BuildContext context) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          const ListTile(
            title: Text('ユーザー切り替え(開発用)', style: TextStyle(fontWeight: FontWeight.bold)),
            subtitle: Text('ログイン機能が入るまでの仮の切り替えです。選ぶと全画面がそのユーザーとして読み直されます。'),
          ),
          const Divider(height: 1),
          ...users.map((user) => ListTile(
                leading: UserAvatar.of(user),
                title: Row(children: [
                  Flexible(child: Text(user.name, overflow: TextOverflow.ellipsis)),
                  if (user.isPrivate) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.lock, size: 16)),
                ]),
                subtitle: Text(user.id),
                trailing: user.id == currentId ? const Icon(Icons.check) : null,
                onTap: () => Navigator.pop(context, user),
              )),
        ]),
      );
}
