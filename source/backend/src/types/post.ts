/**
 * 【補助実装】このファイルは、このリポジトリのために新しく書いたものである。
 *
 * 元のプロジェクトでは投稿まわりの型をチームで共同編集していた。
 * 共同成果物のためそのままは含めず、自分が書いたコードのコンパイルに
 * 必要な項目だけを定義し直している。
 */

export type PostType = 'normal' | 'realtime';

export type Comment = {
  id: string;
  postId: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: string;
};

export type Post = {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  imageUrl?: string | null;
  latitude: number;
  longitude: number;
  category?: string;
  placeName?: string;
  placeId?: string;
  placeAddress?: string;
  placeType?: string;
  postType: PostType;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  comments: Comment[];
};

export type PostWithDistance = Post & { distanceMeters?: number };
