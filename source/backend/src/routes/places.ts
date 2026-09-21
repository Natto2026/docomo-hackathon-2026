import { Router, Request, Response } from 'express';
import { isValidCoordinates } from '../services/distanceService';
import { DEFAULT_RADIUS_METERS, placesProvider, reverseAddress, searchNearbyPlaces, searchPlacesByName } from '../services/placesService';
import { numberParam, stringParam } from '../utils/params';

const router = Router();

/** 投稿場所の候補として、地点の周辺(既定 300m)にある店・施設を返す。 */
router.get('/nearby', async (request: Request, response: Response) => {
  const latitude = numberParam(request.query.latitude);
  const longitude = numberParam(request.query.longitude);
  const radius = numberParam(request.query.radius) ?? DEFAULT_RADIUS_METERS;
  if (latitude === undefined || longitude === undefined || !isValidCoordinates(latitude, longitude)) {
    return response.status(400).json({ error: '緯度・経度を正しく指定してください' });
  }
  if (radius <= 0 || radius > 1000) return response.status(400).json({ error: 'radius は 1〜1000 で指定してください' });
  const provider = placesProvider();
  try {
    const places = await searchNearbyPlaces(latitude, longitude, radius);
    return response.json({ places, provider });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: '周辺の施設を取得できませんでした' });
  }
});

/** 名前で店・施設を探す(場所検索)。地点の周辺を優先して近い順に返す。 */
router.get('/search', async (request: Request, response: Response) => {
  const query = stringParam(request.query.q);
  const latitude = numberParam(request.query.latitude);
  const longitude = numberParam(request.query.longitude);
  if (!query || query.length < 2) return response.status(400).json({ error: '検索語は2文字以上で指定してください' });
  if (latitude === undefined || longitude === undefined || !isValidCoordinates(latitude, longitude)) {
    return response.status(400).json({ error: '緯度・経度を正しく指定してください' });
  }
  const provider = placesProvider();
  try {
    const places = await searchPlacesByName(query.slice(0, 100), latitude, longitude);
    return response.json({ places, provider });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: '場所を検索できませんでした' });
  }
});

/** 座標から住所を逆引きする(住所が無い店の表示を補うため)。 */
router.get('/address', async (request: Request, response: Response) => {
  const latitude = numberParam(request.query.latitude);
  const longitude = numberParam(request.query.longitude);
  if (latitude === undefined || longitude === undefined || !isValidCoordinates(latitude, longitude)) {
    return response.status(400).json({ error: '緯度・経度を正しく指定してください' });
  }
  try {
    const result = await reverseAddress(latitude, longitude);
    return response.json({ name: result.name ?? null, address: result.address ?? null });
  } catch (error) {
    console.error(error);
    return response.status(502).json({ error: '住所を取得できませんでした' });
  }
});

export default router;
