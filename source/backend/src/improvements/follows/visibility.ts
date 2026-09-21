/**
 * 公開範囲の判定と利用者の要約を、FollowStore 越しに行う。ハッカソン後に足したもの。
 *
 * 提出時点の userService は、フォロー関係を全件読んでから（readFollows）必要なものを数えていた。
 * JSON なら1回のファイル読み込みで済むが、DynamoDB で同じことをすると Scan になる。
 * ここでは「2者間の状態」と「利用者ごとの一覧・件数」だけで同じ結果を組み立てる。
 *
 * 判定の規則（公開 / 本人 / 承認済みフォロワーなら見える）は userService.canViewPosts と同じ。
 */

import { readPosts } from '../../services/postService';
import { findUser, listKnownUsers } from '../../services/userService';
import { User, UserSummary } from '../../types/user';
import { FollowStore } from './store';

/** viewer がこの利用者の投稿を見られるか。鍵アカウントでなければ保存先に問い合わせない。 */
export async function canViewUser(store: FollowStore, viewerId: string, user: User): Promise<boolean> {
  if (user.isPrivate !== true || user.id === viewerId) return true;
  return (await store.getStatus(viewerId, user.id)) === 'accepted';
}

/** viewer が、この投稿者の投稿を見られるか。知らない投稿者は公開として扱う（提出時点と同じ）。 */
export async function canViewAuthor(store: FollowStore, viewerId: string, authorId: string): Promise<boolean> {
  const author = await findUser(authorId);
  return author ? canViewUser(store, viewerId, author) : true;
}

/** viewer から投稿を隠すべき（鍵アカウントで未承認の）利用者IDの一覧。 */
export async function hiddenAuthorIds(store: FollowStore, viewerId: string): Promise<string[]> {
  const users = await listKnownUsers();
  const visible = await Promise.all(users.map((user) => canViewUser(store, viewerId, user)));
  return users.filter((_user, index) => !visible[index]).map((user) => user.id);
}

/**
 * 利用者の要約。形は提出時点の userService.summarizeUsers と同じ。
 *
 * 利用者1人につき GetItem 1回と Query 3回になる。一覧が長くなると回数が効いてくるので、
 * 本番なら件数を利用者の側に持たせて、関係の書き込みと同じトランザクションで増減させる。
 */
export async function summarizeUsers(store: FollowStore, users: User[], viewerId: string): Promise<UserSummary[]> {
  const posts = await readPosts();
  return Promise.all(
    users.map(async (user) => {
      const [followStatus, followerCount, following, pending] = await Promise.all([
        store.getStatus(viewerId, user.id),
        store.countFollowers(user.id),
        store.listFollowingIds(user.id),
        store.listPendingRequesterIds(user.id),
      ]);
      return {
        ...user,
        isPrivate: user.isPrivate === true,
        postCount: posts.filter((post) => post.authorId === user.id).length,
        followerCount,
        followingCount: following.length,
        isFollowing: followStatus === 'accepted',
        followStatus,
        canViewPosts: user.isPrivate !== true || user.id === viewerId || followStatus === 'accepted',
        pendingRequestCount: pending.length,
      };
    }),
  );
}
