import 'package:flutter/foundation.dart';
import '../models/user.dart';

/// 操作中のユーザー。認証未導入のため既定はデモユーザーで、開発用に切り替えられる。
/// 切り替えると [user] が通知を出すので、ホーム画面が全タブを読み直す。
class Session {
  Session._();
  static final Session instance = Session._();

  static const defaultUser = AppUser(id: 'demo-user-1', name: 'デモユーザー');

  final ValueNotifier<AppUser> user = ValueNotifier<AppUser>(defaultUser);

  String get userId => user.value.id;
  String get userName => user.value.name;

  void switchTo(AppUser next) {
    if (next.id == user.value.id) return;
    user.value = next;
  }

  /// テスト用に既定のユーザーへ戻す。
  void reset() => user.value = defaultUser;
}
