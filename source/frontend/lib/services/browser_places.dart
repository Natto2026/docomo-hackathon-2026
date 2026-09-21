// 投稿場所の候補を、地図と同じ Google のデータ(Maps JavaScript API の Places)から取る。
// Web 以外や、Places API が有効でないキーでは null を返し、呼び出し側がバックエンド(OSM)に切り替える。
export 'browser_places_stub.dart' if (dart.library.js_interop) 'browser_places_web.dart';
