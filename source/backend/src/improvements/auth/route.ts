/**
 * ログインの API。ハッカソン後に足したもの。
 *
 *   POST /api/auth/register  利用者の登録
 *   POST /api/auth/login     ログイン（セッションの Cookie を渡す）
 *   POST /api/auth/logout    ログアウト（サーバー側でも破棄する）
 *   GET  /api/auth/me        いま誰としてログインしているか
 */

import { Request, Response, Router } from 'express';

import { stringParam } from '../../utils/params';
import { readCookie } from './middleware';
import {
  AuthError,
  createSession,
  destroySession,
  register,
  SESSION_COOKIE,
  verify,
} from './service';

const router = Router();

/** 本文から利用者IDとパスワードを取り出す。 */
function credentialsOf(request: Request): { userId: string; password: string } {
  const body = (request.body ?? {}) as Record<string, unknown>;
  return {
    userId: stringParam(body.userId) ?? '',
    password: typeof body.password === 'string' ? body.password : '',
  };
}

function setSessionCookie(response: Response, id: string, expiresAt: Date): void {
  response.cookie(SESSION_COOKIE, id, {
    httpOnly: true, // 画面側の JavaScript から読めないようにする
    sameSite: 'lax', // 別サイトからの書き込み要求に Cookie を付けない
    secure: process.env.NODE_ENV === 'production', // 本番は HTTPS のみ
    expires: expiresAt,
    path: '/',
  });
}

router.post('/register', async (request: Request, response: Response) => {
  const { userId, password } = credentialsOf(request);
  try {
    await register(userId, password);
    return response.status(201).json({ userId });
  } catch (error) {
    if (error instanceof AuthError) return response.status(error.status).json({ error: error.message });
    return response.status(500).json({ error: '登録に失敗しました' });
  }
});

router.post('/login', async (request: Request, response: Response) => {
  const { userId, password } = credentialsOf(request);
  try {
    if (!(await verify(userId, password))) {
      // どちらが違うかは返さない。存在する利用者IDを外から調べられないようにするため
      return response.status(401).json({ error: '利用者IDまたはパスワードが違います' });
    }
    const session = await createSession(userId);
    setSessionCookie(response, session.id, session.expiresAt);
    return response.json({ userId });
  } catch {
    return response.status(500).json({ error: 'ログインに失敗しました' });
  }
});

router.post('/logout', async (request: Request, response: Response) => {
  try {
    await destroySession(readCookie(request.headers.cookie, SESSION_COOKIE));
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return response.status(204).end();
  } catch {
    return response.status(500).json({ error: 'ログアウトに失敗しました' });
  }
});

router.get('/me', (request: Request, response: Response) => {
  if (!request.viewer) return response.status(401).json({ error: 'ログインしていません' });
  return response.json({ userId: request.viewer });
});

export default router;
