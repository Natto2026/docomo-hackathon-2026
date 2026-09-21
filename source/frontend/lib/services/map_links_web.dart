import 'package:web/web.dart' as web;

/// Web 版: ブラウザの新しいタブで URL を開く。
bool openUrl(Uri uri) {
  final opened = web.window.open(uri.toString(), '_blank');
  return opened != null;
}
