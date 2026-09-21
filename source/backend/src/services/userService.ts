import path from 'node:path';
import { readJsonArray, updateJsonArray } from './jsonStore';
import { readPosts } from './postService';
import { readFollows } from './followService';
import { Follow, User, UserSummary } from '../types/user';

const DATA_FILE = path.resolve(__dirname, '../../data/users.json');
const FORMAT_ERROR = 'ユーザーデータの形式が不正です';

export function readUsers(): Promise<User[]> {
  return readJsonArray<User>(DATA_FILE, FORMAT_ERROR);
}

/** users.json のユーザーに、投稿者としてしか現れないユーザーを加えた一覧。 */
export async function listKnownUsers(): Promise<User[]> {
  const known = new Map<string, User>();
  for (const user of await readUsers()) known.set(user.id, user);
  for (const post of await readPosts()) {
    if (!known.has(post.authorId)) {
      known.set(post.authorId, { id: post.authorId, name: post.authorName, createdAt: post.createdAt });
    }
  }
  return [...known.values()];
}

export async function findUser(id: string): Promise<User | undefined> {
  return (await listKnownUsers()).find((user) => user.id === id);
}

/** ユーザー情報を更新して保存する。users.json に無い投稿者由来のユーザーは新規に追加する。 */
export async function updateUser(id: string, patch: Partial<Pick<User, 'name' | 'bio' | 'isPrivate' | 'avatarUrl'>>): Promise<User | undefined> {
  const user = await findUser(id);
  if (!user) return undefined;
  const updated: User = { ...user, ...patch };
  await updateJsonArray<User>(DATA_FILE, FORMAT_ERROR, (users) => {
    const index = users.findIndex((item) => item.id === id);
    return index >= 0 ? users.map((item, position) => (position === index ? updated : item)) : [...users, updated];
  });
  return updated;
}

/** viewer が、この投稿者の投稿を見られるか(いいね・コメントの可否判定にも使う)。 */
export async function canViewAuthor(viewerId: string, authorId: string): Promise<boolean> {
  const [author, follows] = await Promise.all([findUser(authorId), readFollows()]);
  if (!author) return true;
  return canViewPosts(follows, viewerId, author);
}

/** ID の配列をユーザーに変換する。未知の ID は ID を名前にした仮ユーザーになる。 */
export async function resolveUsers(ids: string[]): Promise<User[]> {
  const known = new Map((await listKnownUsers()).map((user) => [user.id, user] as const));
  return ids.map((id) => known.get(id) ?? { id, name: id, createdAt: '' });
}

const isAccepted = (follows: Follow[], followerId: string, followeeId: string) =>
  follows.some((item) => item.followerId === followerId && item.followeeId === followeeId && item.status === 'accepted');

/** viewer がそのユーザーの投稿を見られるか(公開 / 本人 / 承認済みフォロワー)。 */
export function canViewPosts(follows: Follow[], viewerId: string, user: User): boolean {
  return user.isPrivate !== true || user.id === viewerId || isAccepted(follows, viewerId, user.id);
}

/** viewer から投稿を隠すべき(鍵アカウントで未承認の)ユーザーIDの一覧。 */
export async function hiddenAuthorIds(viewerId: string): Promise<string[]> {
  const [users, follows] = await Promise.all([listKnownUsers(), readFollows()]);
  return users.filter((user) => !canViewPosts(follows, viewerId, user)).map((user) => user.id);
}

export async function summarizeUsers(users: User[], viewerId: string): Promise<UserSummary[]> {
  const [posts, follows] = await Promise.all([readPosts(), readFollows()]);
  return users.map((user) => {
    const relation = follows.find((item) => item.followerId === viewerId && item.followeeId === user.id);
    const followStatus = relation?.status ?? 'none';
    return {
      ...user,
      isPrivate: user.isPrivate === true,
      postCount: posts.filter((post) => post.authorId === user.id).length,
      followerCount: follows.filter((item) => item.followeeId === user.id && item.status === 'accepted').length,
      followingCount: follows.filter((item) => item.followerId === user.id && item.status === 'accepted').length,
      isFollowing: followStatus === 'accepted',
      followStatus,
      canViewPosts: canViewPosts(follows, viewerId, user),
      pendingRequestCount: follows.filter((item) => item.followeeId === user.id && item.status === 'pending').length,
    };
  });
}
