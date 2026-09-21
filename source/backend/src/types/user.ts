/** viewer から見た相手へのフォロー状態。pending は鍵アカウントへの未承認リクエスト。 */
export type FollowStatus = 'none' | 'pending' | 'accepted';

export type User = {
  id: string;
  name: string;
  bio?: string;
  /** true なら鍵アカウント。投稿は承認済みフォロワーにしか見えない。 */
  isPrivate?: boolean;
  /** プロフィール写真の URL。未設定なら null / undefined。 */
  avatarUrl?: string | null;
  createdAt: string;
};

export type Follow = {
  followerId: string;
  followeeId: string;
  status: Exclude<FollowStatus, 'none'>;
  createdAt: string;
};

export type UserSummary = User & {
  isPrivate: boolean;
  postCount: number;
  followerCount: number;
  followingCount: number;
  /** viewer が承認済みでフォローしているか */
  isFollowing: boolean;
  followStatus: FollowStatus;
  /** viewer がこのユーザーの投稿を見られるか(公開 / 本人 / 承認済みフォロワー) */
  canViewPosts: boolean;
  /** このユーザーに届いている未承認のフォローリクエスト数 */
  pendingRequestCount: number;
};
