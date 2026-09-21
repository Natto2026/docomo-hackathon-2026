/**
 * JSON 版のアダプタ。ハッカソン後に自分ひとりで足したもの。
 *
 * 提出時点の followService には手を入れず、呼び出すだけで FollowStore の形に合わせる。
 * 保存先は followService と同じ data/follows.json。
 *
 * 違いは2つだけ。
 *   - followService は「該当なし」を false で返す。FollowStore ではエラーにそろえる
 *   - followService の follow は既に関係があっても黙って既存の状態を返す。
 *     FollowStore の create は「新しく作れたか」を区別したいので、先に状態を確かめる
 *
 * 後者の「確かめてから書く」は2回の呼び出しになるため、このアダプタの中で直列化している。
 * 守れるのは同じプロセスの中だけで、これが JSON 版の限界である
 * （DynamoDB 版は条件つき書き込みにして、保存先の側で守る）。
 */

import {
  acceptAllRequests,
  approveRequest,
  countFollowers,
  follow,
  followStatus,
  listFollowerIds,
  listFollowingIds,
  listPendingRequesterIds,
  rejectRequest,
  unfollow,
} from '../../services/followService';
import { FollowAlreadyExistsError, FollowRequestNotFoundError, FollowStore } from './store';

/** create の「確かめてから書く」を同時に走らせないための列。 */
let createQueue: Promise<unknown> = Promise.resolve();

function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const current = createQueue.catch(() => undefined).then(task);
  createQueue = current;
  return current;
}

export function createJsonFollowStore(): FollowStore {
  return {
    kind: 'json',

    getStatus: followStatus,

    create: (followerId, followeeId, status) =>
      inOrder(async () => {
        if ((await followStatus(followerId, followeeId)) !== 'none') throw new FollowAlreadyExistsError();
        await follow(followerId, followeeId, status === 'pending');
      }),

    remove: unfollow,

    async approve(followeeId, followerId) {
      if (!(await approveRequest(followeeId, followerId))) throw new FollowRequestNotFoundError();
    },

    async reject(followeeId, followerId) {
      if (!(await rejectRequest(followeeId, followerId))) throw new FollowRequestNotFoundError();
    },

    approveAllPending: acceptAllRequests,
    listFollowingIds,
    listFollowerIds,
    listPendingRequesterIds,
    countFollowers,
  };
}
