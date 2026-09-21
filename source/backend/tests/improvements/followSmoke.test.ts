/**
 * 実 AWS 向けの確認用スクリプト（npm run smoke:aws）の検証。ハッカソン後に足した機能のテスト。
 *
 * スクリプトの手順そのものを、偽物のクライアントに流して確かめる。
 * 実 AWS で初めて動かしたときに、スクリプト側の誤りで NG になるのを避けるため。
 */

import { describe, expect, it } from 'vitest';

import { createDynamoFollowStore } from '../../src/improvements/follows/dynamoFollowStore';
import { recordCommands } from '../../src/improvements/follows/recordingClient';
import { runSmoke } from '../../src/improvements/follows/smokeAws';
import { createFakeDynamo, FOLLOW_TABLE } from './fakeDynamo';

describe('実 AWS 向けの確認用スクリプト', () => {
  it('正しい保存先に流すと全段が成功し、項目を残さず、Scan も発行しない', async () => {
    const fake = createFakeDynamo();
    const recorder = recordCommands(fake);
    const store = createDynamoFollowStore({ client: recorder.client, tableName: FOLLOW_TABLE.tableName });
    const results = await runSmoke(store, 'unit-test', () => undefined);
    expect(results.filter((result) => !result.ok)).toEqual([]);
    expect(results.length).toBeGreaterThanOrEqual(10);
    expect(fake.items()).toEqual([]);
    expect(recorder.sent).not.toContain('ScanCommand');
  });

  it('保存先が壊れていれば NG を報告する（常に成功と言うスクリプトではない）', async () => {
    const store = createDynamoFollowStore({ client: createFakeDynamo(), tableName: 'no-such-table' });
    const results = await runSmoke(store, 'unit-test', () => undefined);
    expect(results.every((result) => !result.ok)).toBe(true);
  });
});
