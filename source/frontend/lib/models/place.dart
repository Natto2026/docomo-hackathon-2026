import 'dart:math' as math;

/// 2地点間の距離(メートル)。バックエンドの distanceService と同じ計算。
double distanceBetweenMeters(double latitude1, double longitude1, double latitude2, double longitude2) {
  const earthRadius = 6371000.0;
  double toRadians(double degrees) => degrees * math.pi / 180;
  final latitudeDelta = toRadians(latitude2 - latitude1);
  final longitudeDelta = toRadians(longitude2 - longitude1);
  final a = math.pow(math.sin(latitudeDelta / 2), 2) +
      math.cos(toRadians(latitude1)) * math.cos(toRadians(latitude2)) * math.pow(math.sin(longitudeDelta / 2), 2);
  return earthRadius * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a));
}

/// Places / OSM の分類を日本語の表示名にする。未知の分類はそのまま返す。
String? placeTypeLabel(String? type) {
  if (type == null || type.isEmpty) return null;
  const labels = {
    'cafe': 'カフェ',
    'coffee': 'カフェ',
    'coffee_shop': 'カフェ',
    'restaurant': 'レストラン',
    'japanese_restaurant': '和食',
    'ramen_restaurant': 'ラーメン',
    'ramen': 'ラーメン',
    'sushi_restaurant': '寿司',
    'italian_restaurant': 'イタリアン',
    'chinese_restaurant': '中華',
    'fast_food': 'ファストフード',
    'fast_food_restaurant': 'ファストフード',
    'bar': 'バー',
    'pub': '居酒屋',
    'izakaya': '居酒屋',
    'bakery': 'パン屋',
    'convenience': 'コンビニ',
    'convenience_store': 'コンビニ',
    'supermarket': 'スーパー',
    'grocery_store': '食料品店',
    'department_store': 'デパート',
    'clothes': '洋服店',
    'clothing_store': '洋服店',
    'book_store': '書店',
    'books': '書店',
    'pharmacy': '薬局',
    'drugstore': 'ドラッグストア',
    'hospital': '病院',
    'clinic': 'クリニック',
    'dentist': '歯科',
    'bank': '銀行',
    'atm': 'ATM',
    'post_office': '郵便局',
    'park': '公園',
    'gym': 'ジム',
    'fitness_center': 'ジム',
    'library': '図書館',
    'school': '学校',
    'university': '大学',
    'station': '駅',
    'train_station': '駅',
    'bus_station': 'バス停',
    'parking': '駐車場',
    'bicycle_rental': 'レンタサイクル',
    'hotel': 'ホテル',
    'lodging': '宿泊',
    'museum': '博物館',
    'tourist_attraction': '観光スポット',
    'shrine': '神社',
    'temple': '寺',
    'place_of_worship': '寺社',
    'hair_care': '美容室',
    'hairdresser': '美容室',
    'beauty_salon': '美容室',
    'gas_station': 'ガソリンスタンド',
    'fuel': 'ガソリンスタンド',
    'electronics': '家電店',
    'electronics_store': '家電店',
    'shopping_mall': 'ショッピングモール',
    'mall': 'ショッピングモール',
  };
  return labels[type] ?? type;
}

/// 投稿場所の候補になる周辺の施設(店など)。
class NearbyPlace {
  const NearbyPlace({
    required this.id,
    required this.name,
    this.address,
    required this.latitude,
    required this.longitude,
    required this.distanceMeters,
    this.primaryType,
  });

  final String id;
  final String name;
  final String? address;
  final double latitude;
  final double longitude;
  /// 検索地点(現在地や選んだ地点)からの距離
  final int distanceMeters;
  final String? primaryType;

  String get distanceLabel => distanceMeters < 1000 ? '${distanceMeters}m' : '${(distanceMeters / 1000).toStringAsFixed(1)}km';
  String? get typeLabel => placeTypeLabel(primaryType);

  factory NearbyPlace.fromJson(Map<String, dynamic> json) => NearbyPlace(
        id: json['id'] as String? ?? '',
        name: json['name'] as String? ?? '',
        address: (json['address'] as String?)?.trim().isNotEmpty == true ? (json['address'] as String).trim() : null,
        latitude: (json['latitude'] as num?)?.toDouble() ?? 0,
        longitude: (json['longitude'] as num?)?.toDouble() ?? 0,
        distanceMeters: (json['distanceMeters'] as num?)?.round() ?? 0,
        primaryType: json['primaryType'] as String?,
      );
}

/// 地図上の店アイコン(Google の POI)が押されたときの情報。
/// name / address は Google 標準の店カードから読み取ったもので、読み取れるまでは null。
class PoiClick {
  const PoiClick({required this.placeId, required this.latitude, required this.longitude, this.name, this.address});
  final String placeId;
  final double latitude;
  final double longitude;
  final String? name;
  final String? address;

  NearbyPlace? toPlace() {
    final placeName = name;
    if (placeName == null || placeName.isEmpty) return null;
    return NearbyPlace(id: placeId, name: placeName, address: address, latitude: latitude, longitude: longitude, distanceMeters: 0);
  }
}

/// 周辺施設の検索結果。provider は google(Places API) か osm(OpenStreetMap)。
class NearbyPlacesResult {
  const NearbyPlacesResult({required this.places, required this.provider});
  final List<NearbyPlace> places;
  final String provider;
}
