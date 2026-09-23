import 'package:flutter/material.dart';
import 'screens/create_post_screen.dart';
import 'screens/map_screen.dart';
import 'screens/timeline_screen.dart';
import 'screens/users_screen.dart';
import 'models/place.dart';
import 'services/session.dart';

void main() => runApp(const LocalAreaSnsApp());

class LocalAreaSnsApp extends StatelessWidget {
  const LocalAreaSnsApp({super.key});
  @override Widget build(BuildContext context) => MaterialApp(title: '近くの発見', debugShowCheckedModeBanner: false, theme: ThemeData(colorScheme: ColorScheme.fromSeed(seedColor: Colors.teal), useMaterial3: true), home: const HomeScreen());
}

class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key});
  @override State<HomeScreen> createState() => _HomeScreenState();
}
class _HomeScreenState extends State<HomeScreen> {
  /// ナビゲーションの「投稿」は画面ではなく投稿フォームを開く。
  static const createIndex = 3;
  int index = 0;
  int refreshKey = 0;
  /// 投稿画面を開く。地図の店アイコンから開いたときは、その店を選んだ状態にする。
  void openCreate([NearbyPlace? place]) => Navigator.push(context, MaterialPageRoute(builder: (_) => CreatePostScreen(onCreated: () => setState(() => refreshKey++), initialPlace: place)));

  @override
  void initState() {
    super.initState();
    Session.instance.user.addListener(onUserChanged);
  }

  @override
  void dispose() {
    Session.instance.user.removeListener(onUserChanged);
    super.dispose();
  }

  /// 開発用のユーザー切り替え後は、全タブをそのユーザーとして読み直す。
  void onUserChanged() => setState(() => refreshKey++);

  @override
  Widget build(BuildContext context) {
    final screens = [
      MapScreen(onCreatePost: openCreate, refreshKey: refreshKey),
      TimelineScreen(refreshKey: refreshKey, visible: index == 1),
      UsersScreen(refreshKey: refreshKey, visible: index == 2),
    ];
    return Scaffold(
      body: IndexedStack(index: index, children: screens),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (value) {
          if (value == createIndex) { openCreate(); return; }  // 投稿タブは画面ではなくフォームを開く
          setState(() => index = value);
        },
        destinations: const [
          NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'マップ'),
          NavigationDestination(icon: Icon(Icons.view_timeline_outlined), selectedIcon: Icon(Icons.view_timeline), label: 'タイムライン'),
          NavigationDestination(icon: Icon(Icons.people_outline), selectedIcon: Icon(Icons.people), label: 'ユーザー'),
          NavigationDestination(icon: Icon(Icons.add_circle_outline), selectedIcon: Icon(Icons.add_circle), label: '投稿'),
        ],
      ),
    );
  }
}
