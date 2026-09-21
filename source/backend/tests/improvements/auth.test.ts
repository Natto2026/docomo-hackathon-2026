/**
 * ログインの検証。ハッカソン後に足した機能のテスト。
 *
 * いちばん確かめたいのは「なりすませないこと」。提出時点では操作者を
 * クライアントの申告で受け取っていたため、誰でも他人を名乗れた。
 */

import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { readCookie } from '../../src/improvements/auth/middleware';
import { MIN_PASSWORD_LENGTH, reset } from '../../src/improvements/auth/service';
import { createApp } from '../../src/server';

const PASSWORD = 'correct-horse-battery';
const OTHER = 'demo-user-3'; // 鍵アカウント

function secured() {
  return createApp({ requireAuth: true });
}

/** 登録してログインし、Cookie を保持した状態の呼び出し口を返す。 */
async function loginAs(app: ReturnType<typeof createApp>, userId: string) {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ userId, password: PASSWORD });
  const response = await agent.post('/api/auth/login').send({ userId, password: PASSWORD });
  expect(response.status).toBe(200);
  return agent;
}

beforeEach(async () => {
  await reset();
});

afterEach(async () => {
  await reset();
});

describe('Cookie の読み取り', () => {
  it('必要な1つだけを取り出す', () => {
    expect(readCookie('a=1; sid=abc; b=2', 'sid')).toBe('abc');
  });

  it('無ければ undefined', () => {
    expect(readCookie('a=1', 'sid')).toBeUndefined();
    expect(readCookie(undefined, 'sid')).toBeUndefined();
  });

  it('名前の一部が一致しただけでは取らない', () => {
    expect(readCookie('xsid=abc', 'sid')).toBeUndefined();
  });
});

describe('登録', () => {
  it('登録できる', async () => {
    const response = await request(secured())
      .post('/api/auth/register')
      .send({ userId: 'demo-user-1', password: PASSWORD });
    expect(response.status).toBe(201);
  });

  it('短いパスワードは受け付けない', async () => {
    const response = await request(secured())
      .post('/api/auth/register')
      .send({ userId: 'demo-user-1', password: 'a'.repeat(MIN_PASSWORD_LENGTH - 1) });
    expect(response.status).toBe(400);
  });

  it('同じ利用者IDは二重に登録できない', async () => {
    const app = secured();
    await request(app).post('/api/auth/register').send({ userId: 'demo-user-1', password: PASSWORD });
    const again = await request(app)
      .post('/api/auth/register')
      .send({ userId: 'demo-user-1', password: PASSWORD });
    expect(again.status).toBe(409);
  });
});

describe('ログイン', () => {
  it('正しいパスワードでログインでき、HttpOnly の Cookie が返る', async () => {
    const app = secured();
    await request(app).post('/api/auth/register').send({ userId: 'demo-user-1', password: PASSWORD });
    const response = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'demo-user-1', password: PASSWORD });

    expect(response.status).toBe(200);
    const cookie = String(response.headers['set-cookie']);
    expect(cookie).toContain('sid=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
  });

  it('パスワードが違えば 401', async () => {
    const app = secured();
    await request(app).post('/api/auth/register').send({ userId: 'demo-user-1', password: PASSWORD });
    const response = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'demo-user-1', password: 'wrong-password' });
    expect(response.status).toBe(401);
  });

  it('いない利用者でも、パスワード違いと同じ応答にする', async () => {
    const app = secured();
    const missing = await request(app)
      .post('/api/auth/login')
      .send({ userId: 'does-not-exist', password: PASSWORD });
    expect(missing.status).toBe(401);
    // どちらが違うかを漏らさない（存在する利用者IDを外から調べられないため）
    expect(missing.body.error).toBe('利用者IDまたはパスワードが違います');
  });

  it('ログアウトするとセッションが効かなくなる', async () => {
    const app = secured();
    const agent = await loginAs(app, 'demo-user-1');
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    expect((await agent.post('/api/auth/logout')).status).toBe(204);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('偽のセッションIDは通らない', async () => {
    const response = await request(secured())
      .get('/api/auth/me')
      .set('Cookie', `sid=${'0'.repeat(64)}`);
    expect(response.status).toBe(401);
  });
});

describe('なりすましの防止', () => {
  it('未ログインでは、状態を変える操作を受け付けない', async () => {
    const response = await request(secured())
      .post(`/api/users/${OTHER}/follow`)
      .send({ followerId: 'demo-user-1' });
    expect(response.status).toBe(401);
  });

  it('他人を名乗ってフォローしても、自分としてしか記録されない', async () => {
    const app = secured();
    // デモデータの既存のフォロー関係に左右されないよう、新しい利用者で試す
    const me = 'impersonation-test-user';
    const agent = await loginAs(app, me);

    // 本文では別人を名乗るが、セッションの持ち主として記録される
    const response = await agent.post('/api/users/demo-user-2/follow').send({ followerId: 'someone-else' });
    expect(response.status).toBe(200);

    const impersonated = await agent.get('/api/users/someone-else/following');
    expect(impersonated.body.users).toEqual([]);

    const mine = await agent.get(`/api/users/${me}/following`);
    expect(mine.body.users.map((user: { id: string }) => user.id)).toEqual(['demo-user-2']);

    await agent.delete('/api/users/demo-user-2/follow').send({});
  });

  it('未ログインの閲覧では、鍵アカウントの投稿は見えない', async () => {
    const response = await request(secured()).get(
      `/api/users/${OTHER}/posts?viewerId=${OTHER}`, // 本人を名乗っても通らない
    );
    expect(response.status).toBe(200);
    expect(response.body.locked).toBe(true);
    expect(response.body.posts).toEqual([]);
  });

  it('本人としてログインすれば、自分の鍵アカウントの投稿は見える', async () => {
    const app = secured();
    const agent = await loginAs(app, OTHER);
    const response = await agent.get(`/api/users/${OTHER}/posts`);
    expect(response.body.locked).toBe(false);
    expect(response.body.posts.length).toBeGreaterThan(0);
  });
});

describe('提出時点の動き', () => {
  it('認証を有効にしなければ、これまで通り申告された身元で動く', async () => {
    // 当時のテストをそのまま残せるようにするための逃げ道。既定はこちら
    const response = await request(createApp()).get(
      `/api/users/${OTHER}/posts?viewerId=${OTHER}`,
    );
    expect(response.body.locked).toBe(false);
  });
});
