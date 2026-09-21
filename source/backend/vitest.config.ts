import { defineConfig } from 'vitest/config';

// テストは data/*.json を直接読み書きするため、ファイル単位の並列実行を止めて競合を防ぐ。
export default defineConfig({
  test: { fileParallelism: false },
});
