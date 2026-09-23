/**
 * 保存先を選べる版の、投稿の公開範囲の判定。ハッカソン後に足したもの。
 *
 * 提出時点の routes/posts.ts は、公開範囲の判定で followService（JSON）を直接呼ぶ。
 * そのファイルには手を入れず、フォロー関係を別の保存先（DynamoDB など）に置いたときだけ、
 * このルーターを提出時のルーターの手前に差し込む（improvements/app.ts）。
 *
 *   GET  /api/posts               一覧。判定をこの保存先に問い合わせて、ここで応答する
 *   GET  /api/posts/:id           1件。同上
 *   POST /api/posts/:id/like      見られない投稿なら 403 で止める。見られるなら提出時のルーターへ流す
 *   POST /api/posts/:id/comments  同上
 */

import { NextFunction, Request, Response, Router } from 'express';

import { isValidCoordinates } from '../../services/distanceService';
import { findPost, listPosts } from '../../services/postService';
import { numberParam, stringParam } from '../../utils/params';
import { FollowStore } from './store';
import { canViewAuthor, hiddenAuthorIds } from './visibility';

const DEFAULT_RADIUS_METERS = 5000;

export function createStorePostsRouter(store: FollowStore): Router {
  const router = Router();

  /** 一覧。followingOf を付けるとフォロー中の投稿だけに絞る。 */
  router.get('/', async (request: Request, response: Response) => {
    try {
      const latitude = numberParam(request.query.latitude);
      const longitude = numberParam(request.query.longitude);
      const radius = numberParam(request.query.radius) ?? DEFAULT_RADIUS_METERS;
      const viewerId = stringParam(request.query.viewerId) ?? '';
      const followingOf = stringParam(request.query.followingOf);

      if (latitude !== undefined && longitude !== undefined && !isValidCoordinates(latitude, longitude)) {
        return response.status(400).json({ error: '緯度経度の指定が不正です' });
      }

      const authorIds = followingOf === undefined ? undefined : await store.listFollowingIds(followingOf);
      const posts = await listPosts(latitude, longitude, radius, {
        authorIds,
        excludeAuthorIds: await hiddenAuthorIds(store, viewerId),
      });
      return response.json({ posts, count: posts.length });
    } catch {
      return response.status(500).json({ error: '投稿の取得に失敗しました' });
    }
  });

  /** 1件。見る権限がなければ 403。 */
  router.get('/:id', async (request: Request<{ id: string }>, response: Response) => {
    try {
      const post = await findPost(request.params.id);
      if (!post) return response.status(404).json({ error: '投稿が見つかりません' });

      const viewerId = stringParam(request.query.viewerId) ?? '';
      if (!(await canViewAuthor(store, viewerId, post.authorId))) {
        return response.status(403).json({ error: 'この投稿は公開されていません' });
      }
      return response.json(post);
    } catch {
      return response.status(500).json({ error: '投稿の取得に失敗しました' });
    }
  });

  /** いいねとコメントは、見られない投稿なら止める。書き込みは提出時のルーターが行う。 */
  const guard = async (request: Request<{ id: string }>, response: Response, next: NextFunction) => {
    try {
      const post = await findPost(request.params.id);
      if (!post) return next();

      const actorId = stringParam(request.body?.userId) ?? stringParam(request.body?.authorId) ?? '';
      if (!(await canViewAuthor(store, actorId, post.authorId))) {
        return response.status(403).json({ error: 'この投稿は公開されていません' });
      }
      return next();
    } catch {
      return response.status(500).json({ error: '処理に失敗しました' });
    }
  };
  router.post('/:id/like', guard);
  router.post('/:id/comments', guard);

  return router;
}
