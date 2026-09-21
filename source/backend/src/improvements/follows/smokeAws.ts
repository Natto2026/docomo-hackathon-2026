/**
 * 実際の AWS に対する確認用スクリプト。ハッカソン後に自分ひとりで足したもの。
 *
 *   npm run smoke:aws
 *
 * テストは偽物のクライアントで動かしているので、偽物と実物の差（条件式の文法、予約語、
 * GSI の射影と結果整合性、権限）はここでしか確かめられない。
 * リクエスト → 二重リクエスト → 承認 → 二重承認 → 取り消し後の承認 → Query での確認 → 後片付け、
 * を実テーブルに流し、各段の成否と、発行したコマンドの種類・件数を出す。
 *
 * FOLLOW_TABLE_NAME と AWS_REGION が無ければ、何もせず説明を出して終わる。
 * 利用者IDは一目で架空と分かる値にし、最後に自分が作った項目だけを消す。
 * 手順は infra/README.md にある。
 */

import { createDynamoFollowStore } from './dynamoFollowStore';
import { createDocumentClient, dynamoSettingsFromEnv, FollowStoreConfigError } from './factory';
import { recordCommands } from './recordingClient';
import { FollowAlreadyExistsError, FollowRequestNotFoundError, FollowStore } from './store';
import { loadEnvFile } from '../../utils/env';

type StepResult = { name: string; ok: boolean; detail?: string };

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** GSI は結果整合性なので、期待の値になるまで少し待ちながら引き直す。 */
async function eventually<T>(read: () => Promise<T>, matches: (value: T) => boolean): Promise<T> {
  let value = await read();
  for (let attempt = 0; attempt < 10 && !matches(value); attempt += 1) {
    await sleep(300);
    value = await read();
  }
  return value;
}

async function rejectsWith(action: Promise<unknown>, errorClass: new (...args: never[]) => Error): Promise<string | undefined> {
  try {
    await action;
    return '成功してしまった（失敗するはず）';
  } catch (error) {
    return error instanceof errorClass ? undefined : `想定外のエラー: ${(error as Error).name}: ${(error as Error).message}`;
  }
}

export async function runSmoke(store: FollowStore, runId: string, log: (line: string) => void): Promise<StepResult[]> {
  // 実在の利用者と紛れない値。runId で毎回変わるので、前回の消し残しとも衝突しない
  const requester = `smoke-fictional-requester-${runId}`;
  const canceller = `smoke-fictional-canceller-${runId}`;
  const owner = `smoke-fictional-locked-owner-${runId}`;
  const results: StepResult[] = [];

  async function step(name: string, body: () => Promise<string | undefined>) {
    let detail: string | undefined;
    try {
      detail = await body();
    } catch (error) {
      detail = `${(error as Error).name}: ${(error as Error).message}`;
    }
    results.push({ name, ok: detail === undefined, detail });
    log(`${detail === undefined ? '  OK  ' : '  NG  '}${name}${detail ? ` … ${detail}` : ''}`);
  }

  const expectEqual = (actual: unknown, expected: unknown) =>
    JSON.stringify(actual) === JSON.stringify(expected) ? undefined : `期待 ${JSON.stringify(expected)}、実際 ${JSON.stringify(actual)}`;

  try {
    await step('リクエストを出す（保留中になる）', async () => {
      await store.create(requester, owner, 'pending');
      return expectEqual(await store.getStatus(requester, owner), 'pending');
    });
    await step('同じリクエストをもう一度出すと失敗する（attribute_not_exists）', () =>
      rejectsWith(store.create(requester, owner, 'accepted'), FollowAlreadyExistsError));
    await step('保留中リクエストを GSI の Query で引ける', async () =>
      expectEqual(await eventually(() => store.listPendingRequesterIds(owner), (ids) => ids.length === 1), [requester]));
    await step('承認する（保留中のときだけ更新）', async () => {
      await store.approve(owner, requester);
      return expectEqual(await store.getStatus(requester, owner), 'accepted');
    });
    await step('二重の承認は失敗する', () => rejectsWith(store.approve(owner, requester), FollowRequestNotFoundError));
    await step('取り消したリクエストの承認は失敗し、項目が復活しない', async () => {
      await store.create(canceller, owner, 'pending');
      await store.remove(canceller, owner);
      const failure = await rejectsWith(store.approve(owner, canceller), FollowRequestNotFoundError);
      return failure ?? expectEqual(await store.getStatus(canceller, owner), 'none');
    });
    await step('フォロワーを GSI の Query で引ける', async () =>
      expectEqual(await eventually(() => store.listFollowerIds(owner), (ids) => ids.length === 1), [requester]));
    await step('フォロワーの件数を Query（COUNT）で引ける', async () =>
      expectEqual(await eventually(() => store.countFollowers(owner), (count) => count === 1), 1));
    await step('保留中リクエストは空になっている', async () =>
      expectEqual(await eventually(() => store.listPendingRequesterIds(owner), (ids) => ids.length === 0), []));
    await step('フォロー中をテーブルの Query で引ける', async () =>
      expectEqual(await store.listFollowingIds(requester), [owner]));
  } finally {
    // 後片付け。このスクリプトが作りうる2項目だけを、キーを指定して消す
    await step('後片付け（自分が作った項目だけを消す）', async () => {
      await store.remove(requester, owner);
      await store.remove(canceller, owner);
      const left = [await store.getStatus(requester, owner), await store.getStatus(canceller, owner)];
      return expectEqual(left, ['none', 'none']);
    });
  }
  return results;
}

async function main(): Promise<number> {
  loadEnvFile();

  let settings;
  try {
    settings = dynamoSettingsFromEnv();
  } catch (error) {
    if (!(error instanceof FollowStoreConfigError)) throw error;
    console.log('実 AWS への確認は行いませんでした。');
    console.log(error.message);
    console.log('テーブルの作り方と .env の書き方は infra/README.md にあります。');
    return 0;
  }

  const recorder = recordCommands(createDocumentClient(settings.region));
  const store = createDynamoFollowStore({ client: recorder.client, tableName: settings.tableName, indexName: settings.indexName });
  const runId = Date.now().toString(36);

  console.log(`テーブル ${settings.tableName}（${settings.region}）に対して確認します。実行ID: ${runId}`);
  const results = await runSmoke(store, runId, (line) => console.log(line));

  console.log('\n発行したコマンド');
  for (const [name, count] of Object.entries(recorder.counts()).sort()) console.log(`  ${name}: ${count}`);
  console.log(`  合計: ${recorder.sent.length}`);
  const usedScan = recorder.sent.includes('ScanCommand');
  console.log(`  Scan: ${usedScan ? '発行した（設計に反する）' : '発行していない'}`);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n結果: ${results.length - failed.length} / ${results.length} 段が成功`);
  if (failed.some((result) => /Credential|credentials|security token|AccessDenied|not authorized/i.test(result.detail ?? ''))) {
    console.log('認証情報か権限の問題のようです。`aws configure` と IAM の方針を infra/README.md で確認してください。');
  }
  return failed.length === 0 && !usedScan ? 0 : 1;
}

if (require.main === module) {
  main().then(
    (code) => { process.exitCode = code; },
    (error) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}
