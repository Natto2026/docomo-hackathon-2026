import { Router, Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { createPost, findPost, listPosts, updatePosts } from '../services/postService';
import { isLiked, removeLikesForPost, toggleLike } from '../services/likeService';
import { listFollowingIds } from '../services/followService';
import { canViewAuthor, findUser, hiddenAuthorIds } from '../services/userService';
import { isValidCoordinates } from '../services/distanceService';
import { numberParam, stringParam } from '../utils/params';
import { imageUpload, removeUploadedFile } from '../utils/upload';
import { reverseAddress } from '../services/placesService';
import { PostType } from '../types/post';

const router = Router();
const DEFAULT_USER = 'demo-user-1';
const DEFAULT_USER_NAME = 'デモユーザー';
const HIDDEN_POST_ERROR = 'この投稿は鍵アカウントのものです。フォローが承認されると閲覧できます';

function validateCoordinates(latitude: number, longitude: number): string | undefined {
  return isValidCoordinates(latitude, longitude) ? undefined : '緯度または経度が不正です';
}

/** 操作するユーザーID。body → query の順で見て、無ければデモユーザー。 */
function actorOf(request: Request, key: string): string {
  const body = (request.body ?? {}) as Record<string, unknown>;
  return stringParam(body[key]) ?? stringParam(request.query[key]) ?? DEFAULT_USER;
}

router.get('/', async (request: Request, response: Response) => {
  const latitude = numberParam(request.query.latitude);
  const longitude = numberParam(request.query.longitude);
  const radius = numberParam(request.query.radius) ?? 5000;
  const authorId = stringParam(request.query.authorId);
  const followingOf = stringParam(request.query.followingOf);
  const viewerId = stringParam(request.query.viewerId) ?? DEFAULT_USER;
  if ((request.query.latitude !== undefined && latitude === undefined) ||
      (request.query.longitude !== undefined && longitude === undefined)) {
    return response.status(400).json({ error: '緯度・経度は数値で指定してください' });
  }
  if (latitude !== undefined && longitude !== undefined) {
    const coordinateError = validateCoordinates(latitude, longitude);
    if (coordinateError) return response.status(400).json({ error: coordinateError });
  }
  if (!Number.isFinite(radius) || radius < 0) return response.status(400).json({ error: 'radiusが不正です' });
  try {
    // followingOf: そのユーザーがフォロー中の投稿者だけに絞る / authorId: 特定の投稿者だけに絞る
    let authorIds: string[] | undefined;
    if (followingOf) authorIds = await listFollowingIds(followingOf);
    if (authorId) authorIds = authorIds ? authorIds.filter((id) => id === authorId) : [authorId];
    // 鍵アカウントで未承認の投稿者は viewer から隠す
    const posts = await listPosts(latitude, longitude, radius, { authorIds, excludeAuthorIds: await hiddenAuthorIds(viewerId) });
    return response.json({ posts, count: posts.length });
  } catch { return response.status(500).json({ error: '投稿一覧の取得に失敗しました' }); }
});

router.get('/:id', async (request: Request<{ id: string }>, response: Response) => {
  const viewerId = stringParam(request.query.viewerId) ?? DEFAULT_USER;
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    if (!(await canViewAuthor(viewerId, post.authorId))) return response.status(403).json({ error: HIDDEN_POST_ERROR });
    return response.json(post);
  } catch { return response.status(500).json({ error: '投稿の取得に失敗しました' }); }
});

router.post('/', imageUpload.single('image'), async (request: Request, response: Response) => {
  const source = request.body as Record<string, unknown>;
  const body = typeof source.body === 'string' ? source.body.trim() : '';
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  const postType = source.postType === undefined ? 'normal' : source.postType;
  if (!body) return response.status(400).json({ error: '本文を入力してください' });
  if (body.length > 500) return response.status(400).json({ error: '本文は500文字以内で入力してください' });
  const coordinateError = validateCoordinates(latitude, longitude);
  if (coordinateError) return response.status(400).json({ error: coordinateError });
  if (postType !== 'normal' && postType !== 'realtime') return response.status(400).json({ error: 'postTypeが不正です' });
  const imageUrl = request.file ? `${request.protocol}://${request.get('host')}/uploads/${request.file.filename}` : null;
  // 投稿者名は登録済みユーザーの名前を優先する(クライアントの申告名は未知のユーザーのときだけ使う)
  const authorId = stringParam(source.authorId) ?? DEFAULT_USER;
  const authorName = (await findUser(authorId))?.name ?? stringParam(source.authorName) ?? DEFAULT_USER_NAME;
  // 投稿場所の施設(任意)。Places の候補から選んだ場合は placeId も付く
  const placeName = stringParam(source.placeName)?.slice(0, 120);
  const placeId = placeName ? stringParam(source.placeId)?.slice(0, 200) : undefined;
  let placeAddress = placeName ? stringParam(source.placeAddress)?.slice(0, 200) : undefined;
  const placeType = placeName ? stringParam(source.placeType)?.slice(0, 60) : undefined;
  // 店名はあるのに住所が無い(OpenStreetMap 由来など)場合は、座標から住所を補う。取れなくても投稿は通す
  if (placeName && !placeAddress) {
    try {
      const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 4000));
      const resolved = await Promise.race([reverseAddress(latitude, longitude), timeout]);
      placeAddress = resolved?.address;
    } catch { /* 住所補完は任意 */ }
  }
  const post = await createPost({
    authorId,
    authorName,
    placeName,
    placeId,
    placeAddress,
    placeType,
    body,
    imageUrl,
    latitude,
    longitude,
    category: typeof source.category === 'string' ? source.category : undefined,
    postType: postType as PostType,
  });
  return response.status(201).json({ post });
});

