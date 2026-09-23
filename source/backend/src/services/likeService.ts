import path from 'node:path';
import { readJsonArray, updateJsonArray } from './jsonStore';

type Like = {
  userId: string;
  postId: string;
};

const DATA_FILE = path.resolve(__dirname, '../../data/likes.json');
const FORMAT_ERROR = 'いいねデータの形式が不正です';

const matches = (userId: string, postId: string) => (like: Like) => like.userId === userId && like.postId === postId;

export async function isLiked(userId: string, postId: string): Promise<boolean> {
  return (await readJsonArray<Like>(DATA_FILE, FORMAT_ERROR)).some(matches(userId, postId));
}

/** いいねを付ける / 外す。付けたら true、外したら false。ロック付きで更新する。 */
export async function toggleLike(userId: string, postId: string): Promise<boolean> {
  let liked = false;
  await updateJsonArray<Like>(DATA_FILE, FORMAT_ERROR, (likes) => {
    if (likes.some(matches(userId, postId))) {
      liked = false;
      return likes.filter((like) => !matches(userId, postId)(like));
    }
    liked = true;
    return [...likes, { userId, postId }];
  });
  return liked;
}

/** 投稿を削除したとき、その投稿へのいいねをすべて消す。 */
export async function removeLikesForPost(postId: string): Promise<void> {
  await updateJsonArray<Like>(DATA_FILE, FORMAT_ERROR, (likes) => {
    const remaining = likes.filter((like) => like.postId !== postId);
    return remaining.length === likes.length ? likes : remaining;
  });
}
