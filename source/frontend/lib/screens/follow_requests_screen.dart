import 'package:flutter/material.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../widgets/user_avatar.dart';
import 'user_profile_screen.dart';

/// 自分に届いたフォローリクエストを承認 / 拒否する画面。
class FollowRequestsScreen extends StatefulWidget {
  FollowRequestsScreen({super.key, ApiClient? apiClient}) : api = apiClient ?? ApiClient();
  final ApiClient api;
  @override State<FollowRequestsScreen> createState() => _FollowRequestsScreenState();
}

class _FollowRequestsScreenState extends State<FollowRequestsScreen> {
  List<AppUser> requests = [];
  bool loading = true;
  String? error;
  final busy = <String>{};

  @override void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final result = await widget.api.fetchFollowRequests();
      if (mounted) setState(() => requests = result);
    } catch (_) {
      if (mounted) setState(() => error = 'フォローリクエストを読み込めませんでした');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> respond(AppUser user, {required bool approve}) async {
    if (busy.contains(user.id)) return;
    setState(() => busy.add(user.id));
    try {
      if (approve) {
        await widget.api.approveFollowRequest(user.id);
      } else {
        await widget.api.rejectFollowRequest(user.id);
      }
      if (mounted) {
        setState(() => requests = requests.where((item) => item.id != user.id).toList());
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(approve ? '${user.name}さんをフォロワーに追加しました' : '${user.name}さんのリクエストを拒否しました')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => busy.remove(user.id));
    }
  }

  @override
  Widget build(BuildContext context) {
    Widget body;
    if (loading && requests.isEmpty) {
      body = const Center(child: CircularProgressIndicator());
    } else if (error != null && requests.isEmpty) {
      body = Center(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          Text(error!),
          const SizedBox(height: 8),
          FilledButton(onPressed: load, child: const Text('再読み込み')),
        ]),
      );
    } else if (requests.isEmpty) {
      body = const Center(child: Text('新しいフォローリクエストはありません'));
    } else {
      body = RefreshIndicator(
        onRefresh: load,
        child: ListView.separated(
          itemCount: requests.length,
          separatorBuilder: (_, __) => const Divider(height: 1),
          itemBuilder: (context, index) {
            final user = requests[index];
            final isBusy = busy.contains(user.id);
            return ListTile(
              leading: UserAvatar.of(user),
              title: Text(user.name),
              subtitle: user.bio != null ? Text(user.bio!, maxLines: 1, overflow: TextOverflow.ellipsis) : null,
              trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                FilledButton(
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  onPressed: isBusy ? null : () => respond(user, approve: true),
                  child: const Text('承認'),
                ),
                const SizedBox(width: 6),
                OutlinedButton(
                  style: const ButtonStyle(visualDensity: VisualDensity.compact),
                  onPressed: isBusy ? null : () => respond(user, approve: false),
                  child: const Text('拒否'),
                ),
              ]),
              onTap: () => Navigator.push(context, MaterialPageRoute(builder: (_) => UserProfileScreen(userId: user.id))),
            );
          },
        ),
      );
    }
    return Scaffold(appBar: AppBar(title: const Text('フォローリクエスト')), body: body);
  }
}
