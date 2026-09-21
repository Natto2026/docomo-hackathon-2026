/**
 * ログインとセッション。ハッカソン後に自分ひとりで足したもの。
 *
 * 提出時点では認証がなく、操作者はクライアントの申告（userId）に頼っていた。
 * 自分で書いたコードのコメントにもその旨を残していたが、これは
 * 「鍵アカウント」が成り立たないことを意味する。誰でも他人を名乗れるなら、
 * 公開範囲をサーバー側で判定していても意味がない。
 *
 * 方針
 *   - パスワードは scrypt で導出した鍵を保存する。生のパスワードは残さない
 *   - セッションは識別子だけを Cookie に入れ、中身はサーバー側に持つ
 *     （ログアウトや失効をサーバーの都合で効かせられるようにするため）
 *   - Cookie は HttpOnly。画面側の JavaScript から読めないようにする
 *   - 保存には、ハッカソンで自分が書いた jsonStore をそのまま使う
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';

import { readJsonArray, updateJsonArray } from '../../services/jsonStore';

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const CREDENTIAL_FILE = path.resolve(__dirname, '../../../data/credentials.json');
const SESSION_FILE = path.resolve(__dirname, '../../../data/sessions.json');

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const SESSION_BYTES = 32;
export const SESSION_COOKIE = 'sid';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const MIN_PASSWORD_LENGTH = 8;

type Credential = {
  userId: string;
  salt: string;
  key: string;
  createdAt: string;
};

type Session = {
  id: string;
  userId: string;
  expiresAt: string;
};

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return scrypt(password, salt, KEY_BYTES);
}

/** 利用者を登録する。同じ利用者の二重登録は受け付けない。 */
export async function register(userId: string, password: string): Promise<void> {
  if (!userId.trim()) throw new AuthError('利用者IDを指定してください', 400);
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください`, 400);
  }

  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt);
  const record: Credential = {
    userId,
    salt: salt.toString('hex'),
    key: key.toString('hex'),
    createdAt: new Date().toISOString(),
  };

  // 読み出しから書き込みまでを1つのロックに入れる。二重登録の取りこぼしを防ぐため
  await updateJsonArray<Credential>(CREDENTIAL_FILE, '認証情報の形式が不正です', (credentials) => {
    if (credentials.some((entry) => entry.userId === userId)) {
      throw new AuthError('この利用者IDは登録済みです', 409);
    }
    return [...credentials, record];
  });
}

/**
 * パスワードを照合する。
 *
 * 一致しない場合に「利用者がいない」と「パスワードが違う」を区別しない。
 * 区別すると、どの利用者IDが存在するかを外から調べられてしまうため。
 */
export async function verify(userId: string, password: string): Promise<boolean> {
  const credentials = await readJsonArray<Credential>(CREDENTIAL_FILE, '認証情報の形式が不正です');
  const record = credentials.find((entry) => entry.userId === userId);
  if (!record) {
    // 利用者がいなくても同じだけ時間をかけ、応答の速さから存在を推測されないようにする
    await derive(password, randomBytes(SALT_BYTES));
    return false;
  }
  const expected = Buffer.from(record.key, 'hex');
  const actual = await derive(password, Buffer.from(record.salt, 'hex'));
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = randomBytes(SESSION_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await updateJsonArray<Session>(SESSION_FILE, 'セッションの形式が不正です', (sessions) => [
    ...sessions.filter((entry) => new Date(entry.expiresAt).getTime() > Date.now()),
    { id, userId, expiresAt: expiresAt.toISOString() },
  ]);
  return { id, expiresAt };
}

/** セッションから利用者を引く。期限切れは無効として扱う。 */
export async function userOfSession(id: string | undefined): Promise<string | undefined> {
  if (!id) return undefined;
  const sessions = await readJsonArray<Session>(SESSION_FILE, 'セッションの形式が不正です');
  const session = sessions.find((entry) => entry.id === id);
  if (!session) return undefined;
  return new Date(session.expiresAt).getTime() > Date.now() ? session.userId : undefined;
}

export async function destroySession(id: string | undefined): Promise<void> {
  if (!id) return;
  await updateJsonArray<Session>(SESSION_FILE, 'セッションの形式が不正です', (sessions) =>
    sessions.filter((entry) => entry.id !== id),
  );
}

/** テストと初期化用。登録情報とセッションを消す。 */
export async function reset(): Promise<void> {
  await updateJsonArray<Credential>(CREDENTIAL_FILE, '認証情報の形式が不正です', () => []);
  await updateJsonArray<Session>(SESSION_FILE, 'セッションの形式が不正です', () => []);
}
