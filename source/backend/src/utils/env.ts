import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * backend/.env を読み、まだ設定されていない環境変数だけを補う(依存パッケージ無しの簡易版)。
 * 形式は KEY=VALUE。# で始まる行は無視し、値の前後の引用符は外す。
 */
export function loadEnvFile(file = path.resolve(__dirname, '../../.env')): void {
  if (!existsSync(file)) return;
  for (const rawLine of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