/** 投稿の削除。投稿者本人だけができる。いいねと画像ファイルも消す。 */
router.delete('/:id', async (request: Request<{ id: string }>, response: Response) => {
  const userId = actorOf(request, 'userId');
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    if (post.authorId !== userId) return response.status(403).json({ error: '自分の投稿だけ削除できます' });
    await updatePosts((posts) => posts.filter((item) => item.id !== post.id));
    await removeLikesForPost(post.id);
    await removeUploadedFile(post.imageUrl);
    return response.json({ deleted: true, id: post.id });
  } catch { return response.status(500).json({ error: '投稿の削除に失敗しました' }); }
});

/** コメントの削除。書いた本人か、その投稿の投稿者ができる。 */
router.delete('/:id/comments/:commentId', async (request: Request<{ id: string; commentId: string }>, response: Response) => {
  const userId = actorOf(request, 'userId');
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    const comment = post.comments.find((item) => item.id === request.params.commentId);
    if (!comment) return response.status(404).json({ error: 'コメントが見つかりません' });
    if (comment.authorId !== userId && post.authorId !== userId) {
      return response.status(403).json({ error: '自分のコメントか、自分の投稿へのコメントだけ削除できます' });
    }
    const posts = await updatePosts((items) => items.map((item) => item.id === post.id
      ? { ...item, comments: item.comments.filter((c) => c.id !== comment.id), commentCount: Math.max(0, item.commentCount - 1) }
      : item));
    const updated = posts.find((item) => item.id === post.id);
    return response.json({ deleted: true, commentId: comment.id, commentCount: updated?.commentCount ?? 0 });
  } catch { return response.status(500).json({ error: 'コメントの削除に失敗しました' }); }
});

router.get('/:id/like', async (request: Request<{ id: string }>, response: Response) => {
  const userId = typeof request.query.userId === 'string' && request.query.userId.trim() ? request.query.userId.trim() : 'demo-user-1';
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    return response.json({ postId: post.id, liked: await isLiked(userId, post.id) });
  } catch { return response.status(500).json({ error: 'いいね状態の取得に失敗しました' }); }
});

router.post('/:id/like', async (request: Request<{ id: string }>, response: Response) => {
  const userId = actorOf(request, 'userId');
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    // 閲覧できない鍵アカウントの投稿にはいいねできない
    if (!(await canViewAuthor(userId, post.authorId))) return response.status(403).json({ error: HIDDEN_POST_ERROR });
    const liked = await toggleLike(userId, post.id);
    const updated = (await updatePosts((posts) => posts.map((item) => item.id === post.id
      ? { ...item, likeCount: Math.max(0, item.likeCount + (liked ? 1 : -1)) }
      : item))).find((item) => item.id === post.id);
    return response.json({ postId: post.id, likeCount: updated?.likeCount ?? post.likeCount, liked });
  } catch { return response.status(500).json({ error: 'いいねに失敗しました' }); }
});

router.delete('/:id/like', async (request: Request<{ id: string }>, response: Response) => {
  const userId = typeof request.body?.userId === 'string' && request.body.userId.trim() ? request.body.userId.trim() : 'demo-user-1';
  try {
    const post = await findPost(request.params.id);
    if (!post) return response.status(404).json({ error: '投稿が見つかりません' });
    const wasLiked = await isLiked(userId, post.id);
    if (wasLiked) await toggleLike(userId, post.id);
    const updated = wasLiked
      ? (await updatePosts((posts) => posts.map((item) => item.id === post.id
          ? { ...item, likeCount: Math.max(0, item.likeCount - 1) }
          : item))).find((item) => item.id === post.id)
      : post;
    return response.json({ postId: post.id, likeCount: updated?.likeCount ?? post.likeCount, liked: false });
  } catch { return response.status(500).json({ error: 'いいねの取り消しに失敗しました' }); }
});

router.post('/:id/comments', async (request: Request<{ id: string }>, response: Response) => {
  const source = (request.body ?? {}) as Record<string, unknown>;
  const body = typeof source.body === 'string' ? source.body.trim() : '';
  if (!body || body.length > 300) return response.status(400).json({ error: 'コメントは1〜300文字で入力してください' });
  // コメント投稿者は操作中のユーザー。既知のユーザーなら登録名を使う
  const authorId = actorOf(request, 'authorId');
  let comment;
  try {
    const target = await findPost(request.params.id);
    if (!target) return response.status(404).json({ error: '投稿が見つかりません' });
    // 閲覧できない鍵アカウントの投稿にはコメントできない
    if (!(await canViewAuthor(authorId, target.authorId))) return response.status(403).json({ error: HIDDEN_POST_ERROR });
    const authorName = (await findUser(authorId))?.name ?? stringParam(source.authorName) ?? DEFAULT_USER_NAME;
    const posts = await updatePosts((items) => items.map((post) => {
      if (post.id !== request.params.id) return post;
      comment = { id: `comment-${uuid()}`, postId: post.id, authorId, authorName, body, createdAt: new Date().toISOString() };
      return { ...post, comments: [...post.comments, comment], commentCount: post.commentCount + 1 };
    }));
    if (!posts.some((post) => post.id === request.params.id)) return response.status(404).json({ error: '投稿が見つかりません' });
  } catch { return response.status(500).json({ error: 'コメントに失敗しました' }); }
  return response.status(201).json({ comment });
});

export default router;
