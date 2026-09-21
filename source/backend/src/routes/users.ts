import { Router, Request, Response } from 'express';
import { listPosts } from '../services/postService';
import { isValidCoordinates } from '../services/distanceService';
import {
  acceptAllRequests, approveRequest, countFollowers, follow, followStatus, listFollowerIds, listFollowingIds,
  listPendingRequesterIds, readFollows, rejectRequest, unfollow,
} from '../services/followService';
import { canViewPosts, findUser, listKnownUsers, resolveUsers, summarizeUsers, updateUser } from '../services/userService';
import { numberParam, stringParam } from '../utils/params';
import { imageUpload } from '../utils/upload';

const router = Router();
const DEFAULT_USER = 'demo-user-1';

type IdParams = { id: string };
type RequestParams = { id: string; followerId: string };

const bodyOf = (request: Request): Record<string, unknown> => (request.body as Record<string, unknown> | undefined) ?? {};
const viewerOf = (request: Request): string => stringParam(request.query.viewerId) ?? DEFAULT_USER;
const followerOf = (request: Request): string =>
  stringParam(bodyOf(request).followerId) ?? stringParam(request.query.followerId) ?? DEFAULT_USER;

/** 操作しているユーザー。自分のプロフィールだけを変えられるようにするために使う。 */
const actorOf = (request: Request): string =>
  stringParam(bodyOf(request).userId) ?? stringParam(request.query.userId) ?? viewerOf(request);

/**
 * 自分自身への操作かを確かめる。
 * 認証が未導入のため、操作者はクライアントの申告(userId)に頼っている。
 * 認証を入れたら、ここをセッションのユーザーと比べるように差し替える。
 */
function assertSelf(request: Request<IdParams>, response: Response): boolean {
  if (actorOf(request) === request.params.id) return true;
  response.status(403).json({ error: '自分のプロフィールだけ変更できます' });
  return false;
}

async function followState(followerId: string, followeeId: string) {
  const status = await followStatus(followerId, followeeId);
  return { userId: followeeId, following: status === 'accepted', status, followerCount: await countFollowers(followeeId) };
}

router.get('/', async (request: Request, response: Response) => {
  try {
    const users = await summarizeUsers(await listKnownUsers(), viewerOf(request));
    return response.json({ users, count: users.length });
  } catch { return response.status(500).json({ error: 'ユーザー一覧の取得に失敗しました' }); }
});

router.get('/:id', async (request: Request<IdParams>, response: Response) => {
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    const [summary] = await summarizeUsers([user], viewerOf(request));
    return response.json(summary);
  } catch { return response.status(500).json({ error: 'ユーザー情報の取得に失敗しました' }); }
});

/** 鍵アカウントの切り替えなど、自分のプロフィールの更新。 */
router.patch('/:id', async (request: Request<IdParams>, response: Response) => {
  const body = bodyOf(request);
  if (body.isPrivate !== undefined && typeof body.isPrivate !== 'boolean') {
    return response.status(400).json({ error: 'isPrivate は true か false で指定してください' });
  }
  if (!assertSelf(request, response)) return;
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    const patch: { isPrivate?: boolean } = {};
    if (typeof body.isPrivate === 'boolean') patch.isPrivate = body.isPrivate;
    const updated = await updateUser(user.id, patch);
    // 公開アカウントに戻したら、待っていたリクエストは全員フォロワーになる
    if (patch.isPrivate === false) await acceptAllRequests(user.id);
    const [summary] = await summarizeUsers([updated ?? user], user.id);
    return response.json(summary);
  } catch { return response.status(500).json({ error: 'ユーザー情報の更新に失敗しました' }); }
});

/** プロフィール写真の登録(multipart の image フィールド)。 */
router.post('/:id/avatar', imageUpload.single('image'), async (request: Request<IdParams>, response: Response) => {
  if (!request.file) return response.status(400).json({ error: '画像ファイル(jpg/png/webp、10MB以下)を指定してください' });
  if (!assertSelf(request, response)) return;
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    const avatarUrl = `${request.protocol}://${request.get('host')}/uploads/${request.file.filename}`;
    const updated = await updateUser(user.id, { avatarUrl });
    const [summary] = await summarizeUsers([updated ?? user], user.id);
    return response.json(summary);
  } catch { return response.status(500).json({ error: 'プロフィール写真の登録に失敗しました' }); }
});

