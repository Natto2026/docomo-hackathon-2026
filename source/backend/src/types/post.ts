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
  /** 投稿場所の店・施設名(任意)。Places の候補から選んだ場合は placeId / placeAddress も入る */
  placeName?: string;
  placeId?: string;
  placeAddress?: string;
  /** 施設の種類(cafe, convenience など。Places / OSM の分類をそのまま保存) */
  placeType?: string;
  postType: PostType;
  likeCount: number;
  commentCount: number;
  createdAt: string;
  comments: Comment[];
};

export type PostWithDistance = Post & { distanceMeters?: number };
