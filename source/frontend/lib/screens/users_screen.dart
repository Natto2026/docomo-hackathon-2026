import 'package:flutter/material.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../widgets/follow_button.dart';
import '../widgets/user_avatar.dart';
import 'user_profile_screen.dart';

/// ユーザー一覧。ここからフォロー / リクエスト / 解除とプロフィール閲覧ができる。
class UsersScreen extends StatefulWidget {
  UsersScreen({super.key, required this.refreshKey, this.visible = true, ApiClient? apiClient}) : api = apiClient ?? ApiClient();
  final int refreshKey;
  /// タブとして表示中か。非表示から表示に変わったとき読み直す。
  final bool visible;
  final ApiClient api;
  @override State<UsersScreen> createState() => _UsersScreenState();
}

class _UsersScreenState extends State<UsersScreen> {
  List<AppUser> users = [];
  bool loading = true;
  String? error;
  final busy = <String>{};

  @override void initState() { super.initState(); load(); }
  @override
  void didUpdateWidget(covariant UsersScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final becameVisible = !oldWidget.visible && widget.visible;
    if (oldWidget.refreshKey != widget.refreshKey || becameVisible) load();
  }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final result = await widget.api.fetchUsers();
      if (mounted) setState(() => users = result);
    } catch (_) {
      if (mounted) setState(() => error = 'ユーザーを読み込めませんでした');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> toggleFollow(AppUser user) async {
    if (busy.contains(user.id)) return;
    setState(() => busy.add(user.id));
    try {
      final result = (user.isFollowing || user.isPending)
          ? await widget.api.unfollowUser(user.id)
          : await widget.api.followUser(user.id);
      if (mounted) {
        setState(() => users = users.map((item) => item.id == user.id ? item.applyFollow(result) : item).toList());
        if (result.status == 'pending') {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${user.name}さんにフォローをリクエストしました')));
        }
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => busy.remove(user.id));
    }
  }

  Future<void> openProfile(AppUser user) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => UserProfileScreen(userId: user.id)));
    if (mounted) load();
  }

  @override
  Widget build(BuildContext context) {
    if (loading && users.isEmpty) return const Center(child: CircularProgressIndicator());
    if (error != null && users.isEmpty) {
      return Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(error!),
          const SizedBox(height: 8),
          FilledButton(onPressed: load, child: const Text('再読み込み')),
        ]),
      );
    }
    return SafeArea(
      bottom: false,
      child: RefreshIndicator(
        onRefresh: load,
        child: ListView.separated(
          itemCount: users.length + 1,
          separatorBuilder: (_, index) => index == 0 ? const SizedBox.shrink() : const Divider(height: 1),
          itemBuilder: (context, index) {
            if (index == 0) {
              return const Padding(
                padding: EdgeInsets.fromLTRB(16, 16, 16, 8),
                child: Text('ユーザー', style: TextStyle(fontSize: 20, fontWeight: FontWeight.bold)),
              );
            }
            final user = users[index - 1];
            final isSelf = user.id == ApiClient.currentUserId;
            return ListTile(
              leading: UserAvatar.of(user),
              title: Row(children: [
                Flexible(child: Text(user.name, overflow: TextOverflow.ellipsis)),
                if (user.isPrivate) const Padding(padding: EdgeInsets.only(left: 4), child: Icon(Icons.lock, size: 16)),
              ]),
              subtitle: Text('投稿 ${user.postCount}・フォロワー ${user.followerCount}'),
              trailing: isSelf
                  ? const Text('あなた')
                  : FollowButton(user: user, busy: busy.contains(user.id), compact: true, onPressed: () => toggleFollow(user)),
              onTap: () => openProfile(user),
            );
          },
        ),
      ),
    );
  }
}
