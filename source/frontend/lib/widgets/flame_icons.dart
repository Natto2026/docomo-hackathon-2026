import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

/// 燃えているリアルタイム投稿のピン用に、炎のアイコンを数コマ描いて返す。
/// フォントに頼らず図形で描くので、Web でも最初から確実に表示できる。
class FlameIcons {
  static const frameCount = 3;
  static const _size = 64;

  static Future<List<BitmapDescriptor>> generate() async {
    final frames = <BitmapDescriptor>[];
    for (var frame = 0; frame < frameCount; frame++) {
      frames.add(await _frame(frame));
    }
    return frames;
  }

  static Future<BitmapDescriptor> _frame(int frame) async {
    final size = _size.toDouble();
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    // コマごとに炎の先端を左右に揺らし、高さも少し変える
    final sway = [-0.06, 0.0, 0.06][frame] * size;
    final lift = [0.0, -0.04, 0.02][frame] * size;

    // 足元の光
    canvas.drawCircle(
      Offset(size * 0.5, size * 0.78),
      size * 0.24,
      Paint()..color = Colors.orange.withValues(alpha: 0.35),
    );

    // 外側の炎(赤→橙)
    final outer = Path()
      ..moveTo(size * 0.5 + sway, size * 0.10 + lift)
      ..quadraticBezierTo(size * 0.88, size * 0.42, size * 0.80, size * 0.66)
      ..quadraticBezierTo(size * 0.74, size * 0.94, size * 0.50, size * 0.96)
      ..quadraticBezierTo(size * 0.26, size * 0.94, size * 0.20, size * 0.66)
      ..quadraticBezierTo(size * 0.12, size * 0.42, size * 0.5 + sway, size * 0.10 + lift)
      ..close();
    canvas.drawPath(
      outer,
      Paint()
        ..shader = ui.Gradient.linear(
          Offset(size * 0.5, size * 0.1),
          Offset(size * 0.5, size * 0.96),
          [const Color(0xFFFF3D00), const Color(0xFFFF9100)],
        ),
    );

    // 内側の炎(黄)
    final inner = Path()
      ..moveTo(size * 0.5 - sway * 0.5, size * 0.42 + lift)
      ..quadraticBezierTo(size * 0.68, size * 0.62, size * 0.63, size * 0.78)
      ..quadraticBezierTo(size * 0.58, size * 0.92, size * 0.50, size * 0.93)
      ..quadraticBezierTo(size * 0.42, size * 0.92, size * 0.37, size * 0.78)
      ..quadraticBezierTo(size * 0.32, size * 0.62, size * 0.5 - sway * 0.5, size * 0.42 + lift)
      ..close();
    canvas.drawPath(inner, Paint()..color = const Color(0xFFFFEB3B));

    final image = await recorder.endRecording().toImage(_size, _size);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    return BitmapDescriptor.bytes(bytes!.buffer.asUint8List(), width: 44, height: 44);
  }
}
