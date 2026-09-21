/**
 * フォロー関係の保存の抽象。ハッカソン後に足したもの。
 *
 * 提出時点の followService は JSON ファイルに直接書いている。ファイルごとの直列化キューで
 * 同時書き込みを防いでいるが、キューはプロセスの中にあるので、サーバーを複数立てた時点で
 * 守れなくなる。保存先を差し替えられるよう、必要な操作だけを interface に切り出した。
 *
 * 操作の集合は、提出時点の routes/users.ts・routes/posts.ts・userService が
 * followService を実際にどう使っているかから決めている。
 *
 *   followStatus            → getStatus
 *   follow                  → create（既にあれば FollowAlreadyExistsError）
 *   unfollow                → remove
 *   approveRequest          → approve（保留中でなければ FollowRequestNotFoundError）
 *   rejectRequest           → reject （同上）
 *   acceptAllRequests       → approveAllPending
 *   listFollowingIds / listFollowerIds / listPendingRequesterIds / countFollowers → 同名
 *
 * readFollows（全件の読み出し）だけは入れていない。DynamoDB では Scan になるため。
 * 全件から数えていた箇所は、2者間の状態と、利用者ごとの一覧に置き換える（visibility.ts）。
 *
 * 一覧の並び順は interface としては決めない（JSON は追加順、DynamoDB はキー順になる）。
 */

import { FollowStatus } from '../../types/user';

/** 保存される関係の状態。'none' は「項目が無い」ことで表す。 */
export type StoredFollowStatus = Exclude<FollowStatus, 'none'>;

export interface FollowStore {
  /** 保存先の種類。ログと確認用。 */
  readonly kind: 'json' | 'dynamodb';

  /** followerId から followeeId への関係の状態。関係が無ければ 'none'。 */
  getStatus(followerId: string, followeeId: string): Promise<FollowStatus>;

  /**
   * 関係を新しく作る。鍵アカウント宛てなら 'pending'、公開アカウント宛てなら 'accepted'。
   * 既に関係があれば何も変えず FollowAlreadyExistsError を投げる。
   */
  create(followerId: string, followeeId: string, status: StoredFollowStatus): Promise<void>;

  /** フォロー解除（保留中リクエストの取り消しも兼ねる）。消したら true、元から無ければ false。 */
  remove(followerId: string, followeeId: string): Promise<boolean>;

  /**
   * 保留中のリクエストを承認する。
   * 保留中でなければ（存在しない・承認済み・取り消し済み）FollowRequestNotFoundError を投げる。
   */
  approve(followeeId: string, followerId: string): Promise<void>;

  /** 保留中のリクエストを拒否して消す。保留中でなければ FollowRequestNotFoundError を投げる。 */
  reject(followeeId: string, followerId: string): Promise<void>;

  /** followeeId 宛ての保留中リクエストをすべて承認する（公開アカウントに戻したとき）。承認した件数を返す。 */
  approveAllPending(followeeId: string): Promise<number>;

  /** followerId が承認済みでフォローしている相手。 */
  listFollowingIds(followerId: string): Promise<string[]>;

  /** followeeId の承認済みフォロワー。 */
  listFollowerIds(followeeId: string): Promise<string[]>;

  /** followeeId に届いている保留中リクエストの送り主。 */
  listPendingRequesterIds(followeeId: string): Promise<string[]>;

  /** followeeId の承認済みフォロワーの数。 */
  countFollowers(followeeId: string): Promise<number>;
}

/**
 * 保存の層のエラー。improvements/auth の AuthError と同じく HTTP の status を持たせ、
 * ルーターが { error: メッセージ } の JSON に変換できるようにする。
 */
export class FollowStoreError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** 同じ2者の関係が既にある（二重のフォロー、二重のリクエスト）。 */
export class FollowAlreadyExistsError extends FollowStoreError {
  constructor() {
    super('すでにフォローしているか、リクエストを送っています', 409);
  }
}

/** 承認・拒否しようとしたリクエストが保留中ではない（存在しない・承認済み・取り消し済み）。 */
export class FollowRequestNotFoundError extends FollowStoreError {
  constructor() {
    // 提出時点の routes/users.ts が返していた文言と同じにしている
    super('フォローリクエストが見つかりません', 404);
  }
}
