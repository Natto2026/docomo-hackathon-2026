import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';

/// 現在地のアイコン。Google マップと同じ「白い縁の青い丸」を図形で描く(投稿のピンと見分けやすい)。
class LocationIcon {
  static BitmapDescriptor? _cached;

  static Future<BitmapDescriptor> get() async {
    final cached = _cached;
    if (cached != null) return cached;
    const size = 64;
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    const center = Offset(size / 2, size / 2);
    canvas.drawCircle(center, size * 0.48, Paint()..color = const Color(0xFF1A73E8).withValues(alpha: 0.25));
    canvas.drawCircle(center, size * 0.30, Paint()..color = Colors.white);
    canvas.drawCircle(center, size * 0.22, Paint()..color = const Color(0xFF1A73E8));
    final image = await recorder.endRecording().toImage(size, size);
    final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
    final icon = BitmapDescriptor.bytes(bytes!.buffer.asUint8List(), width: 36, height: 36);
    _cached = icon;
    return icon;
  }
}
