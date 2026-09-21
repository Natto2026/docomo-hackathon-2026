/**
 * 「半径を絞ること」の値打ちを数字で示す。
 *
 * ハッカソン後に自分ひとりで足した機能。
 *
 * このアプリの主張は「近所に絞ると、知らなかった場所が見つかる」だが、
 * 提出時点では半径で絞り込むだけで、絞ることの効き目を何も示していなかった。
 * 審査でも「既存の地図アプリと何が違うか」を根拠付きで言えと繰り返し指摘された。
 *
 * そこで次の2つを出す。
 *
 *   1. 踏破率 — 圏内の場所のうち、自分が行った割合。
 *      「近所の8割は知らない」が言えれば、それがこのアプリを使う理由になる。
 *   2. 候補数の比較 — 半径を変えたときに候補が何件になるか。
 *      広げるほど候補は増えるが、増えた分は「今日行ける場所」ではない。
 *
 * 場所の取得には、ハッカソンで自分が書いた placesService をそのまま使う。
 */

import type { Post } from '../../types/post';
import { distanceMeters } from '../../services/distanceService';
import { NearbyPlace, searchNearbyPlaces } from '../../services/placesService';
import { readPosts } from '../../services/postService';

/** 比較のために問い合わせる半径。徒歩圏・自転車圏・その外。 */
export const COMPARISON_RADII_METERS = [1_500, 5_000, 20_000] as const;

/** 同じ場所とみなす距離。地図データ側の座標のぶれを吸収する。 */
const SAME_PLACE_METERS = 60;

export type VisitedPlace = {
  name: string;
  placeId?: string;
  latitude: number;
  longitude: number;
};

export type CoverageSummary = {
  radiusMeters: number;
  /** 圏内で見つかった場所の数 */
  placesInRange: number;
  /** そのうち自分が行ったことのある数 */
  visitedInRange: number;
  /** visitedInRange / placesInRange。場所が0件なら0 */
  coverageRatio: number;
  /** まだ行っていない場所。近い順 */
  unvisited: NearbyPlace[];
  /** 半径ごとの候補数。絞ることの効き目を示す */
  comparison: { radiusMeters: number; places: number }[];
};

/** 投稿から「行ったことのある場所」を取り出す。場所の指定がない投稿は座標で扱う。 */
export function visitedPlacesOf(posts: Post[], authorId: string): VisitedPlace[] {
  return posts
    .filter((post) => post.authorId === authorId)
    .map((post) => ({
      name: post.placeName ?? '(場所の指定なし)',
      placeId: post.placeId,
      latitude: post.latitude,
      longitude: post.longitude,
    }));
}

/** 同じ場所か。ID が一致するか、距離が十分近ければ同じとみなす。 */
export function isSamePlace(place: NearbyPlace, visited: VisitedPlace): boolean {
  if (place.id && visited.placeId && place.id === visited.placeId) return true;
  const gap = distanceMeters(
    place.latitude,
    place.longitude,
    visited.latitude,
    visited.longitude,
  );
  return gap <= SAME_PLACE_METERS;
}

export function splitByVisited(
  places: NearbyPlace[],
  visited: VisitedPlace[],
): { visited: NearbyPlace[]; unvisited: NearbyPlace[] } {
  const seen: NearbyPlace[] = [];
  const unseen: NearbyPlace[] = [];
  for (const place of places) {
    (visited.some((entry) => isSamePlace(place, entry)) ? seen : unseen).push(place);
  }
  return { visited: seen, unvisited: unseen };
}

export type CoverageOptions = {
  radiusMeters?: number;
  /** 未訪問として返す件数の上限 */
  limit?: number;
  /** 半径ごとの比較を行うか。外部への問い合わせが増えるため切り替えられる */
  withComparison?: boolean;
};

export async function summarizeCoverage(
  userId: string,
  latitude: number,
  longitude: number,
  options: CoverageOptions = {},
): Promise<CoverageSummary> {
  const radiusMeters = options.radiusMeters ?? 5_000;
  const limit = options.limit ?? 10;

  const visited = visitedPlacesOf(await readPosts(), userId);
  const places = await searchNearbyPlaces(latitude, longitude, radiusMeters);
  const split = splitByVisited(places, visited);

  const comparison: { radiusMeters: number; places: number }[] = [];
  if (options.withComparison !== false) {
    for (const candidate of COMPARISON_RADII_METERS) {
      const found =
        candidate === radiusMeters
          ? places
          : await searchNearbyPlaces(latitude, longitude, candidate);
      comparison.push({ radiusMeters: candidate, places: found.length });
    }
  }

  return {
    radiusMeters,
    placesInRange: places.length,
    visitedInRange: split.visited.length,
    coverageRatio: places.length === 0 ? 0 : split.visited.length / places.length,
    unvisited: [...split.unvisited]
      .sort((a, b) => a.distanceMeters - b.distanceMeters)
      .slice(0, limit),
    comparison,
  };
}
