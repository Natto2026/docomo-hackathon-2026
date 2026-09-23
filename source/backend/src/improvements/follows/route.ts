/**
 * 保存先を選べるフォローの API。ハッカソン後に足したもの。
 *
 * 提出時点の routes/users.ts は followService（JSON）を直接呼んでいて、保存先を差し替えられない。
 * そのファイルには手を入れず、同じ URL・同じ応答の形のルーターをここに作り、
 * improvements/auth と同じ要領で、提出時のルーターの手前に差し込む（improvements/app.ts）。
 *
 * 差し込むのは FOLLOW_STORE=dynamodb のときだけ。既定（json）では差し込まず、
 * 提出時点のルーターがそのまま応答する。
 *
 * ここで扱うのは、フォロー関係を読む・書く URL。プロフィール写真の登録と削除は扱わず、
 * 提出時のルーターに流れる。
 *
 *   GET    /api/users                                   一覧（フォロー状態と件数つき）
 *   GET    /api/users/:id                               1人
 *   PATCH  /api/users/:id                               鍵アカウントの切り替え（公開に戻すと保留中を全員承認）
 *   GET    /api/users/:id/posts                         その利用者の投稿（見られなければ locked）
 *   GET    /api/users/:id/followers | following | requests
 *   POST   /api/users/:id/requests/:followerId/approve | reject
 *   GET | POST | DELETE /api/users/:id/follow
 */

import { Request, Response, Router } from 'express';

import { isValidCoordinates } from '../../services/distanceService';
import { listPosts } from '../../services/postService';
import { findUser, listKnownUsers, resolveUsers, updateUser } from '../../services/userService';
import { numberParam, stringParam } from '../../utils/params';
import { FollowAlreadyExistsError, FollowStore, FollowStoreError } from './store';
import { canViewUser, summarizeUsers } from './visibility';

const DEFAULT_USER = 'demo-user-1';

type IdParams = { id: string };
type RequestParams = { id: string; followerId: string };

// 操作者の読み取り方は提出時点の routes/users.ts と同じ（そちらが公開していないので書き直している）
const bodyOf = (request: Request): Record<string, unknown> => (request.body as Record<string, unknown> | undefined) ?? {};
const viewerOf = (request: Request): string => stringParam(request.query.viewerId) ?? DEFAULT_USER;
const followerOf = (request: Request): string =>
  stringParam(bodyOf(request).followerId) ?? stringParam(request.query.followerId) ?? DEFAULT_USER;
const actorOf = (request: Request): string =>
  stringParam(bodyOf(request).userId) ?? stringParam(request.query.userId) ?? viewerOf(request);

/** 保存の層のエラーはその status と文言で、それ以外は 500 と既定の文言で、どちらも JSON で返す。 */
function fail(response: Response, error: unknown, fallback: string) {
  if (error instanceof FollowStoreError) return response.status(error.status).json({ error: error.message });
  return response.status(500).json({ error: fallback });
}

