import path from 'node:path';
import { v4 as uuid } from 'uuid';
import { distanceMeters } from './distanceService';
import { readJsonArray, updateJsonArray, writeJsonArray } from './jsonStore';
import { Post, PostWithDistance } from '../types/post';

const DATA_FILE = path.resolve(__dirname, '../../data/posts.json');
const FORMAT_ERROR = '投稿データの形式が不正です';

export type PostFilter = {
  /** 指定すると、この投稿者IDの投稿だけを返す。 */
  authorIds?: string[];
  /** この投稿者IDの投稿は除外する(鍵アカウントで未承認など)。 */
  excludeAuthorIds?: string[];
};

export function readPosts(): Promise<Post[]> {
  return readJsonArray<Post>(DATA_FILE, FORMAT_ERROR);
}

export function writePosts(posts: Post[]): Promise<void> {
  return writeJsonArray(DATA_FILE, posts);
}

export async function listPosts(latitude?: number, longitude?: number, radius = 5000, filter: PostFilter = {}): Promise<PostWithDistance[]> {
  const posts = await readPosts();
  const allowedAuthors = filter.authorIds ? new Set(filter.authorIds) : undefined;
  const excludedAuthors = new Set(filter.excludeAuthorIds ?? []);
  return posts
    .filter((post) => allowedAuthors === undefined || allowedAuthors.has(post.authorId))
    .filter((post) => !excludedAuthors.has(post.authorId))
    .map<PostWithDistance>((post) => {
      if (latitude === undefined || longitude === undefined) return { ...post };
      return { ...post, distanceMeters: Math.round(distanceMeters(latitude, longitude, post.latitude, post.longitude)) };
    })
    .filter((post) => post.distanceMeters === undefined || post.distanceMeters <= radius)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function findPost(id: string): Promise<Post | undefined> {
  return (await readPosts()).find((post) => post.id === id);
}

export async function createPost(input: Omit<Post, 'id' | 'createdAt' | 'likeCount' | 'commentCount' | 'comments'>): Promise<Post> {
  const post: Post = {
    ...input,
    id: `post-${uuid()}`,
    likeCount: 0,
    commentCount: 0,
    comments: [],
    createdAt: new Date().toISOString(),
  };
  await updateJsonArray<Post>(DATA_FILE, FORMAT_ERROR, (posts) => [...posts, post]);
  return post;
}

/** ロック付きで投稿一覧を更新する(同時のいいね・コメントで互いの変更を消さない)。 */
export function updatePosts(update: (posts: Post[]) => Post[]): Promise<Post[]> {
  return updateJsonArray<Post>(DATA_FILE, FORMAT_ERROR, update);
}
