import multer from 'multer';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { v4 as uuid } from 'uuid';

export const UPLOADS_DIR = path.resolve(__dirname, '../../uploads');

/** `/uploads/<ファイル名>` を指す URL のファイルを削除する(投稿や写真の削除時)。他の URL は無視。 */
export async function removeUploadedFile(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const marker = '/uploads/';
  const index = url.indexOf(marker);
  if (index < 0) return;
  const name = path.basename(url.slice(index + marker.length));
  if (!name || name === '.gitkeep') return;
  await fs.rm(path.join(UPLOADS_DIR, name), { force: true });
}

/** 投稿画像・プロフィール写真で共通の画像アップロード設定(jpg/png/webp、10MB以下)。 */
export const imageUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS_DIR,
    filename: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase() || '.jpg';
      callback(null, `${uuid()}${extension}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_request, file, callback) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    callback(null, allowed.includes(file.mimetype));
  },
});