export function createFollowRouter(store: FollowStore): Router {
  const router = Router();

  async function followState(followerId: string, followeeId: string) {
    const status = await store.getStatus(followerId, followeeId);
    return { userId: followeeId, following: status === 'accepted', status, followerCount: await store.countFollowers(followeeId) };
  }

  router.get('/', async (request: Request, response: Response) => {
    try {
      const users = await summarizeUsers(store, await listKnownUsers(), viewerOf(request));
      return response.json({ users, count: users.length });
    } catch (error) { return fail(response, error, 'ユーザー一覧の取得に失敗しました'); }
  });

  router.get('/:id', async (request: Request<IdParams>, response: Response) => {
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      const [summary] = await summarizeUsers(store, [user], viewerOf(request));
      return response.json(summary);
    } catch (error) { return fail(response, error, 'ユーザー情報の取得に失敗しました'); }
  });

  router.patch('/:id', async (request: Request<IdParams>, response: Response) => {
    const body = bodyOf(request);
    if (body.isPrivate !== undefined && typeof body.isPrivate !== 'boolean') {
      return response.status(400).json({ error: 'isPrivate は true か false で指定してください' });
    }
    if (actorOf(request) !== request.params.id) {
      return response.status(403).json({ error: '自分のプロフィールだけ変更できます' });
    }
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      const patch: { isPrivate?: boolean } = {};
      if (typeof body.isPrivate === 'boolean') patch.isPrivate = body.isPrivate;
      const updated = await updateUser(user.id, patch);
      // 公開アカウントに戻したら、待っていたリクエストは全員フォロワーになる
      if (patch.isPrivate === false) await store.approveAllPending(user.id);
      const [summary] = await summarizeUsers(store, [updated ?? user], user.id);
      return response.json(summary);
    } catch (error) { return fail(response, error, 'ユーザー情報の更新に失敗しました'); }
  });

  router.get('/:id/posts', async (request: Request<IdParams>, response: Response) => {
    const latitude = numberParam(request.query.latitude);
    const longitude = numberParam(request.query.longitude);
    const radius = numberParam(request.query.radius) ?? 5000;
    if ((request.query.latitude !== undefined && latitude === undefined) ||
        (request.query.longitude !== undefined && longitude === undefined)) {
      return response.status(400).json({ error: '緯度・経度は数値で指定してください' });
    }
    if (latitude !== undefined && longitude !== undefined && !isValidCoordinates(latitude, longitude)) {
      return response.status(400).json({ error: '緯度または経度が不正です' });
    }
    if (!Number.isFinite(radius) || radius < 0) return response.status(400).json({ error: 'radiusが不正です' });
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      if (!(await canViewUser(store, viewerOf(request), user))) {
        return response.json({ posts: [], count: 0, locked: true });
      }
      const posts = await listPosts(latitude, longitude, radius, { authorIds: [user.id] });
      return response.json({ posts, count: posts.length, locked: false });
    } catch (error) { return fail(response, error, '投稿の取得に失敗しました'); }
  });

  router.get('/:id/followers', async (request: Request<IdParams>, response: Response) => {
    try {
      const ids = await store.listFollowerIds(request.params.id);
      const users = await summarizeUsers(store, await resolveUsers(ids), viewerOf(request));
      return response.json({ users, count: users.length });
    } catch (error) { return fail(response, error, 'フォロワーの取得に失敗しました'); }
  });

  router.get('/:id/following', async (request: Request<IdParams>, response: Response) => {
    try {
      const ids = await store.listFollowingIds(request.params.id);
      const users = await summarizeUsers(store, await resolveUsers(ids), viewerOf(request));
      return response.json({ users, count: users.length });
    } catch (error) { return fail(response, error, 'フォロー中ユーザーの取得に失敗しました'); }
  });

  router.get('/:id/requests', async (request: Request<IdParams>, response: Response) => {
    try {
      const ids = await store.listPendingRequesterIds(request.params.id);
      const users = await summarizeUsers(store, await resolveUsers(ids), request.params.id);
      return response.json({ users, count: users.length });
    } catch (error) { return fail(response, error, 'フォローリクエストの取得に失敗しました'); }
  });

  router.post('/:id/requests/:followerId/approve', async (request: Request<RequestParams>, response: Response) => {
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      // 保留中でなければ（二重承認、取り消し済み）FollowRequestNotFoundError になり、404 で返る
      await store.approve(user.id, request.params.followerId);
      return response.json({ userId: user.id, followerId: request.params.followerId, status: 'accepted', followerCount: await store.countFollowers(user.id) });
    } catch (error) { return fail(response, error, '承認に失敗しました'); }
  });

  router.post('/:id/requests/:followerId/reject', async (request: Request<RequestParams>, response: Response) => {
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      await store.reject(user.id, request.params.followerId);
      return response.json({ userId: user.id, followerId: request.params.followerId, status: 'none', followerCount: await store.countFollowers(user.id) });
    } catch (error) { return fail(response, error, '拒否に失敗しました'); }
  });

  router.get('/:id/follow', async (request: Request<IdParams>, response: Response) => {
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      return response.json(await followState(followerOf(request), user.id));
    } catch (error) { return fail(response, error, 'フォロー状態の取得に失敗しました'); }
  });

  router.post('/:id/follow', async (request: Request<IdParams>, response: Response) => {
    const followerId = followerOf(request);
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      if (followerId === user.id) return response.status(400).json({ error: '自分自身はフォローできません' });
      try {
        await store.create(followerId, user.id, user.isPrivate === true ? 'pending' : 'accepted');
      } catch (error) {
        // 提出時点の API は「既に関係があれば何も変えず、その状態を返す」。
        // ボタンの二度押しを画面側でエラー扱いにしないため、ここでも同じにしている
        if (!(error instanceof FollowAlreadyExistsError)) throw error;
      }
      return response.json(await followState(followerId, user.id));
    } catch (error) { return fail(response, error, 'フォローに失敗しました'); }
  });

  router.delete('/:id/follow', async (request: Request<IdParams>, response: Response) => {
    const followerId = followerOf(request);
    try {
      const user = await findUser(request.params.id);
      if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
      await store.remove(followerId, user.id);
      return response.json(await followState(followerId, user.id));
    } catch (error) { return fail(response, error, 'フォロー解除に失敗しました'); }
  });

  return router;
}