/** プロフィール写真の削除。 */
router.delete('/:id/avatar', async (request: Request<IdParams>, response: Response) => {
  if (!assertSelf(request, response)) return;
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    const updated = await updateUser(user.id, { avatarUrl: null });
    const [summary] = await summarizeUsers([updated ?? user], user.id);
    return response.json(summary);
  } catch { return response.status(500).json({ error: 'プロフィール写真の削除に失敗しました' }); }
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
    if (!canViewPosts(await readFollows(), viewerOf(request), user)) {
      return response.json({ posts: [], count: 0, locked: true });
    }
    const posts = await listPosts(latitude, longitude, radius, { authorIds: [user.id] });
    return response.json({ posts, count: posts.length, locked: false });
  } catch { return response.status(500).json({ error: '投稿の取得に失敗しました' }); }
});

router.get('/:id/followers', async (request: Request<IdParams>, response: Response) => {
  try {
    const users = await summarizeUsers(await resolveUsers(await listFollowerIds(request.params.id)), viewerOf(request));
    return response.json({ users, count: users.length });
  } catch { return response.status(500).json({ error: 'フォロワーの取得に失敗しました' }); }
});

router.get('/:id/following', async (request: Request<IdParams>, response: Response) => {
  try {
    const users = await summarizeUsers(await resolveUsers(await listFollowingIds(request.params.id)), viewerOf(request));
    return response.json({ users, count: users.length });
  } catch { return response.status(500).json({ error: 'フォロー中ユーザーの取得に失敗しました' }); }
});

/** :id に届いている未承認のフォローリクエスト一覧。 */
router.get('/:id/requests', async (request: Request<IdParams>, response: Response) => {
  try {
    const users = await summarizeUsers(await resolveUsers(await listPendingRequesterIds(request.params.id)), request.params.id);
    return response.json({ users, count: users.length });
  } catch { return response.status(500).json({ error: 'フォローリクエストの取得に失敗しました' }); }
});

router.post('/:id/requests/:followerId/approve', async (request: Request<RequestParams>, response: Response) => {
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    if (!(await approveRequest(user.id, request.params.followerId))) {
      return response.status(404).json({ error: 'フォローリクエストが見つかりません' });
    }
    return response.json({ userId: user.id, followerId: request.params.followerId, status: 'accepted', followerCount: await countFollowers(user.id) });
  } catch { return response.status(500).json({ error: '承認に失敗しました' }); }
});

router.post('/:id/requests/:followerId/reject', async (request: Request<RequestParams>, response: Response) => {
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    if (!(await rejectRequest(user.id, request.params.followerId))) {
      return response.status(404).json({ error: 'フォローリクエストが見つかりません' });
    }
    return response.json({ userId: user.id, followerId: request.params.followerId, status: 'none', followerCount: await countFollowers(user.id) });
  } catch { return response.status(500).json({ error: '拒否に失敗しました' }); }
});

router.get('/:id/follow', async (request: Request<IdParams>, response: Response) => {
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    return response.json(await followState(followerOf(request), user.id));
  } catch { return response.status(500).json({ error: 'フォロー状態の取得に失敗しました' }); }
});

/** フォロー。相手が鍵アカウントならリクエスト(pending)になる。 */
router.post('/:id/follow', async (request: Request<IdParams>, response: Response) => {
  const followerId = followerOf(request);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    if (followerId === user.id) return response.status(400).json({ error: '自分自身はフォローできません' });
    await follow(followerId, user.id, user.isPrivate === true);
    return response.json(await followState(followerId, user.id));
  } catch { return response.status(500).json({ error: 'フォローに失敗しました' }); }
});

/** フォロー解除(リクエストの取り消しも同じ)。 */
router.delete('/:id/follow', async (request: Request<IdParams>, response: Response) => {
  const followerId = followerOf(request);
  try {
    const user = await findUser(request.params.id);
    if (!user) return response.status(404).json({ error: 'ユーザーが見つかりません' });
    await unfollow(followerId, user.id);
    return response.json(await followState(followerId, user.id));
  } catch { return response.status(500).json({ error: 'フォロー解除に失敗しました' }); }
});

export default router;
