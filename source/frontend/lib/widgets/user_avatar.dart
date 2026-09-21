import 'package:flutter/material.dart';
import '../models/user.dart';

/// プロフィール写真があれば画像、無ければ名前の頭文字を丸く表示する。
class UserAvatar extends StatelessWidget {
  const UserAvatar({super.key, required this.name, this.avatarUrl, this.radius = 20});

  UserAvatar.of(AppUser user, {super.key, this.radius = 20})
      : name = user.name,
        avatarUrl = user.avatarUrl;

  final String name;
  final String? avatarUrl;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final url = avatarUrl;
    return CircleAvatar(
      radius: radius,
      backgroundImage: url != null ? NetworkImage(url) : null,
      // 画像が読めないときは頭文字にフォールバックさせるため、エラーは握りつぶす
      onBackgroundImageError: url != null ? (_, __) {} : null,
      child: url == null ? Text(AppUser.initialOf(name), style: TextStyle(fontSize: radius * 0.8)) : null,
    );
  }
}
