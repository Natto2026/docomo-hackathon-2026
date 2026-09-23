import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/server';

describe('posts API', () => {
  it('returns health status', async () => {
    const response = await request(createApp()).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('lists nearby posts', async () => {
    const response = await request(createApp()).get('/api/posts?latitude=34.7025&longitude=135.4959');
    expect(response.status).toBe(200);
    expect(response.body.posts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'post-001' })]));
  });

  it('includes distanceMeters and excludes posts beyond the radius', async () => {
    const response = await request(createApp()).get('/api/posts?latitude=34.7025&longitude=135.4959&radius=5000');
    expect(response.status).toBe(200);
    const target = response.body.posts.find((post: { id: string }) => post.id === 'post-001');
    expect(target).toBeDefined();
    expect(target.distanceMeters).toBe(0);
    expect(response.body.posts.every((post: { distanceMeters?: number }) => post.distanceMeters === undefined || post.distanceMeters <= 5000)).toBe(true);
  });

  it('excludes posts farther than 5km when a narrower radius is requested', async () => {
    const response = await request(createApp()).get('/api/posts?latitude=34.7025&longitude=135.4959&radius=1');
    expect(response.status).toBe(200);
    // 同じ座標に他の投稿が作られていることもあるため、半径内であることだけを検証する
    expect(response.body.posts.find((post: { id: string }) => post.id === 'post-001')).toBeDefined();
    expect(response.body.posts.every((post: { distanceMeters: number }) => post.distanceMeters <= 1)).toBe(true);
  });

  it('gets a single post by id', async () => {
    const response = await request(createApp()).get('/api/posts/post-001');
    expect(response.status).toBe(200);
    expect(response.body.id).toBe('post-001');
  });

  it('returns 404 for an unknown post id', async () => {
    const response = await request(createApp()).get('/api/posts/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('creates a post and returns it', async () => {
    const response = await request(createApp())
      .post('/api/posts')
      .send({ authorId: 'demo-user-1', authorName: 'デモユーザー', body: 'テスト投稿です', latitude: 34.7025, longitude: 135.4959, postType: 'normal' });
    expect(response.status).toBe(201);
    expect(response.body.post).toEqual(expect.objectContaining({ body: 'テスト投稿です', likeCount: 0, commentCount: 0 }));
    expect(response.body.post.id).toMatch(/^post-/);
  });

  it('stores the place a post was made at', async () => {
    const response = await request(createApp())
      .post('/api/posts')
      .send({ authorId: 'demo-user-2', body: 'テスト投稿です', latitude: 34.7025, longitude: 135.4959, placeName: ' テストカフェ ', placeId: 'place-1', placeAddress: 'テスト市 1', placeType: 'cafe' });
    expect(response.status).toBe(201);
    expect(response.body.post).toEqual(expect.objectContaining({ placeName: 'テストカフェ', placeId: 'place-1', placeAddress: 'テスト市 1', placeType: 'cafe' }));

    const withoutName = await request(createApp())
      .post('/api/posts')
      .send({ authorId: 'demo-user-2', body: 'テスト投稿です', latitude: 34.7025, longitude: 135.4959, placeId: 'ignored' });
    expect(withoutName.body.post.placeName).toBeUndefined();
    expect(withoutName.body.post.placeId).toBeUndefined();
  });

  it('rejects an empty post', async () => {
    const response = await request(createApp()).post('/api/posts').send({ latitude: 36, longitude: 140, body: ' ' });
    expect(response.status).toBe(400);
  });

  it('rejects a body longer than 500 characters', async () => {
    const response = await request(createApp())
      .post('/api/posts')
      .send({ latitude: 36, longitude: 140, body: 'a'.repeat(501) });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid latitude', async () => {
    const response = await request(createApp()).post('/api/posts').send({ latitude: 91, longitude: 140, body: '本文' });
    expect(response.status).toBe(400);
  });

  it('rejects an invalid longitude', async () => {
    const response = await request(createApp()).post('/api/posts').send({ latitude: 36, longitude: 181, body: '本文' });
    expect(response.status).toBe(400);
  });

  it('likes and unlikes a post', async () => {
    const app = createApp();
    // post-002 の投稿者(demo-user-2)は公開アカウントなので、誰でもいいねできる
    const likeResponse = await request(app).post('/api/posts/post-002/like').send({ userId: 'test-user' });
    expect(likeResponse.status).toBe(200);
    expect(likeResponse.body.liked).toBe(true);

    const unlikeResponse = await request(app).delete('/api/posts/post-002/like').send({ userId: 'test-user' });
    expect(unlikeResponse.status).toBe(200);
    expect(unlikeResponse.body.liked).toBe(false);
  });

  it('adds a comment to a post', async () => {
    const app = createApp();
    const created = await request(app)
      .post('/api/posts')
      .send({ authorId: 'demo-user-1', authorName: 'デモユーザー', body: 'コメント対象の投稿', latitude: 34.7025, longitude: 135.4959, postType: 'normal' });
    const postId = created.body.post.id;
    const response = await request(app).post(`/api/posts/${postId}/comments`).send({ body: 'いいですね' });
    expect(response.status).toBe(201);
    expect(response.body.comment).toEqual(expect.objectContaining({ postId, body: 'いいですね' }));
  });

  it('records the commenter from authorId and uses the registered name', async () => {
    const app = createApp();
    const created = await request(app)
      .post('/api/posts')
      .send({ authorId: 'demo-user-2', authorName: 'さくら', body: 'コメント投稿者の確認', latitude: 34.7025, longitude: 135.4959, postType: 'normal' });
    const postId = created.body.post.id;
    // 公開アカウント(さくら)の投稿なので、フォローしていない たろう もコメントできる
    const response = await request(app).post(`/api/posts/${postId}/comments`).send({ body: 'こんにちは', authorId: 'demo-user-3', authorName: '偽名' });
    expect(response.status).toBe(201);
    expect(response.body.comment).toEqual(expect.objectContaining({ authorId: 'demo-user-3', authorName: 'たろう' }));

    const fallback = await request(app).post(`/api/posts/${postId}/comments`).send({ body: '名無し' });
    expect(fallback.body.comment).toEqual(expect.objectContaining({ authorId: 'demo-user-1', authorName: 'デモユーザー' }));
  });

  it('lets only the author delete a post', async () => {
    const app = createApp();
    const created = await request(app).post('/api/posts').send({ authorId: 'demo-user-2', body: '削除対象', latitude: 34.7025, longitude: 135.4959 });
    const id = created.body.post.id;

    expect((await request(app).delete(`/api/posts/${id}`).send({ userId: 'demo-user-3' })).status).toBe(403);

    const removed = await request(app).delete(`/api/posts/${id}`).send({ userId: 'demo-user-2' });
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ deleted: true, id });
    expect((await request(app).get(`/api/posts/${id}`)).status).toBe(404);
    expect((await request(app).delete(`/api/posts/${id}`).send({ userId: 'demo-user-2' })).status).toBe(404);
  });

  it('lets the commenter or the post owner delete a comment', async () => {
    const app = createApp();
    const created = await request(app).post('/api/posts').send({ authorId: 'demo-user-2', body: 'コメント削除対象', latitude: 34.7025, longitude: 135.4959 });
    const id = created.body.post.id;
    const first = (await request(app).post(`/api/posts/${id}/comments`).send({ body: 'ひとつめ', authorId: 'demo-user-3' })).body.comment;
    const second = (await request(app).post(`/api/posts/${id}/comments`).send({ body: 'ふたつめ', authorId: 'demo-user-3' })).body.comment;

    expect((await request(app).delete(`/api/posts/${id}/comments/${first.id}`).send({ userId: 'demo-user-1' })).status).toBe(403);

    const byCommenter = await request(app).delete(`/api/posts/${id}/comments/${first.id}`).send({ userId: 'demo-user-3' });
    expect(byCommenter.status).toBe(200);
    expect(byCommenter.body.commentCount).toBe(1);

    const byOwner = await request(app).delete(`/api/posts/${id}/comments/${second.id}`).send({ userId: 'demo-user-2' });
    expect(byOwner.status).toBe(200);
    expect(byOwner.body.commentCount).toBe(0);

    expect((await request(app).delete(`/api/posts/${id}/comments/${second.id}`).send({ userId: 'demo-user-2' })).status).toBe(404);
    await request(app).delete(`/api/posts/${id}`).send({ userId: 'demo-user-2' });
  });

  it('rejects an empty comment', async () => {
    const response = await request(createApp()).post('/api/posts/post-001/comments').send({ body: '' });
    expect(response.status).toBe(400);
  });
});
