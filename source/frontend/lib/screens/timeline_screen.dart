import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import '../models/post.dart';
import '../models/user.dart';
import '../services/api_client.dart';
import '../services/location_service.dart';
import '../services/session.dart';
import '../widgets/my_profile_header.dart';
import '../widgets/post_card.dart';
import '../widgets/user_switcher_sheet.dart';
import 'follow_requests_screen.dart';
import 'post_detail_screen.dart';
import 'user_profile_screen.dart';

class TimelineScreen extends StatefulWidget {
  TimelineScreen({super.key, required this.refreshKey, this.visible = true, ApiClient? apiClient, LocationService? locationService})
      : api = apiClient ?? ApiClient(),
        location = locationService ?? LocationService();
  final int refreshKey;
  /// タブとして表示中か。非表示から表示に変わったとき読み直す(他タブでのフォロー操作を反映するため)。
  final bool visible;
  final ApiClient api;
  final LocationService location;
  @override State<TimelineScreen> createState() => _TimelineScreenState();
}

class _TimelineScreenState extends State<TimelineScreen> {
  List<Post> posts = [];
  AppUser? me;
  bool loading = true;
  bool privacyBusy = false;
  bool followingOnly = false;
  String? error;
  @override void initState() { super.initState(); load(); }
  @override
  void didUpdateWidget(covariant TimelineScreen oldWidget) {
    super.didUpdateWidget(oldWidget);
    final becameVisible = !oldWidget.visible && widget.visible;
    if (oldWidget.refreshKey != widget.refreshKey || becameVisible) load();
  }

  /// 開発用: 操作中のユーザーを切り替える。切り替え後の読み直しはホーム画面が行う。
  Future<void> switchUser() async {
    final picked = await UserSwitcherSheet.show(context, widget.api);
    if (picked != null) Session.instance.switchTo(picked);
  }

  Future<void> load() => Future.wait([loadMe(), loadPosts()]);

  /// 自分の情報。取れなくてもタイムライン自体は表示するが、
  /// 前のユーザーの情報を残すと別人として操作してしまうので必ず消す。
  Future<void> loadMe() async {
    try {
      final profile = await widget.api.fetchMe();
      if (mounted) setState(() => me = profile);
    } catch (_) {
      if (mounted) setState(() => me = null);
    }
  }

  Future<void> loadPosts() async {
    setState(() { loading = true; error = null; });
    try {
      final point = await widget.location.current();
      final result = await widget.api.fetchPosts(latitude: point.latitude, longitude: point.longitude, followingOnly: followingOnly);
      if (mounted) setState(() => posts = result);
    } catch (_) {
      if (mounted) setState(() => error = '投稿を読み込めませんでした');
    } finally {
      if (mounted) setState(() => loading = false);
    }
  }

  void switchFilter(bool value) {
    if (value == followingOnly) return;
    setState(() { followingOnly = value; posts = []; });
    loadPosts();
  }

  Future<void> setPrivacy(bool isPrivate) async {
    if (privacyBusy) return;
    setState(() => privacyBusy = true);
    try {
      final updated = await widget.api.updatePrivacy(isPrivate: isPrivate);
      if (mounted) {
        setState(() => me = updated);
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(isPrivate ? '鍵アカウントにしました' : '公開アカウントにしました')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    } finally {
      if (mounted) setState(() => privacyBusy = false);
    }
  }

  /// プロフィール写真を選んで登録する(または削除する)。
  Future<void> changeAvatar() async {
    final current = me;
    if (current == null) return;
    final action = await showModalBottomSheet<String>(
      context: context,
      builder: (sheetContext) => SafeArea(
        child: Column(mainAxisSize: MainAxisSize.min, children: [
          ListTile(leading: const Icon(Icons.photo_library_outlined), title: const Text('写真を選ぶ'), onTap: () => Navigator.pop(sheetContext, 'gallery')),
          ListTile(leading: const Icon(Icons.camera_alt_outlined), title: const Text('カメラで撮る'), onTap: () => Navigator.pop(sheetContext, 'camera')),
          if (current.avatarUrl != null)
            ListTile(leading: const Icon(Icons.delete_outline), title: const Text('写真を削除'), onTap: () => Navigator.pop(sheetContext, 'remove')),
        ]),
      ),
    );
    if (action == null || !mounted) return;
    try {
      if (action == 'remove') {
        final updated = await widget.api.removeAvatar();
        if (mounted) setState(() => me = updated);
        return;
      }
      final picked = await ImagePicker().pickImage(source: action == 'camera' ? ImageSource.camera : ImageSource.gallery, maxWidth: 800, maxHeight: 800);
      if (picked == null) return;
      final updated = await widget.api.uploadAvatar(picked);
      if (mounted) {
        setState(() => me = updated);
        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('プロフィール写真を更新しました')));
      }
    } catch (e) {
      if (mounted) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.toString().replaceFirst('Exception: ', ''))));
    }
  }

  Future<void> openRequests() async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => FollowRequestsScreen()));
    if (mounted) loadMe();
  }

  /// 投稿詳細へ。削除して戻ってきたら(true)一覧を読み直す。
  Future<void> openDetail(Post post) async {
    final deleted = await Navigator.push<bool>(context, MaterialPageRoute(builder: (_) => PostDetailScreen(post: post)));
    if (deleted == true && mounted) load();
  }

  Future<void> openProfile(String userId) async {
    await Navigator.push(context, MaterialPageRoute(builder: (_) => UserProfileScreen(userId: userId)));
    if (mounted) load();
  }

  @override
  Widget build(BuildContext context) {
    final top = SafeArea(
      bottom: false,
      child: Column(children: [
        if (me != null)
          MyProfileHeader(
            user: me!,
            busy: privacyBusy,
            onPrivacyChanged: setPrivacy,
            onOpenRequests: openRequests,
            onOpenProfile: () => openProfile(ApiClient.currentUserId),
            onSwitchUser: switchUser,
            onChangeAvatar: changeAvatar,
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 4),
          // 幅いっぱいに2等分し、ラベルは折り返さず必ず1行に収める
          child: SegmentedButton<bool>(
            segments: const [
              ButtonSegment(value: false, label: Text('すべて', maxLines: 1, softWrap: false)),
              ButtonSegment(value: true, label: Text('フォロー中', maxLines: 1, softWrap: false)),
            ],
            selected: {followingOnly},
            showSelectedIcon: false,
            expandedInsets: EdgeInsets.zero,
            onSelectionChanged: (selection) => switchFilter(selection.first),
          ),
        ),
      ]),
    );

    return Column(children: [top, Expanded(child: _content())]);
  }

  Widget _content() {
    if (loading && posts.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (error != null && posts.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(error!),
            const SizedBox(height: 8),
            FilledButton(onPressed: load, child: const Text('再読み込み')),
          ],
        ),
      );
    }

    final list = posts.isEmpty
        ? ListView(
            children: [
              const SizedBox(height: 200),
              Center(child: Text(followingOnly ? 'フォロー中のユーザーの投稿はまだありません' : '近くの投稿はまだありません')),
            ],
          )
        : ListView.builder(
            itemCount: posts.length,
            itemBuilder: (_, index) => PostCard(
              post: posts[index],
              onTap: () => openDetail(posts[index]),
              onAuthorTap: () => openProfile(posts[index].authorId),
            ),
          );

    return RefreshIndicator(onRefresh: load, child: list);
  }
}
