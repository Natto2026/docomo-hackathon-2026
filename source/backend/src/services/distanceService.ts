/**
 * 【補助実装】このファイルは、このリポジトリのために新しく書いたものである。
 *
 * 元のプロジェクトではチームの他メンバーが書いた同名のモジュールがあり、
 * そちらは共同成果物のためここには含めていない。
 * 自分が書いたコードを単体で動かすために、同じ関数シグネチャで
 * 最小限の実装を置いている。
 */

const EARTH_RADIUS_METERS = 6_371_000;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** 2地点の距離をメートルで返す（球面近似）。 */
export function distanceMeters(
  latitude1: number,
  longitude1: number,
  latitude2: number,
  longitude2: number,
): number {
  const halfLatitudeDelta = toRadians(latitude2 - latitude1) / 2;
  const halfLongitudeDelta = toRadians(longitude2 - longitude1) / 2;
  const chord =
    Math.sin(halfLatitudeDelta) ** 2 +
    Math.cos(toRadians(latitude1)) *
      Math.cos(toRadians(latitude2)) *
      Math.sin(halfLongitudeDelta) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(chord)));
}

/** 緯度経度として妥当な値か。 */
export function isValidCoordinates(latitude: number, longitude: number): boolean {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}
