/**
 * テストの前に data/*.json を控え、終わったら元に戻す。このリポジトリのために足したもの。
 *
 * 提出時点のテスト（posts.test.ts など）は data/ のファイルへ直接書き込む。
 * そのままだと、テストを回すたびに架空データが増えて作業ツリーが汚れるため、
 * テストの中身には手を入れず、実行の前後で戻す。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';

const DATA_DIR = path.resolve(__dirname, '../data');

export default async function setup() {
  const names = (await fs.readdir(DATA_DIR)).filter((name) => name.endsWith('.json'));
  const saved = new Map<string, Buffer>();
  for (const name of names) saved.set(name, await fs.readFile(path.join(DATA_DIR, name)));

  return async () => {
    for (const name of await fs.readdir(DATA_DIR)) {
      if (name.endsWith('.json') && !saved.has(name)) await fs.rm(path.join(DATA_DIR, name));
    }
    for (const [name, content] of saved) await fs.writeFile(path.join(DATA_DIR, name), content);
  };
}
