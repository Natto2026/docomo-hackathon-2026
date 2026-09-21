/**
 * フォロー関係の保存の検証。ハッカソン後に足した機能のテスト。
 *
 * 前半は「契約テスト」。同じテスト群を JSON 版と DynamoDB 版の両方に流し、
 * 保存先を替えても振る舞いが変わらないことを確かめる。
 * 後半は DynamoDB 版だけの検証（Scan を発行しない、ページ分割、項目の形、エラーの翻訳）。
 *
 * DynamoDB 版は実 AWS を使わず、条件式を解釈するインメモリの偽物（fakeDynamo.ts）で動かす。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { DeleteCommand, ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDynamoFollowStore, keyOf } from '../../src/improvements/follows/dynamoFollowStore';
import { FollowStoreConfigError, followStoreFromEnv } from '../../src/improvements/follows/factory';
import { createJsonFollowStore } from '../../src/improvements/follows/jsonFollowStore';
import { recordCommands } from '../../src/improvements/follows/recordingClient';
import {
  FollowAlreadyExistsError,
  FollowRequestNotFoundError,
  FollowStore,
} from '../../src/improvements/follows/store';
import { createFakeDynamo, FOLLOW_TABLE } from './fakeDynamo';

// 一目で架空と分かる利用者ID。JSON 版は data/follows.json に書くので、終わったら必ず消す
const A = 'contract-test-user-a';
const B = 'contract-test-user-b';
const C = 'contract-test-user-c';
const EVERYONE = [A, B, C];

const sorted = (ids: string[]) => [...ids].sort();

function dynamoStore(): FollowStore {
  return createDynamoFollowStore({ client: createFakeDynamo(), tableName: FOLLOW_TABLE.tableName });
}

const implementations: Array<[string, () => FollowStore]> = [
  ['JSON 版', createJsonFollowStore],
  ['DynamoDB 版（偽物のクライアント）', dynamoStore],
];

describe.each(implementations)('FollowStore の契約: %s', (_name, create) => {
  let store: FollowStore;

  async function removeEverything() {
    for (const follower of EVERYONE) {
      for (const followee of EVERYONE) await store.remove(follower, followee);
    }
  }

  beforeEach(async () => {
    store = create();
    await removeEverything();
  });

  afterEach(async () => {
    await removeEverything();
  });

  it('関係が無ければ none で、一覧は空', async () => {
    expect(await store.getStatus(A, B)).toBe('none');
    expect(await store.listFollowingIds(A)).toEqual([]);
    expect(await store.listFollowerIds(B)).toEqual([]);
    expect(await store.listPendingRequesterIds(B)).toEqual([]);
    expect(await store.countFollowers(B)).toBe(0);
  });

  it('公開アカウントへのフォローは、すぐに両側の一覧に出る', async () => {
    await store.create(A, B, 'accepted');
    expect(await store.getStatus(A, B)).toBe('accepted');
    expect(await store.listFollowingIds(A)).toEqual([B]);
    expect(await store.listFollowerIds(B)).toEqual([A]);
    expect(await store.countFollowers(B)).toBe(1);
    expect(await store.listPendingRequesterIds(B)).toEqual([]);
  });

  it('関係には向きがある（A→B は B→A ではない）', async () => {
    await store.create(A, B, 'accepted');
    expect(await store.getStatus(B, A)).toBe('none');
    expect(await store.listFollowingIds(B)).toEqual([]);
    expect(await store.listFollowerIds(A)).toEqual([]);
  });

  it('鍵アカウントへのリクエストは保留中になり、承認されるまでフォロー扱いにならない', async () => {
    await store.create(A, B, 'pending');
    expect(await store.getStatus(A, B)).toBe('pending');
    expect(await store.listPendingRequesterIds(B)).toEqual([A]);
    expect(await store.listFollowingIds(A)).toEqual([]);
    expect(await store.listFollowerIds(B)).toEqual([]);
    expect(await store.countFollowers(B)).toBe(0);
  });

  it('承認すると保留中から外れ、フォロワーになる', async () => {
    await store.create(A, B, 'pending');
    await store.approve(B, A);
    expect(await store.getStatus(A, B)).toBe('accepted');
    expect(await store.listPendingRequesterIds(B)).toEqual([]);
    expect(await store.listFollowerIds(B)).toEqual([A]);
    expect(await store.listFollowingIds(A)).toEqual([B]);
    expect(await store.countFollowers(B)).toBe(1);
  });

  it('二重のリクエストはエラーになり、元の状態を書き換えない', async () => {
    await store.create(A, B, 'pending');
    const again = store.create(A, B, 'accepted');
    await expect(again).rejects.toBeInstanceOf(FollowAlreadyExistsError);
    await expect(again).rejects.toMatchObject({ status: 409 });
    // 2回目が accepted を名乗っても、承認を飛ばして accepted にはならない
    expect(await store.getStatus(A, B)).toBe('pending');
    expect(await store.listPendingRequesterIds(B)).toEqual([A]);
  });

  it('同時に出した同じリクエストは、1つだけが成功する', async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => store.create(A, B, 'pending')));
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(failures).toHaveLength(4);
    for (const failure of failures) expect(failure.reason).toBeInstanceOf(FollowAlreadyExistsError);
    expect(await store.listPendingRequesterIds(B)).toEqual([A]);
  });

  it('二重の承認はエラーになる', async () => {
    await store.create(A, B, 'pending');
    await store.approve(B, A);
    const again = store.approve(B, A);
    await expect(again).rejects.toBeInstanceOf(FollowRequestNotFoundError);
    await expect(again).rejects.toMatchObject({ status: 404, message: 'フォローリクエストが見つかりません' });
    expect(await store.countFollowers(B)).toBe(1);
  });

  it('同時に出した承認は、1つだけが成功する', async () => {
    await store.create(A, B, 'pending');
    const results = await Promise.allSettled([store.approve(B, A), store.approve(B, A), store.approve(B, A)]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(await store.getStatus(A, B)).toBe('accepted');
  });

  it('取り消されたリクエストは承認できず、関係が復活することもない', async () => {
    await store.create(A, B, 'pending');
    expect(await store.remove(A, B)).toBe(true);
    await expect(store.approve(B, A)).rejects.toBeInstanceOf(FollowRequestNotFoundError);
    expect(await store.getStatus(A, B)).toBe('none');
    expect(await store.listFollowerIds(B)).toEqual([]);
  });

  it('出されていないリクエストは承認できない', async () => {
    await expect(store.approve(B, A)).rejects.toBeInstanceOf(FollowRequestNotFoundError);
    expect(await store.getStatus(A, B)).toBe('none');
  });

  it('拒否すると関係が消える。承認済みの関係は拒否では消せない', async () => {
    await store.create(A, B, 'pending');
    await store.reject(B, A);
    expect(await store.getStatus(A, B)).toBe('none');
    await expect(store.reject(B, A)).rejects.toBeInstanceOf(FollowRequestNotFoundError);

    await store.create(C, B, 'accepted');
    await expect(store.reject(B, C)).rejects.toBeInstanceOf(FollowRequestNotFoundError);
    expect(await store.getStatus(C, B)).toBe('accepted');
  });

  it('解除は消したら true、元から無ければ false', async () => {
    await store.create(A, B, 'accepted');
    expect(await store.remove(A, B)).toBe(true);
    expect(await store.remove(A, B)).toBe(false);
    expect(await store.getStatus(A, B)).toBe('none');
  });

  it('保留中をまとめて承認する。ほかの利用者宛てのリクエストには触れない', async () => {
    await store.create(A, C, 'pending');
    await store.create(B, C, 'pending');
    await store.create(A, B, 'pending'); // C 宛てではない
    expect(await store.approveAllPending(C)).toBe(2);
    expect(sorted(await store.listFollowerIds(C))).toEqual([A, B]);
    expect(await store.listPendingRequesterIds(C)).toEqual([]);
    expect(await store.getStatus(A, B)).toBe('pending');
    // もう保留中は無いので 0 件
    expect(await store.approveAllPending(C)).toBe(0);
  });

  it('複数の相手を持つとき、一覧は相手ごとに分かれる', async () => {
    await store.create(A, B, 'accepted');
    await store.create(A, C, 'accepted');
    await store.create(B, C, 'pending');
    expect(sorted(await store.listFollowingIds(A))).toEqual([B, C]);
    expect(await store.listFollowerIds(C)).toEqual([A]);
    expect(await store.listPendingRequesterIds(C)).toEqual([B]);
    expect(await store.countFollowers(C)).toBe(1);
  });
});

describe('DynamoDB 版だけの検証', () => {
  function recorded() {
    const fake = createFakeDynamo();
    const recorder = recordCommands(fake);
    const store = createDynamoFollowStore({ client: recorder.client, tableName: FOLLOW_TABLE.tableName });
    return { fake, recorder, store };
  }

  it('一連の操作で Scan を発行しない（発行するのは Get / Put / Update / Delete / Query だけ）', async () => {
    const { recorder, store } = recorded();
    await store.create(A, B, 'pending');
    await store.create(C, B, 'pending');
    await store.create(A, C, 'accepted');
    await store.create(A, B, 'pending').catch(() => undefined);
    await store.getStatus(A, B);
    await store.approve(B, A);
    await store.approve(B, A).catch(() => undefined);
    await store.reject(B, C);
    await store.create(C, B, 'pending');
    await store.approveAllPending(B);
    await store.listFollowingIds(A);
    await store.listFollowerIds(B);
    await store.listPendingRequesterIds(B);
    await store.countFollowers(B);
    await store.remove(A, B);

    const allowed = new Set(['GetCommand', 'PutCommand', 'UpdateCommand', 'DeleteCommand', 'QueryCommand']);
    expect(recorder.sent.length).toBeGreaterThan(0);
    expect(recorder.sent.filter((name) => !allowed.has(name))).toEqual([]);
    expect(recorder.sent).not.toContain('ScanCommand');
    // 5種類とも実際に使われている（記録が空振りしていないことの確認）
    expect(Object.keys(recorder.counts()).sort()).toEqual([...allowed].sort());
  });

  it('実装のソースが ScanCommand を参照していない', () => {
    const directory = path.resolve(__dirname, '../../src/improvements/follows');
    for (const file of ['dynamoFollowStore.ts', 'factory.ts', 'route.ts', 'visibility.ts']) {
      expect(readFileSync(path.join(directory, file), 'utf8')).not.toMatch(/ScanCommand|\bscan\(/);
    }
  });

  it('一覧と件数は、それぞれ Query 1回で引ける', async () => {
    const { recorder, store } = recorded();
    await store.create(A, B, 'accepted');
    for (const read of [
      () => store.listFollowingIds(A),
      () => store.listFollowerIds(B),
      () => store.listPendingRequesterIds(B),
      () => store.countFollowers(B),
    ]) {
      recorder.clear();
      await read();
      expect(recorder.sent).toEqual(['QueryCommand']);
    }
  });

  it('2者間の状態は GetItem 1回で、強い整合性で読む', async () => {
    const commands: unknown[] = [];
    const fake = createFakeDynamo();
    const store = createDynamoFollowStore({
      client: { send: (command) => (commands.push(command), fake.send(command)) },
      tableName: FOLLOW_TABLE.tableName,
    });
    await store.getStatus(A, B);
    expect(commands).toHaveLength(1);
    expect((commands[0] as { input: unknown }).input).toMatchObject({ Key: keyOf(A, B), ConsistentRead: true });
  });

  it('項目の形は設計どおりで、承認すると GSI のソートキーも一緒に変わる', async () => {
    const { fake, store } = recorded();
    await store.create(A, B, 'pending');
    expect(fake.items()).toEqual([
      expect.objectContaining({
        pk: `USER#${A}`,
        sk: `FOLLOWS#${B}`,
        gsi1pk: `USER#${B}`,
        gsi1sk: `pending#${A}`,
        followerId: A,
        followeeId: B,
        status: 'pending',
      }),
    ]);
    await store.approve(B, A);
    expect(fake.items()).toEqual([expect.objectContaining({ status: 'accepted', gsi1sk: `accepted#${A}` })]);
  });

  it('結果が複数ページに分かれても、最後まで引く', async () => {
    const { fake, recorder, store } = recorded();
    const followers = ['p1', 'p2', 'p3', 'p4', 'p5'].map((name) => `contract-test-${name}`);
    for (const follower of followers) await store.create(follower, B, 'accepted');
    await store.create(A, followers[0], 'pending');
    await store.create(A, followers[1], 'accepted');
    await store.create(A, followers[2], 'accepted');

    fake.pageSize = 2;
    recorder.clear();
    expect(sorted(await store.listFollowerIds(B))).toEqual(followers);
    expect(recorder.sent).toEqual(['QueryCommand', 'QueryCommand', 'QueryCommand']);
    expect(await store.countFollowers(B)).toBe(5);

    // フィルタで保留中が落ちたページがあっても、続きを引いて取りこぼさない
    fake.pageSize = 1;
    expect(sorted(await store.listFollowingIds(A))).toEqual([followers[1], followers[2]]);
  });

  it('まとめて承認している途中で取り消されたリクエストは、数えずに進む', async () => {
    const fake = createFakeDynamo();
    let cancelled = false;
    // 保留中の一覧を引いた直後（最初の承認の前）に、C がリクエストを取り消した状況を作る
    const client = {
      async send(command: Parameters<typeof fake.send>[0]) {
        if (command.constructor.name === 'UpdateCommand' && !cancelled) {
          cancelled = true;
          await fake.send(new DeleteCommand({ TableName: FOLLOW_TABLE.tableName, Key: keyOf(C, B) }));
        }
        return fake.send(command);
      },
    };
    const store = createDynamoFollowStore({ client, tableName: FOLLOW_TABLE.tableName });
    await store.create(A, B, 'pending');
    await store.create(C, B, 'pending');
    expect(await store.approveAllPending(B)).toBe(1);
    expect(await store.getStatus(A, B)).toBe('accepted');
    expect(await store.getStatus(C, B)).toBe('none');
  });

  it('条件の不成立ではないエラーは、翻訳せずそのまま投げる', async () => {
    const store = createDynamoFollowStore({ client: createFakeDynamo(), tableName: 'no-such-table' });
    await expect(store.create(A, B, 'pending')).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
    await expect(store.approve(B, A)).rejects.toMatchObject({ name: 'ResourceNotFoundException' });
  });
});

describe('偽物のクライアントが実物の制約を再現していること', () => {
  it('予約語 status を式にそのまま書くとエラーになる', async () => {
    const fake = createFakeDynamo();
    await expect(
      fake.send(new UpdateCommand({
        TableName: FOLLOW_TABLE.tableName,
        Key: keyOf(A, B),
        UpdateExpression: 'SET status = :accepted',
        ExpressionAttributeValues: { ':accepted': 'accepted' },
      })),
    ).rejects.toMatchObject({ name: 'ValidationException' });
  });

  it('Scan は受け付けない', async () => {
    const fake = createFakeDynamo();
    await expect(fake.send(new ScanCommand({ TableName: FOLLOW_TABLE.tableName }) as never)).rejects.toMatchObject({
      name: 'ValidationException',
    });
    expect(fake.received).toEqual(['ScanCommand']);
  });
});

describe('保存先の切り替え', () => {
  it('既定は JSON', () => {
    expect(followStoreFromEnv({}).kind).toBe('json');
    expect(followStoreFromEnv({ FOLLOW_STORE: 'json' }).kind).toBe('json');
  });

  it('dynamodb を選ぶと DynamoDB 版になる（クライアントは外から渡せる）', async () => {
    const fake = createFakeDynamo();
    const store = followStoreFromEnv(
      { FOLLOW_STORE: 'dynamodb', FOLLOW_TABLE_NAME: FOLLOW_TABLE.tableName, AWS_REGION: 'ap-northeast-1' },
      fake,
    );
    expect(store.kind).toBe('dynamodb');
    await store.create(A, B, 'accepted');
    expect(fake.received).toEqual(['PutCommand']);
  });

  it('テーブル名やリージョンが無ければ、足りない名前を挙げて起動時に止める', () => {
    expect(() => followStoreFromEnv({ FOLLOW_STORE: 'dynamodb' })).toThrow(FollowStoreConfigError);
    expect(() => followStoreFromEnv({ FOLLOW_STORE: 'dynamodb' })).toThrow(/FOLLOW_TABLE_NAME と AWS_REGION/);
    expect(() => followStoreFromEnv({ FOLLOW_STORE: 'dynamodb', AWS_REGION: 'ap-northeast-1' })).toThrow(/FOLLOW_TABLE_NAME を/);
  });

  it('知らない値は JSON に倒さず、エラーにする', () => {
    expect(() => followStoreFromEnv({ FOLLOW_STORE: 'mysql' })).toThrow(FollowStoreConfigError);
  });
});
