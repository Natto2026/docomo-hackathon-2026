/**
 * 【補助実装】このファイルは、このリポジトリのために新しく書いたものです。
 *
 * 元のプロジェクトのアプリ組み立ては共同編集だったため、そのままは含めず、
 * 自分が書いたルーター（users / places）を載せるだけの最小構成にしています。
 * エラー応答を必ず JSON で返す方針は、元の実装と同じにしてあります。
 */

import path from 'node:path';

import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import multer from 'multer';

import authRouter from './improvements/auth/route';
import { attachViewer, enforceIdentity } from './improvements/auth/middleware';
import coverageRouter from './improvements/coverage/route';
import { followStoreFromEnv } from './improvements/follows/factory';
import { createFollowRouter } from './improvements/follows/route';
import { FollowStore } from './improvements/follows/store';
import placesRouter from './routes/places';
import { createPostsRouter } from './routes/posts';
import usersRouter from './routes/users';
import { loadEnvFile } from './utils/env';

// backend/.env（あれば）から GOOGLE_PLACES_API_KEY などを読み込む
loadEnvFile();

const BACKEND_ROOT = path.resolve(__dirname, '..');
const MAX_IMAGE_MEGABYTES = 10;

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
  app.use('/uploads', express.static(path.join(BACKEND_ROOT, 'uploads')));

  const followStore = options.followStore ?? followStoreFromEnv();
  const replaceFollowStore = options.followStore !== undefined || followStore.kind !== 'json';

  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  if (replaceFollowStore) app.use('/api/users', createFollowRouter(followStore));
  app.use('/api/users', usersRouter);
  app.use('/api/places', placesRouter);
  app.use('/api/coverage', coverageRouter);
  app.use('/api/posts', createPostsRouter(replaceFollowStore ? followStore : undefined));

  app.use((_request, response) =>
    response.status(404).json({ error: 'エンドポイントが見つかりません' }),
  );

  // ここまでで処理されなかったエラー（画像のサイズ超過、JSON のパース失敗など）も
  // 必ず JSON で返す。画面側が常に同じ形で受け取れるようにするため。
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const message =
        error.code === 'LIMIT_FILE_SIZE'
          ? `画像は${MAX_IMAGE_MEGABYTES}MB以下にしてください`
          : `画像のアップロードに失敗しました(${error.code})`;
      return response.status(400).json({ error: message });
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
    console.log(`Backend listening on http://127.0.0.1:${port}`);
  });
}
