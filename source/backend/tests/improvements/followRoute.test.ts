/**
 * 保存先を選べるフォローの API の検証。ハッカソン後に足した機能のテスト。
 *
 * 同じテスト群を、JSON 版と DynamoDB 版（偽物のクライアント）の両方の保存先で API に流す。
 * 応答の形は提出時点の API（tests/users.test.ts が確かめているもの）と同じであること、
 * 鍵アカウントの見える・見えないが保存先に関係なく成り立つことを確かめる。
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDynamoFollowStore } from '../../src/improvements/follows/dynamoFollowStore';
import { createJsonFollowStore } from '../../src/improvements/follows/jsonFollowStore';
import { recordCommands } from '../../src/improvements/follows/recordingClient';
import { FollowStore } from '../../src/improvements/follows/store';
import { createApp } from '../../src/server';
import { createFakeDynamo, FOLLOW_TABLE } from './fakeDynamo';

const FOLLOWER = 'route-test-follower';
const OTHER = 'route-test-other';
const PUBLIC_TARGET = 'demo-user-2';
const PRIVATE_TARGET = 'demo-user-3'; // 鍵アカウント。投稿は post-003
const TARGETS = [PUBLIC_TARGET, PRIVATE_TARGET];

const FOLLOWS_FILE = path.resolve(__dirname, '../../data/follows.json');

function dynamoStore(): FollowStore {
  return createDynamoFollowStore({ client: createFakeDynamo(), tableName: FOLLOW_TABLE.tableName });
}

const implementations: Array<[string, () => FollowStore]> = [
  ['JSON 版', createJsonFollowStore],
  ['DynamoDB 版（偽物のクライアント）', dynamoStore],
];

describe.each(implementations)('保存先を選べるフォローの API: %s', (_name, create) => {
  let store: FollowStore;
  let app: ReturnType<typeof createApp>;

  async function cleanUp() {
    for (const follower of [FOLLOWER, OTHER]) {
      for (const target of TARGETS) await store.remove(follower, target);
    }
  }

  beforeEach(async () => {
    store = create();
    app = createApp({ followStore: store });
    await cleanUp();
  });

  afterEach(async () => {
    await cleanUp();
    await request(app).patch(`/api/users/${PUBLIC_TARGET}`).send({ isPrivate: false, userId: PUBLIC_TARGET });
  });

  it('公開アカウントはすぐフォローになり、二度押ししてもエラーにせず同じ状態を返す', async () => {
    const before = await request(app).get(`/api/users/${PUBLIC_TARGET}?viewerId=${FOLLOWER}`);
    expect(before.status).toBe(200);
    expect(before.body.isFollowing).toBe(false);
    const baseCount: number = before.body.followerCount;

    const first = await request(app).post(`/api/users/${PUBLIC_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ userId: PUBLIC_TARGET, following: true, status: 'accepted', followerCount: baseCount + 1 });

    const second = await request(app).post(`/api/users/${PUBLIC_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);

    const followers = await request(app).get(`/api/users/${PUBLIC_TARGET}/followers`);
    expect(followers.body.users.map((user: { id: string }) => user.id)).toContain(FOLLOWER);
    const following = await request(app).get(`/api/users/${FOLLOWER}/following`);
    expect(following.body.users.map((user: { id: string }) => user.id)).toEqual([PUBLIC_TARGET]);

    const removed = await request(app).delete(`/api/users/${PUBLIC_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(removed.body).toEqual({ userId: PUBLIC_TARGET, following: false, status: 'none', followerCount: baseCount });
  });

  it('鍵アカウントは承認されるまで投稿が見えず、承認されると見える', async () => {
    const requested = await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(requested.body).toMatchObject({ following: false, status: 'pending' });

    const locked = await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${FOLLOWER}`);
    expect(locked.body).toEqual({ posts: [], count: 0, locked: true });
    expect((await request(app).get(`/api/posts/post-003?viewerId=${FOLLOWER}`)).status).toBe(403);
    const hidden = await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&viewerId=${FOLLOWER}`);
    expect(hidden.body.posts.some((post: { authorId: string }) => post.authorId === PRIVATE_TARGET)).toBe(false);

    const requests = await request(app).get(`/api/users/${PRIVATE_TARGET}/requests`);
    expect(requests.body.users.map((user: { id: string }) => user.id)).toContain(FOLLOWER);
    const profile = await request(app).get(`/api/users/${PRIVATE_TARGET}?viewerId=${PRIVATE_TARGET}`);
    expect(profile.body.pendingRequestCount).toBeGreaterThanOrEqual(1);

    const approved = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ userId: PRIVATE_TARGET, followerId: FOLLOWER, status: 'accepted' });

    const open = await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${FOLLOWER}`);
    expect(open.body.locked).toBe(false);
    expect(open.body.posts.length).toBeGreaterThan(0);
    expect((await request(app).get(`/api/posts/post-003?viewerId=${FOLLOWER}`)).status).toBe(200);
    const feed = await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&followingOf=${FOLLOWER}&viewerId=${FOLLOWER}`);
    expect(feed.body.posts.length).toBeGreaterThan(0);
    expect(feed.body.posts.every((post: { authorId: string }) => post.authorId === PRIVATE_TARGET)).toBe(true);
  });

  it('二重の承認は 404 を JSON で返す', async () => {
    await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect((await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`)).status).toBe(200);
    const again = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`);
    expect(again.status).toBe(404);
    expect(again.body).toEqual({ error: 'フォローリクエストが見つかりません' });
  });

  it('取り消されたリクエストの承認は 404 で、フォロワーは増えない', async () => {
    await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    await request(app).delete(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    const approve = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`);
    expect(approve.status).toBe(404);
    expect(approve.body).toEqual({ error: 'フォローリクエストが見つかりません' });
    const state = await request(app).get(`/api/users/${PRIVATE_TARGET}/follow?followerId=${FOLLOWER}`);
    expect(state.body).toMatchObject({ following: false, status: 'none' });
  });

  it('拒否するとリクエストが消える。もう一度拒否すると 404', async () => {
    await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    const rejected = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/reject`);
    expect(rejected.body).toMatchObject({ userId: PRIVATE_TARGET, followerId: FOLLOWER, status: 'none' });
    expect((await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/reject`)).status).toBe(404);
  });

  it('公開アカウントに戻すと、保留中のリクエストは全員フォロワーになる', async () => {
    await request(app).patch(`/api/users/${PUBLIC_TARGET}`).send({ isPrivate: true, userId: PUBLIC_TARGET });
    for (const follower of [FOLLOWER, OTHER]) {
      const requested = await request(app).post(`/api/users/${PUBLIC_TARGET}/follow`).send({ followerId: follower });
      expect(requested.body.status).toBe('pending');
    }
    const reopened = await request(app).patch(`/api/users/${PUBLIC_TARGET}`).send({ isPrivate: false, userId: PUBLIC_TARGET });
    expect(reopened.status).toBe(200);
    expect(reopened.body.pendingRequestCount).toBe(0);
    for (const follower of [FOLLOWER, OTHER]) {
      const state = await request(app).get(`/api/users/${PUBLIC_TARGET}/follow?followerId=${follower}`);
      expect(state.body.status).toBe('accepted');
    }
  });

  it('他人のプロフィールは変更できない。自分自身はフォローできない。知らない利用者は 404', async () => {
    const forbidden = await request(app).patch(`/api/users/${PUBLIC_TARGET}`).send({ isPrivate: true, userId: FOLLOWER });
    expect(forbidden.status).toBe(403);
    const self = await request(app).post(`/api/users/${PUBLIC_TARGET}/follow`).send({ followerId: PUBLIC_TARGET });
    expect(self.status).toBe(400);
    const unknown = await request(app).post('/api/users/does-not-exist/follow').send({ followerId: FOLLOWER });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: 'ユーザーが見つかりません' });
  });
});

describe('DynamoDB 版で API を動かしたとき', () => {
  it('Scan を発行せず、JSON のフォローデータにも触れない', async () => {
    const recorder = recordCommands(createFakeDynamo());
    const store = createDynamoFollowStore({ client: recorder.client, tableName: FOLLOW_TABLE.tableName });
    const app = createApp({ followStore: store });
    const before = readFileSync(FOLLOWS_FILE, 'utf8');

    await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`);
    await request(app).get(`/api/users?viewerId=${FOLLOWER}`);
    await request(app).get(`/api/users/${PRIVATE_TARGET}/followers`);
    await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${FOLLOWER}`);
    await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&viewerId=${FOLLOWER}`);
    await request(app).delete(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });

    expect(recorder.sent.length).toBeGreaterThan(0);
    expect(recorder.sent).not.toContain('ScanCommand');
    expect(new Set(recorder.sent)).toEqual(new Set(['GetCommand', 'PutCommand', 'UpdateCommand', 'DeleteCommand', 'QueryCommand']));
    expect(readFileSync(FOLLOWS_FILE, 'utf8')).toBe(before);
  });

  it('保存先でエラーが起きても、応答は JSON の 500 になる', async () => {
    const store = createDynamoFollowStore({ client: createFakeDynamo(), tableName: 'no-such-table' });
    const response = await request(createApp({ followStore: store })).get(`/api/users/${PUBLIC_TARGET}/followers`);
    expect(response.status).toBe(500);
    expect(response.body).toEqual({ error: 'フォロワーの取得に失敗しました' });
  });

  it('既定（保存先を指定しない）では、提出時点のルーターがそのまま応答する', async () => {
    // 手元の backend/.env に FOLLOW_STORE=dynamodb があると、このテストが実際の DynamoDB を見に行ってしまう。
    // 「指定しない」状態をテストの側で作り、.env の有無で結果が変わらないようにする
    const saved = process.env.FOLLOW_STORE;
    delete process.env.FOLLOW_STORE;
    try {
      const response = await request(createApp()).get('/api/users/demo-user-1/followers');
      expect(response.status).toBe(200);
      // data/follows.json にある承認済みフォロワー
      expect(response.body.users.map((user: { id: string }) => user.id)).toEqual(expect.arrayContaining(['demo-user-2', 'demo-user-3']));
    } finally {
      if (saved !== undefined) process.env.FOLLOW_STORE = saved;
    }
  });
});
