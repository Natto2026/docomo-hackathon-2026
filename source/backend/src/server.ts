import express, { NextFunction, Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import placesRouter from './routes/places';
import postsRouter from './routes/posts';
import usersRouter from './routes/users';
import { loadEnvFile } from './utils/env';

// backend/.env(あれば)から GOOGLE_PLACES_API_KEY などを読み込む
loadEnvFile();

const BACKEND_ROOT = path.resolve(__dirname, '..');

export function createApp() {
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use('/uploads', express.static(path.join(BACKEND_ROOT, 'uploads')));
  app.get('/api/health', (_request, response) => response.json({ status: 'ok' }));
  app.use('/api/posts', postsRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/places', placesRouter);
  app.use((_request, response) => response.status(404).json({ error: 'エンドポイントが見つかりません' }));
  // ここまでで処理されなかったエラー(multer のサイズ超過、JSON パース失敗など)も必ず JSON で返す
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) {
      const message = error.code === 'LIMIT_FILE_SIZE' ? '画像は10MB以下にしてください' : `画像のアップロードに失敗しました(${error.code})`;
      return response.status(400).json({ error: message });
    }
    const status = typeof (error as { status?: unknown })?.status === 'number' ? (error as { status: number }).status : 500;
    if (status >= 500) console.error(error);
    return response.status(status).json({ error: status >= 500 ? 'サーバーでエラーが発生しました' : 'リクエストの形式が不正です' });
  });
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT ?? 3000);
  createApp().listen(port, '0.0.0.0', () => {
    console.log(`Backend listening on http://0.0.0.0:${port}`);
  });
}
