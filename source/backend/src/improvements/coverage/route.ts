/**
 * 踏破率の API。ハッカソン後に自分ひとりで足したもの。
 *
 *   GET /api/coverage?latitude=&longitude=&userId=&radius=&limit=
 */

import { Request, Response, Router } from 'express';

import { summarizeCoverage } from './service';
import { isValidCoordinates } from '../../services/distanceService';
import { numberParam, stringParam } from '../../utils/params';

const router = Router();

const MIN_RADIUS_METERS = 100;
const MAX_RADIUS_METERS = 50_000;
const MAX_LIMIT = 50;

router.get('/', async (request: Request, response: Response) => {
  const latitude = numberParam(request.query.latitude);
  const longitude = numberParam(request.query.longitude);
  if (latitude === undefined || longitude === undefined || !isValidCoordinates(latitude, longitude)) {
    return response.status(400).json({ error: '緯度経度の指定が不正です' });
  }

  const userId = stringParam(request.query.userId);
  if (!userId) return response.status(400).json({ error: 'userId を指定してください' });

  const radius = numberParam(request.query.radius) ?? 5_000;
  if (radius < MIN_RADIUS_METERS || radius > MAX_RADIUS_METERS) {
    return response
      .status(400)
      .json({ error: `radius は ${MIN_RADIUS_METERS}〜${MAX_RADIUS_METERS} の範囲で指定してください` });
  }

  const limit = Math.min(numberParam(request.query.limit) ?? 10, MAX_LIMIT);
  // 比較は半径ごとに問い合わせるため、外部の利用制限に配慮して既定では省ける
  const withComparison = stringParam(request.query.comparison) !== 'off';

  try {
    const summary = await summarizeCoverage(userId, latitude, longitude, {
      radiusMeters: radius,
      limit,
      withComparison,
    });
    return response.json({
      ...summary,
      // 画面にそのまま出せる一文。数字の意味を毎回組み立て直さずに済む
      headline: headlineOf(summary.radiusMeters, summary.placesInRange, summary.coverageRatio),
    });
  } catch {
    return response.status(502).json({ error: '周辺の場所を取得できませんでした' });
  }
});

export function headlineOf(radiusMeters: number, places: number, ratio: number): string {
  const kilometres = (radiusMeters / 1000).toFixed(radiusMeters % 1000 === 0 ? 0 : 1);
  if (places === 0) return `半径${kilometres}km以内に、まだ登録された場所がありません。`;
  const percent = Math.round(ratio * 100);
  const remaining = places - Math.round(ratio * places);
  return `半径${kilometres}km以内に${places}か所。行ったことがあるのは${percent}%で、残り${remaining}か所は未訪問です。`;
}

export default router;
