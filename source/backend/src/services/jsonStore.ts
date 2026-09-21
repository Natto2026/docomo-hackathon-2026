import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

async function ensureFile(file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    await fs.access(file);
  } catch {
    await fs.writeFile(file, '[]\n', 'utf8');
  }
}

/** ファイルごとの直列化キュー。同じファイルへの読み書きを同時に走らせない。 */
const queues = new Map<string, Promise<unknown>>();

export async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const previous = queues.get(file) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(task);
  queues.set(file, current);
  try {
    return await current;
  } finally {
    if (queues.get(file) === current) queues.delete(file);
  }
}

export async function readJsonArray<T>(file: string, errorMessage = 'データの形式が不正です'): Promise<T[]> {
  await ensureFile(file);
  const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!Array.isArray(parsed)) throw new Error(errorMessage);
  return parsed as T[];
}

const RENAME_ATTEMPTS = 6;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 一時ファイルを本体に置き換える。
 * Windows では他プロセス(開発サーバーやテスト)が同じファイルを読んでいる瞬間に rename が失敗するため、
 * 少し待って再試行し、それでも駄目なら内容を直接書き込む(原子的ではないが欠損よりまし)。
 */
async function replaceFile(temporaryFile: string, file: string, content: string): Promise<void> {
  for (let attempt = 1; attempt <= RENAME_ATTEMPTS; attempt += 1) {
    try {
      await fs.rename(temporaryFile, file);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt === RENAME_ATTEMPTS) {
        await fs.writeFile(file, content, 'utf8');
        await fs.rm(temporaryFile, { force: true });
        return;
      }
      await sleep(15 * attempt);
    }
  }
}

export async function writeJsonArray<T>(file: string, items: T[]): Promise<void> {
  await ensureFile(file);
  const content = `${JSON.stringify(items, null, 2)}\n`;
  // 一時ファイル名を一意にして、同時書き込みで互いの一時ファイルを上書きしないようにする
  const temporaryFile = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  await fs.writeFile(temporaryFile, content, 'utf8');
  await replaceFile(temporaryFile, file, content);
}

/**
 * 読み込み → 変更 → 書き込みをロック付きで行う。
 * update が同じ配列をそのまま返した場合は変更なしとみなして書き込まない。
 */
export function updateJsonArray<T>(
  file: string,
  errorMessage: string,
  update: (items: T[]) => T[] | Promise<T[]>,
): Promise<T[]> {
  return withFileLock(file, async () => {
    const items = await readJsonArray<T>(file, errorMessage);
    const next = await update(items);
    if (next !== items) await writeJsonArray(file, next);
    return next;
  });
}
