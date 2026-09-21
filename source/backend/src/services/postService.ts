/**
 * 【補助実装】このファイルは、このリポジトリのために新しく書いたものです。
 *
 * 元のプロジェクトでは投稿の保存・取得をチームで共同編集していました。
 * 共同成果物のためそのままは含めず、自分が書いたコード（routes/users.ts と
 * services/userService.ts）が必要とする関数だけを実装し直しています。
 *
 * 保存の直列化は、自分が書いた jsonStore をそのまま使っています。
 */

import path from 'node:path';

import type { Post, PostWithDistance } from '../types/post';
import { distanceMeters } from './distanceService';
import { readJsonArray, updateJsonArray } from './jsonStore';

const DATA_FILE = path.resolve(__dirname, '../../data/posts.json');
const FORMAT_ERROR = '投稿データの形式が不正です';

export type PostFilter = {
  /** 指定すると、この投稿者IDの投稿だけを返す。 */
  authorIds?: string[];
  /** この投稿者IDの投稿は除外する（鍵アカウントで未承認など）。 */
  excludeAuthorIds?: string[];
};

export function readPosts(): Promise<Post[]> {
  return readJsonArray<Post>(DATA_FILE, FORMAT_ERROR);
}

export async function findPost(id: string): Promise<Post | undefined> {
  return (await readPosts()).find((post) => post.id === id);
}

/** 現在地からの距離で絞り、新しい順に返す。 */
export async function listPosts(
  latitude?: number,
  longitude?: number,
  radius = 5000,
  filter: PostFilter = {},
): Promise<PostWithDistance[]> {
  const allowed = filter.authorIds ? new Set(filter.authorIds) : undefined;
  const excluded = new Set(filter.excludeAuthorIds ?? []);

  return (await readPosts())
    .filter((post) => allowed === undefined || allowed.has(post.authorId))
    .filter((post) => !excluded.has(post.authorId))
    .map<PostWithDistance>((post) => {
      if (latitude === undefined || longitude === undefined) return { ...post };
      const distance = distanceMeters(latitude, longitude, post.latitude, post.longitude);
      return { ...post, distanceMeters: Math.round(distance) };
    })
    .filter((post) => post.distanceMeters === undefined || post.distanceMeters <= radius)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** ロック付きで投稿一覧を更新する（同時のいいね・コメントで互いの変更を消さない）。 */
export function updatePosts(update: (posts: Post[]) => Post[]): Promise<Post[]> {
  return updateJsonArray<Post>(DATA_FILE, FORMAT_ERROR, update);
}
