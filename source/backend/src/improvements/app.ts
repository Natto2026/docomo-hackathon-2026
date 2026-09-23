/**
 * ハッカソン後の改良を載せたアプリ。ハッカソン後に足したもの。
 *
 * 提出時点の server.ts には手を入れず、その createApp() を内側に置き、
 * 改良のミドルウェアとルーターを手前に差し込む。
 *
 *   - ログイン（improvements/auth）。requireAuth: true で、操作者の身元をセッションから決める
 *   - 訪問範囲の集計（improvements/coverage）
 *   - フォロー関係の保存先の差し替え（improvements/follows）。json 以外のときだけ差し込む
 *
 * 既定（requireAuth: false・FOLLOW_STORE=json）では、ログインと訪問範囲の URL が増えるだけで、
 * それ以外は提出時点のルーターがそのまま応答する。
 */

import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import { createApp as createSubmittedApp } from '../server';
import authRouter from './auth/route';
import { attachViewer, enforceIdentity } from './auth/middleware';
import coverageRouter from './coverage/route';
import { followStoreFromEnv } from './follows/factory';
import { createStorePostsRouter } from './follows/postsRoute';
import { createFollowRouter } from './follows/route';
import { FollowStore } from './follows/store';

export type AppOptions = {
  /**
   * 操作者の身元をセッションから決める。
   *
   * 既定は false。提出時点の動き（身元をクライアントの申告で受け取る）を
   * そのまま残し、当時のテストが動く状態を保つため。
   * 本番で動かすなら true にする。
   */
  requireAuth?: boolean;
  /**
   * フォロー関係の保存先。省略すると環境変数 FOLLOW_STORE（既定は json）で決まる。
   *
   * json のときは何も差し込まず、提出時点のルーターと followService がそのまま動く。
   * それ以外（DynamoDB、テスト用の差し替え）のときだけ、保存先を選べるルーターを
   * 提出時のルーターの手前に置く。
   */
  followStore?: FollowStore;
};

export function createApp(options: AppOptions = {}) {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(attachViewer());
  app.use('/api/auth', authRouter);
  if (options.requireAuth) app.use(enforceIdentity());

  const followStore = options.followStore ?? followStoreFromEnv();
  const replaceFollowStore = options.followStore !== undefined || followStore.kind !== 'json';

  if (replaceFollowStore) {
    app.use('/api/users', createFollowRouter(followStore));
    app.use('/api/posts', createStorePostsRouter(followStore));
  }
  app.use('/api/coverage', coverageRouter);

  // 残りはすべて提出時点のアプリが応答する（404 と、そこで起きたエラーの応答も含む）
  app.use(createSubmittedApp());

  // 改良側で処理されなかったエラーも、提出時点と同じ形の JSON で返す
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      return response.status(400).json({ error: `画像のアップロードに失敗しました(${error.code})` });
    }
    const status =
      typeof (error as { status?: unknown })?.status === 'number'
        ? (error as { status: number }).status
        : 500;
    if (status >= 500) console.error(error);
    return response
      .status(status)
      .json({ error: status >= 500 ? 'サーバーでエラーが発生しました' : 'リクエストの形式が不正です' });
  });

  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, '127.0.0.1', () => {
    console.log(`Backend (with improvements) listening on http://127.0.0.1:${port}`);
  });
}
