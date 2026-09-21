/**
 * 踏破率の検証。発表で出た指摘を受けて、ハッカソン後に足した機能のテスト。
 *
 * 外部の地図サービスには問い合わせず、応答を差し替えて実行する。
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { headlineOf } from '../../src/improvements/coverage/route';
import { createApp } from '../../src/server';
import {
  COMPARISON_RADII_METERS,
  isSamePlace,
  splitByVisited,
  summarizeCoverage,
  visitedPlacesOf,
} from '../../src/improvements/coverage/service';
import { clearPlacesCache, NearbyPlace, setPlacesFetch } from '../../src/services/placesService';
import type { Post } from '../../src/types/post';

// demo-user-1 の投稿は data/posts.json にある（広場 34.7025,135.4959 とカフェ 34.7031,135.4953）
const HERE = { latitude: 34.7025, longitude: 135.4959 };

/** Overpass の応答に見せかけた JSON を返す。半径ごとに件数を変える。 */
function overpassResponse(elements: object[]) {
  return new Response(JSON.stringify({ elements }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function node(id: number, name: string, latitude: number, longitude: number) {
  return { type: 'node', id, lat: latitude, lon: longitude, tags: { name, amenity: 'cafe' } };
}

function place(id: string, latitude: number, longitude: number, distance: number): NearbyPlace {
  return { id, name: id, latitude, longitude, distanceMeters: distance };
}

function post(id: string, authorId: string, latitude: number, longitude: number, placeId?: string): Post {
  return {
    id,
    authorId,
    authorName: authorId,
    body: '',
    latitude,
    longitude,
    placeId,
    postType: 'normal',
    likeCount: 0,
    commentCount: 0,
    createdAt: '2026-09-09T00:00:00.000Z',
    comments: [],
  };
}

describe('coverage（純粋な部分）', () => {
  it('自分の投稿だけを訪問済みとして数える', () => {
    const posts = [post('a', 'me', 34.6, 135.4), post('b', 'other', 34.7, 135.5)];
    const visited = visitedPlacesOf(posts, 'me');
    expect(visited).toHaveLength(1);
    expect(visited[0].latitude).toBe(34.6);
  });

  it('場所IDが一致すれば同じ場所とみなす', () => {
    const target = place('node/1', 35.0, 135.0, 10);
    expect(isSamePlace(target, { name: 'x', placeId: 'node/1', latitude: 0, longitude: 0 })).toBe(true);
  });

  it('座標が十分近ければ同じ場所とみなす', () => {
    const target = place('node/1', 34.7025, 135.4959, 0);
    const almost = { name: 'x', latitude: 34.70255, longitude: 135.4959 };
    const faraway = { name: 'y', latitude: 34.7109, longitude: 135.4959 };
    expect(isSamePlace(target, almost)).toBe(true);
    expect(isSamePlace(target, faraway)).toBe(false);
  });

  it('訪問済みと未訪問に分ける', () => {
    const places = [place('node/1', 34.6, 135.4, 10), place('node/2', 35.1, 135.9, 900)];
    const split = splitByVisited(places, [{ name: 'x', placeId: 'node/1', latitude: 0, longitude: 0 }]);
    expect(split.visited.map((entry) => entry.id)).toEqual(['node/1']);
    expect(split.unvisited.map((entry) => entry.id)).toEqual(['node/2']);
  });

  it('見出しの文は、件数と割合と残りを含む', () => {
    expect(headlineOf(5000, 100, 0.18)).toBe(
      '半径5km以内に100か所。行ったことがあるのは18%で、残り82か所は未訪問です。',
    );
  });

  it('場所が見つからないときは、その旨を返す', () => {
    expect(headlineOf(5000, 0, 0)).toContain('まだ登録された場所がありません');
  });
});

describe('coverage（地図サービスを差し替えて）', () => {
  beforeEach(() => {
    clearPlacesCache();
  });

  afterEach(() => {
    setPlacesFetch(undefined);
    clearPlacesCache();
  });

  it('圏内の場所を訪問済みと未訪問に分け、割合を出す', async () => {
    setPlacesFetch((async () =>
      overpassResponse([
        // demo-user-1 が投稿している広場と同じ位置＝訪問済みになる
        node(1, '中央広場', 34.7025, 135.4959),
        node(2, '知らないカフェ', 34.7039, 135.4964),
        node(3, '知らない本屋', 34.7049, 135.4974),
      ])) as unknown as typeof fetch);

    const summary = await summarizeCoverage('demo-user-1', HERE.latitude, HERE.longitude, {
      radiusMeters: 5000,
      withComparison: false,
    });

    expect(summary.placesInRange).toBe(3);
    expect(summary.visitedInRange).toBe(1);
    expect(summary.coverageRatio).toBeCloseTo(1 / 3);
    expect(summary.unvisited.map((entry) => entry.name)).toEqual(['知らないカフェ', '知らない本屋']);
  });

  it('未訪問は近い順に、指定した件数だけ返す', async () => {
    setPlacesFetch((async () =>
      overpassResponse([
        node(1, '遠い', 34.7409, 135.5344),
        // 訪問済みの場所（広場・カフェ）から 60m 以上離す。近すぎると
        // 同じ場所とみなされ、未訪問に入らない
        node(2, '近い', 34.7034, 135.4974),
        node(3, '中くらい', 34.7109, 135.5044),
      ])) as unknown as typeof fetch);

    const summary = await summarizeCoverage('demo-user-1', HERE.latitude, HERE.longitude, {
      radiusMeters: 20000,
      limit: 2,
      withComparison: false,
    });

    expect(summary.unvisited.map((entry) => entry.name)).toEqual(['近い', '中くらい']);
  });

  it('半径ごとの候補数を比較として返す', async () => {
    let call = 0;
    setPlacesFetch((async () => {
      call += 1;
      // 呼ばれるたびに件数を増やし、半径を広げたときの増え方を表す
      return overpassResponse(
        Array.from({ length: call }, (_, index) => node(index + 1, `場所${index + 1}`, 34.7109, 135.5044)),
      );
    }) as unknown as typeof fetch);

    const summary = await summarizeCoverage('demo-user-1', HERE.latitude, HERE.longitude, {
      radiusMeters: 5000,
    });

    expect(summary.comparison.map((entry) => entry.radiusMeters)).toEqual([...COMPARISON_RADII_METERS]);
    expect(summary.comparison.every((entry) => entry.places > 0)).toBe(true);
  });

  it('場所が0件なら割合は0で、エラーにしない', async () => {
    setPlacesFetch((async () => overpassResponse([])) as unknown as typeof fetch);
    const summary = await summarizeCoverage('demo-user-1', HERE.latitude, HERE.longitude, {
      withComparison: false,
    });
    expect(summary.placesInRange).toBe(0);
    expect(summary.coverageRatio).toBe(0);
  });
});

describe('GET /api/coverage', () => {
  beforeEach(() => {
    clearPlacesCache();
  });

  afterEach(() => {
    setPlacesFetch(undefined);
    clearPlacesCache();
  });

  it('見出しの文と内訳を返す', async () => {
    setPlacesFetch((async () =>
      overpassResponse([
        node(1, '中央広場', 34.7025, 135.4959),
        node(2, '知らないカフェ', 34.7039, 135.4964),
      ])) as unknown as typeof fetch);

    const response = await request(createApp()).get(
      `/api/coverage?latitude=${HERE.latitude}&longitude=${HERE.longitude}&userId=demo-user-1&comparison=off`,
    );

    expect(response.status).toBe(200);
    expect(response.body.placesInRange).toBe(2);
    expect(response.body.visitedInRange).toBe(1);
    expect(response.body.headline).toContain('半径5km以内に2か所');
    expect(response.body.unvisited).toHaveLength(1);
  });

  it('緯度経度がなければ 400', async () => {
    const response = await request(createApp()).get('/api/coverage?userId=demo-user-1');
    expect(response.status).toBe(400);
  });

  it('userId がなければ 400', async () => {
    const response = await request(createApp()).get(
      `/api/coverage?latitude=${HERE.latitude}&longitude=${HERE.longitude}`,
    );
    expect(response.status).toBe(400);
  });

  it('半径が範囲外なら 400', async () => {
    const base = `/api/coverage?latitude=${HERE.latitude}&longitude=${HERE.longitude}&userId=demo-user-1`;
    expect((await request(createApp()).get(`${base}&radius=10`)).status).toBe(400);
    expect((await request(createApp()).get(`${base}&radius=999999`)).status).toBe(400);
  });
});
