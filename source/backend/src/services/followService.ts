import path from 'node:path';
import { readJsonArray, updateJsonArray } from './jsonStore';
import { Follow, FollowStatus } from '../types/user';

const DATA_FILE = path.resolve(__dirname, '../../data/follows.json');
const FORMAT_ERROR = 'フォローデータの形式が不正です';

type StoredFollow = Partial<Follow> & { followerId: string; followeeId: string };

/** status が無い古いデータは承認済みとして扱う。 */
function normalize(items: StoredFollow[]): Follow[] {
  return items.map((item) => ({
    followerId: item.followerId,
    followeeId: item.followeeId,
    status: item.status === 'pending' ? 'pending' : 'accepted',
    createdAt: item.createdAt ?? '',
  }));
}

export async function readFollows(): Promise<Follow[]> {
  return normalize(await readJsonArray<StoredFollow>(DATA_FILE, FORMAT_ERROR));
}

/** ロック付きで更新する。update が同じ配列を返せば書き込まない。 */
function updateFollows(update: (follows: Follow[]) => Follow[]): Promise<Follow[]> {
  return updateJsonArray<StoredFollow>(DATA_FILE, FORMAT_ERROR, (items) => {
    const follows = normalize(items);
    const next = update(follows);
    return next === follows ? items : next;
  }) as Promise<Follow[]>;
}

const matches = (followerId: string, followeeId: string) => (follow: Follow) =>
  follow.followerId === followerId && follow.followeeId === followeeId;

export async function followStatus(followerId: string, followeeId: string): Promise<FollowStatus> {
  return (await readFollows()).find(matches(followerId, followeeId))?.status ?? 'none';
}

export async function isFollowing(followerId: string, followeeId: string): Promise<boolean> {
  return (await followStatus(followerId, followeeId)) === 'accepted';
}

/**
 * フォローする。相手が鍵アカウントなら pending(リクエスト)、公開なら accepted になる。
 * 既に関係があれば何も変えず、その状態を返す。
 */
export async function follow(followerId: string, followeeId: string, requiresApproval: boolean): Promise<FollowStatus> {
  let status: FollowStatus = 'none';
  await updateFollows((follows) => {
    const existing = follows.find(matches(followerId, followeeId));
    if (existing) {
      status = existing.status;
      return follows;
    }
    status = requiresApproval ? 'pending' : 'accepted';
    return [...follows, { followerId, followeeId, status, createdAt: new Date().toISOString() }];
  });
  return status;
}

/** フォロー解除(未承認リクエストの取り消しも兼ねる)。関係が無ければ false。 */
export async function unfollow(followerId: string, followeeId: string): Promise<boolean> {
  let removed = false;
  await updateFollows((follows) => {
    const remaining = follows.filter((item) => !matches(followerId, followeeId)(item));
    removed = remaining.length !== follows.length;
    return removed ? remaining : follows;
  });
  return removed;
}

/** 鍵アカウントの持ち主がリクエストを承認する。該当リクエストが無ければ false。 */
export async function approveRequest(followeeId: string, followerId: string): Promise<boolean> {
  let approved = false;
  await updateFollows((follows) => {
    const next = follows.map((item) => {
      if (matches(followerId, followeeId)(item) && item.status === 'pending') {
        approved = true;
        return { ...item, status: 'accepted' as const };
      }
      return item;
    });
    return approved ? next : follows;
  });
  return approved;
}

/** リクエストを拒否(削除)する。該当リクエストが無ければ false。 */
export async function rejectRequest(followeeId: string, followerId: string): Promise<boolean> {
  let rejected = false;
  await updateFollows((follows) => {
    const remaining = follows.filter((item) => !(matches(followerId, followeeId)(item) && item.status === 'pending'));
    rejected = remaining.length !== follows.length;
    return rejected ? remaining : follows;
  });
  return rejected;
}

/** 公開アカウントに戻したとき、溜まっていたリクエストをすべて承認する。承認した件数を返す。 */
export async function acceptAllRequests(followeeId: string): Promise<number> {
  let accepted = 0;
  await updateFollows((follows) => {
    const next = follows.map((item) => {
      if (item.followeeId === followeeId && item.status === 'pending') {
        accepted += 1;
        return { ...item, status: 'accepted' as const };
      }
      return item;
    });
    return accepted > 0 ? next : follows;
  });
  return accepted;
}

export async function listFollowingIds(followerId: string): Promise<string[]> {
  return (await readFollows())
    .filter((item) => item.followerId === followerId && item.status === 'accepted')
    .map((item) => item.followeeId);
}

export async function listFollowerIds(followeeId: string): Promise<string[]> {
  return (await readFollows())
    .filter((item) => item.followeeId === followeeId && item.status === 'accepted')
    .map((item) => item.followerId);
}

export async function listPendingRequesterIds(followeeId: string): Promise<string[]> {
  return (await readFollows())
    .filter((item) => item.followeeId === followeeId && item.status === 'pending')
    .map((item) => item.followerId);
}

export async function countFollowers(followeeId: string): Promise<number> {
  return (await listFollowerIds(followeeId)).length;
}
