import { defineConfig, mergeConfig } from 'vitest/config';

import submitted from './vitest.config';

// 提出時点の設定（vitest.config.ts）はそのままにし、実行の前後で data/*.json を戻す処理だけを足す。
export default mergeConfig(submitted, defineConfig({ test: { globalSetup: ['tests/restoreData.ts'] } }));
