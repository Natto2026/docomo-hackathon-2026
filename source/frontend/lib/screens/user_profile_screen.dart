import 'package:flutter/material.dart';
import '../models/post.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../widgets/follow_button.dart';
import '../widgets/post_card.dart';
import '../widgets/user_avatar.dart';
import 'post_detail_screen.dart';

/// ユーザーのプロフィール。フォロー操作と、そのユーザーの投稿(現在地から5km以内)を表示する。
/// 鍵アカウントで未承認なら投稿は表示されない。
class UserProfileScreen extends StatefulWidget {
  UserProfileScreen({super.key, required this.userId, ApiClient? apiClient, LocationService? locationService})
      : api = apiClient ?? ApiClient(),
        location = locationService ?? LocationService();
  final String userId;
  final ApiClient api;
  final LocationService location;
  @override State<UserProfileScreen> createState() => _UserProfileScreenState();
}

class _UserProfileScreenState extends State<UserProfileScreen> {
  AppUser? user;
  List<Post> posts = [];
  bool locked = false;
  bool loading = true;
  bool followBusy = false;
  String? error;

  @override void initState() { super.initState(); load(); }

  Future<void> load() async {
    setState(() { loading = true; error = null; });
    try {
      final profile = await widget.api.fetchUser(widget.userId);
      final point = await widget.location.current();
      final result = await widget.api.fetchUserPosts(widget.userId, latitude: point.latitude, longitude: point.longitude);
      if (mounted) setState(() { user = profile; posts = result.posts; locked = result.locked; });
    } catch (e) {
      if (mounted) setState(() => error = e.toString().replaceFirst('Exception: ', ''));
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  Future<void> toggleFollow() async {
    final target = user;
    if (target == null || followBusy) return;
    setState(() => followBusy = true);
    try {
      final result = (target.isFollowing || target.isPending)
          ? await widget.api.unfollowUser(target.id)
          : await widget.api.followUser(target.id);
      if (mounted) {
        final updated = target.applyFollow(result);
        setState(() => user = updated);
        if (result.status == 'pending') {
          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('${target.name}さんにフォローをリクエストしました')));
        }
        // 閲覧可否が変わったら投稿を取り直す
        if (updated.canViewPosts != target.canViewPosts) await load();
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => followBusy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final profile = user;
    return Scaffold(
      appBar: AppBar(title: Text(profile?.name ?? 'プロフィール'), actions: [IconButton(onPressed: loading ? null : load, icon: const Icon(Icons.refresh))]),
      body: profile == null
          ? (loading
              ? const Center(child: CircularProgressIndicator())
              : Center(
                  child: Column(mainAxisSize: MainAxisSize.min, children: [
                    Text(error ?? 'ユーザー情報を取得できませんでした'),
                    const SizedBox(height: 8),
                    FilledButton(onPressed: load, child: const Text('再読み込み')),
                  ]),
                ))
          : Stack(children: [
              ListView(children: [
                Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Row(children: [
                      UserAvatar.of(profile, radius: 28),
                      const SizedBox(width: 16),
                      Expanded(
                        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                          Row(children: [
                            Flexible(child: Text(profile.name, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold))),
                            if (profile.isPrivate) const Padding(padding: EdgeInsets.only(left: 6), child: Icon(Icons.lock, size: 18)),
                          ]),
                          if (profile.isPrivate) Text('鍵アカウント', style: Theme.of(context).textTheme.bodySmall),
                          if (profile.bio != null) ...[const SizedBox(height: 4), Text(profile.bio!)],
                        ]),
                      ),
                    ]),
                    const SizedBox(height: 16),
                    Row(children: [
                      _Stat(label: '投稿', value: profile.postCount),
                      _Stat(label: 'フォロワー', value: profile.followerCount),
                      _Stat(label: 'フォロー中', value: profile.followingCount),
                    ]),
                    const SizedBox(height: 16),
                    if (profile.id == ApiClient.currentUserId)
                      Text('あなたのアカウントです', style: Theme.of(context).textTheme.bodySmall)
                    else
                      SizedBox(width: double.infinity, child: FollowButton(user: profile, busy: followBusy, onPressed: toggleFollow)),
                    if (error != null) Padding(padding: const EdgeInsets.only(top: 8), child: Text(error!, style: const TextStyle(color: Colors.red))),
                  ]),
                ),
                const Divider(height: 1),
                const Padding(
                  padding: EdgeInsets.fromLTRB(16, 16, 16, 4),
                  child: Text('現在地から5km以内の投稿', style: TextStyle(fontWeight: FontWeight.bold)),
                ),
                if (locked)
                  Padding(
                    padding: const EdgeInsets.all(16),
                    child: Row(children: [
                      const Icon(Icons.lock_outline),
                      const SizedBox(width: 8),
                      Expanded(child: Text(profile.isPending ? 'リクエストが承認されると投稿を見られます' : '鍵アカウントです。フォローが承認されると投稿を見られます')),
                    ]),
                  )
                else if (posts.isEmpty)
                  const Padding(padding: EdgeInsets.all(16), child: Text('5km以内にこのユーザーの投稿はありません')),
                ...posts.map((post) => PostCard(
                      post: post,
                      onTap: () async {
                        final deleted = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => PostDetailScreen(post: post)));
                        if (deleted == true && mounted) load();
                      },
                    )),
                const SizedBox(height: 24),
              ]),
              if (loading) const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator()),
            ]),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.label, required this.value});
  final String label;
  final int value;

  @override
  Widget build(BuildContext context) => Expanded(
        child: Column(children: [
          Text('$value', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.bold)),
          Text(label, style: Theme.of(context).textTheme.bodySmall),
        ]),
      );
}
