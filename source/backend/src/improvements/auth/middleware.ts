/**
 * 操作者の身元を、クライアントの申告ではなくセッションから決める。
 *
 * 提出時点のルーターは、操作者を `viewerId` / `userId` / `followerId` といった
 * クエリや本文から読んでいた。つまり誰でも他人を名乗れた。
 *
 * ここではルーターに手を入れず、その手前で身元を上書きする。
 * 提出時のコードをそのまま残したまま、なりすましだけを塞ぐため。
 *
 * 有効にするかは createApp({ requireAuth }) で切り替える。既定では無効で、
 * 提出時点の動きを保っている（そのままのテストが残せるようにするため）。
 */

import { NextFunction, Request, Response } from 'express';

import { SESSION_COOKIE, userOfSession } from './service';

/** 身元として扱われる項目。ここを塞がないと他人を名乗れる。 */
const IDENTITY_FIELDS = ['viewerId', 'userId', 'followerId', 'authorId'] as const;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

declare module 'express-serve-static-core' {
  interface Request {
    /** セッションから判明した操作者。未ログインなら undefined */
    viewer?: string;
  }
}

/** Cookie ヘッダから1つの値を取り出す。 */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/** セッションを解決して request.viewer に入れる。判定はしない。 */
export function attachViewer() {
  return async (request: Request, _response: Response, next: NextFunction) => {
    request.viewer = await userOfSession(readCookie(request.headers.cookie, SESSION_COOKIE));
    next();
  };
}

/**
 * 身元をセッションの値で上書きする。
 *
 * 未ログインのとき、読み取りは匿名として通し（公開範囲の判定で非公開は隠れる）、
 * 状態を変える操作は 401 で止める。
 */
export function enforceIdentity() {
  return (request: Request, response: Response, next: NextFunction) => {
    const viewer = request.viewer;

    if (!viewer) {
      if (!SAFE_METHODS.has(request.method)) {
        return response.status(401).json({ error: 'ログインしてください' });
      }
      // 匿名。申告された身元は信用しない
      for (const field of IDENTITY_FIELDS) {
        delete (request.query as Record<string, unknown>)[field];
        if (isRecord(request.body)) delete request.body[field];
      }
      return next();
    }

    for (const field of IDENTITY_FIELDS) {
      (request.query as Record<string, unknown>)[field] = viewer;
      if (isRecord(request.body)) request.body[field] = viewer;
    }
    return next();
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
