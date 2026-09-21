/**
 * 【補助実装】このファイルは、このリポジトリのために新しく書いたものです。
 *
 * 元のプロジェクトの投稿APIはチームの他メンバーが書いたもので、
 * 共同成果物のためここには含めていません。
 * ただし自分が書いたテスト（tests/users.test.ts）が、フォロー状態と
 * 鍵アカウントの公開範囲を投稿の見え方で検証しているため、
 * そのテストが求める範囲だけを実装し直しています。
 *
 * 公開範囲の判定そのものは、自分が書いた followService / userService を
 * 呼んでいます。ここにあるのは入口の処理だけです。
 *
 * ハッカソン後の追記: フォロー関係の保存先を差し替えられるようにした（improvements/follows）。
 * 保存先を渡されたときは、判定をその保存先に問い合わせる。渡されなければ従来どおり JSON を読む。
 */

import { Request, Response, Router } from 'express';

import { isValidCoordinates } from '../services/distanceService';
import { listFollowingIds } from '../services/followService';
import { findPost, listPosts } from '../services/postService';
import { canViewAuthor, hiddenAuthorIds } from '../services/userService';
import { numberParam, stringParam } from '../utils/params';
import { FollowStore } from '../improvements/follows/store';
import * as storeVisibility from '../improvements/follows/visibility';

const DEFAULT_RADIUS_METERS = 5000;

/** 公開範囲の判定に必要な問い合わせ。 */
type Visibility = {
  listFollowingIds(followerId: string): Promise<string[]>;
  hiddenAuthorIds(viewerId: string): Promise<string[]>;
  canViewAuthor(viewerId: string, authorId: string): Promise<boolean>;
};

function visibilityOf(store?: FollowStore): Visibility {
  if (!store) return { listFollowingIds, hiddenAuthorIds, canViewAuthor };
  return {
    listFollowingIds: (followerId) => store.listFollowingIds(followerId),
    hiddenAuthorIds: (viewerId) => storeVisibility.hiddenAuthorIds(store, viewerId),
    canViewAuthor: (viewerId, authorId) => storeVisibility.canViewAuthor(store, viewerId, authorId),
  };
}

export function createPostsRouter(store?: FollowStore): Router {
  const router = Router();
  const visibility = visibilityOf(store);

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

      const authorIds = followingOf === undefined ? undefined : await visibility.listFollowingIds(followingOf);
      const posts = await listPosts(latitude, longitude, radius, {
        authorIds,
        excludeAuthorIds: await visibility.hiddenAuthorIds(viewerId),
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
      if (!(await visibility.canViewAuthor(viewerId, post.authorId))) {
        return response.status(403).json({ error: 'この投稿は公開されていません' });
      }
      return response.json(post);
    } catch {
      return response.status(500).json({ error: '投稿の取得に失敗しました' });
    }
  });

  /** いいね。見られない投稿には付けられない。 */
  router.post('/:id/like', async (request: Request<{ id: string }>, response: Response) => {
    return guardThenReject(request, response);
  });

  /** コメント。見られない投稿には書けない。 */
  router.post('/:id/comments', async (request: Request<{ id: string }>, response: Response) => {
    return guardThenReject(request, response);
  });

  /**
   * 公開範囲の確認だけを行う。
   *
   * 書き込み自体はチームの他メンバーの実装に含まれるため、ここでは行わない。
   * 権限のない相手を弾くところまでが、自分のテストで検証している範囲。
   */
  async function guardThenReject(request: Request<{ id: string }>, response: Response) {
    try {
      const post = await findPost(request.params.id);
      if (!post) return response.status(404).json({ error: '投稿が見つかりません' });

      const actorId = stringParam(request.body?.userId) ?? stringParam(request.body?.authorId) ?? '';
      if (!(await visibility.canViewAuthor(actorId, post.authorId))) {
        return response.status(403).json({ error: 'この投稿は公開されていません' });
      }
      return response.status(501).json({ error: 'この抽出には書き込みの実装を含めていません' });
    } catch {
      return response.status(500).json({ error: '処理に失敗しました' });
    }
  }

  return router;
}

/** 保存先を指定しない従来の形（JSON を読む）。 */
export default createPostsRouter();
