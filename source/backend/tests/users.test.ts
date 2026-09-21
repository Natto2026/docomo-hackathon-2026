import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import { createApp } from '../src/server';

const FOLLOWER = 'test-follower';
const TARGET = 'demo-user-2';          // 公開アカウント
const PRIVATE_TARGET = 'demo-user-3';  // 鍵アカウント(投稿 post-003 は 34.9858,135.7588)

describe('users API', () => {
  afterAll(async () => {
    const app = createApp();
    await request(app).delete(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    await request(app).delete(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    await request(app).patch(`/api/users/${TARGET}`).send({ isPrivate: false, userId: TARGET });
  });

  it('lists known users with counts and follow state', async () => {
    const response = await request(createApp()).get('/api/users?viewerId=demo-user-1');
    expect(response.status).toBe(200);
    expect(response.body.users).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'demo-user-1', name: 'デモユーザー' }),
      expect.objectContaining({ id: TARGET, isPrivate: false }),
      expect.objectContaining({ id: PRIVATE_TARGET, isPrivate: true }),
    ]));
    const first = response.body.users[0];
    expect(typeof first.postCount).toBe('number');
    expect(typeof first.followerCount).toBe('number');
    expect(typeof first.followingCount).toBe('number');
    expect(typeof first.isFollowing).toBe('boolean');
    expect(typeof first.canViewPosts).toBe('boolean');
    expect(['none', 'pending', 'accepted']).toContain(first.followStatus);
  });

  it('gets a single user profile', async () => {
    const response = await request(createApp()).get('/api/users/demo-user-1');
    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({ id: 'demo-user-1', name: 'デモユーザー' }));
    expect(response.body.postCount).toBeGreaterThan(0);
    expect(response.body.canViewPosts).toBe(true);
  });

  it('returns 404 for an unknown user', async () => {
    const response = await request(createApp()).get('/api/users/does-not-exist');
    expect(response.status).toBe(404);
  });

  it('lists posts by a user', async () => {
    const response = await request(createApp()).get('/api/users/demo-user-1/posts?viewerId=demo-user-1');
    expect(response.status).toBe(200);
    expect(response.body.locked).toBe(false);
    expect(response.body.posts.length).toBeGreaterThan(0);
    expect(response.body.posts.every((post: { authorId: string }) => post.authorId === 'demo-user-1')).toBe(true);
  });

  it('applies the radius filter to a user posts list', async () => {
    const response = await request(createApp()).get(`/api/users/${TARGET}/posts?latitude=34.7025&longitude=135.4959&radius=5000`);
    expect(response.status).toBe(200);
    expect(response.body.posts.every((post: { distanceMeters: number }) => post.distanceMeters <= 5000)).toBe(true);
  });

  it('rejects following yourself', async () => {
    const response = await request(createApp()).post('/api/users/demo-user-1/follow').send({ followerId: 'demo-user-1' });
    expect(response.status).toBe(400);
  });

  it('returns 404 when following an unknown user', async () => {
    const response = await request(createApp()).post('/api/users/does-not-exist/follow').send({ followerId: FOLLOWER });
    expect(response.status).toBe(404);
  });

  it('follows and unfollows a public user immediately', async () => {
    const app = createApp();
    const before = await request(app).get(`/api/users/${TARGET}?viewerId=${FOLLOWER}`);
    expect(before.body.isFollowing).toBe(false);
    const baseCount: number = before.body.followerCount;

    const followResponse = await request(app).post(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(followResponse.status).toBe(200);
    expect(followResponse.body).toEqual({ userId: TARGET, following: true, status: 'accepted', followerCount: baseCount + 1 });

    const duplicate = await request(app).post(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(duplicate.body.followerCount).toBe(baseCount + 1);

    const status = await request(app).get(`/api/users/${TARGET}/follow?followerId=${FOLLOWER}`);
    expect(status.body.following).toBe(true);

    const profile = await request(app).get(`/api/users/${TARGET}?viewerId=${FOLLOWER}`);
    expect(profile.body.isFollowing).toBe(true);
    expect(profile.body.followStatus).toBe('accepted');
    expect(profile.body.followerCount).toBe(baseCount + 1);

    const followers = await request(app).get(`/api/users/${TARGET}/followers`);
    expect(followers.body.users.map((user: { id: string }) => user.id)).toContain(FOLLOWER);

    const following = await request(app).get(`/api/users/${FOLLOWER}/following`);
    expect(following.body.users.map((user: { id: string }) => user.id)).toContain(TARGET);

    const unfollowResponse = await request(app).delete(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(unfollowResponse.status).toBe(200);
    expect(unfollowResponse.body).toEqual({ userId: TARGET, following: false, status: 'none', followerCount: baseCount });

    const after = await request(app).get(`/api/users/${TARGET}/follow?followerId=${FOLLOWER}`);
    expect(after.body.following).toBe(false);
  });

  it('filters the post list to followed users only', async () => {
    const app = createApp();
    const none = await request(app).get(`/api/posts?latitude=34.7025&longitude=135.4959&followingOf=${FOLLOWER}`);
    expect(none.status).toBe(200);
    expect(none.body.posts).toEqual([]);

    await request(app).post(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    const some = await request(app).get(`/api/posts?latitude=34.7025&longitude=135.4959&followingOf=${FOLLOWER}`);
    expect(some.body.posts.length).toBeGreaterThan(0);
    expect(some.body.posts.every((post: { authorId: string }) => post.authorId === TARGET)).toBe(true);

    await request(app).delete(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
  });

  it('hides a private user posts from non-followers', async () => {
    const app = createApp();
    const list = await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&viewerId=${FOLLOWER}`);
    expect(list.status).toBe(200);
    expect(list.body.posts.some((post: { authorId: string }) => post.authorId === PRIVATE_TARGET)).toBe(false);

    const detail = await request(app).get(`/api/posts/post-003?viewerId=${FOLLOWER}`);
    expect(detail.status).toBe(403);

    const userPosts = await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${FOLLOWER}`);
    expect(userPosts.status).toBe(200);
    expect(userPosts.body).toEqual({ posts: [], count: 0, locked: true });

    // 本人からは見える
    const own = await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${PRIVATE_TARGET}`);
    expect(own.body.locked).toBe(false);
    expect(own.body.posts.length).toBeGreaterThan(0);
  });

  it('blocks likes and comments on a hidden private post', async () => {
    const app = createApp();
    const before = await request(app).get(`/api/posts/post-003?viewerId=${PRIVATE_TARGET}`);
    const like = await request(app).post('/api/posts/post-003/like').send({ userId: FOLLOWER });
    expect(like.status).toBe(403);
    const comment = await request(app).post('/api/posts/post-003/comments').send({ body: 'こんにちは', authorId: FOLLOWER });
    expect(comment.status).toBe(403);
    const after = await request(app).get(`/api/posts/post-003?viewerId=${PRIVATE_TARGET}`);
    expect(after.body.likeCount).toBe(before.body.likeCount);
    expect(after.body.commentCount).toBe(before.body.commentCount);
  });

  it('keeps every write when follow requests overlap', async () => {
    const app = createApp();
    await Promise.all([
      request(app).post(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER }),
      request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER }),
    ]);
    const publicState = await request(app).get(`/api/users/${TARGET}/follow?followerId=${FOLLOWER}`);
    const privateState = await request(app).get(`/api/users/${PRIVATE_TARGET}/follow?followerId=${FOLLOWER}`);
    expect(publicState.body.status).toBe('accepted');
    expect(privateState.body.status).toBe('pending');
    await Promise.all([
      request(app).delete(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER }),
      request(app).delete(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER }),
    ]);
    const cleared = await request(app).get(`/api/users/${FOLLOWER}/following`);
    expect(cleared.body.users).toEqual([]);
  });

  it('returns a JSON error for an oversized profile photo', async () => {
    const big = Buffer.alloc(10 * 1024 * 1024 + 1, 1);
    const response = await request(createApp())
      .post(`/api/users/${TARGET}/avatar`)
      .field('userId', TARGET)
      .attach('image', big, { filename: 'big.png', contentType: 'image/png' });
    expect(response.status).toBe(400);
    expect(response.body.error).toContain('10MB');
  });

  it('turns a follow of a private user into a request that must be approved', async () => {
    const app = createApp();
    const before = await request(app).get(`/api/users/${PRIVATE_TARGET}?viewerId=${FOLLOWER}`);
    const baseCount: number = before.body.followerCount;

    const followResponse = await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(followResponse.status).toBe(200);
    expect(followResponse.body).toEqual({ userId: PRIVATE_TARGET, following: false, status: 'pending', followerCount: baseCount });

    const profile = await request(app).get(`/api/users/${PRIVATE_TARGET}?viewerId=${FOLLOWER}`);
    expect(profile.body.followStatus).toBe('pending');
    expect(profile.body.canViewPosts).toBe(false);

    const requests = await request(app).get(`/api/users/${PRIVATE_TARGET}/requests`);
    expect(requests.body.users.map((user: { id: string }) => user.id)).toContain(FOLLOWER);

    const stillHidden = await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&viewerId=${FOLLOWER}`);
    expect(stillHidden.body.posts.some((post: { authorId: string }) => post.authorId === PRIVATE_TARGET)).toBe(false);

    const approve = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/approve`);
    expect(approve.status).toBe(200);
    expect(approve.body).toEqual({ userId: PRIVATE_TARGET, followerId: FOLLOWER, status: 'accepted', followerCount: baseCount + 1 });

    const accepted = await request(app).get(`/api/users/${PRIVATE_TARGET}/follow?followerId=${FOLLOWER}`);
    expect(accepted.body).toEqual({ userId: PRIVATE_TARGET, following: true, status: 'accepted', followerCount: baseCount + 1 });

    const visible = await request(app).get(`/api/posts?latitude=34.9858&longitude=135.7588&viewerId=${FOLLOWER}`);
    expect(visible.body.posts.some((post: { authorId: string }) => post.authorId === PRIVATE_TARGET)).toBe(true);

    const detail = await request(app).get(`/api/posts/post-003?viewerId=${FOLLOWER}`);
    expect(detail.status).toBe(200);

    const userPosts = await request(app).get(`/api/users/${PRIVATE_TARGET}/posts?viewerId=${FOLLOWER}`);
    expect(userPosts.body.locked).toBe(false);
    expect(userPosts.body.posts.length).toBeGreaterThan(0);

    await request(app).delete(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    const after = await request(app).get(`/api/users/${PRIVATE_TARGET}/follow?followerId=${FOLLOWER}`);
    expect(after.body.status).toBe('none');
  });

  it('rejects a follow request', async () => {
    const app = createApp();
    await request(app).post(`/api/users/${PRIVATE_TARGET}/follow`).send({ followerId: FOLLOWER });
    const reject = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/reject`);
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe('none');

    const status = await request(app).get(`/api/users/${PRIVATE_TARGET}/follow?followerId=${FOLLOWER}`);
    expect(status.body.status).toBe('none');

    const again = await request(app).post(`/api/users/${PRIVATE_TARGET}/requests/${FOLLOWER}/reject`);
    expect(again.status).toBe(404);
  });

  it('switches an account to private and back, accepting pending requests on reopening', async () => {
    const app = createApp();
    const toPrivate = await request(app).patch(`/api/users/${TARGET}`).send({ isPrivate: true, userId: TARGET });
    expect(toPrivate.status).toBe(200);
    expect(toPrivate.body.isPrivate).toBe(true);

    const followResponse = await request(app).post(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
    expect(followResponse.body.status).toBe('pending');

    const me = await request(app).get(`/api/users/${TARGET}?viewerId=${TARGET}`);
    expect(me.body.pendingRequestCount).toBeGreaterThanOrEqual(1);

    const toPublic = await request(app).patch(`/api/users/${TARGET}`).send({ isPrivate: false, userId: TARGET });
    expect(toPublic.body.isPrivate).toBe(false);

    const status = await request(app).get(`/api/users/${TARGET}/follow?followerId=${FOLLOWER}`);
    expect(status.body.status).toBe('accepted');

    await request(app).delete(`/api/users/${TARGET}/follow`).send({ followerId: FOLLOWER });
  });

  it('rejects a non-boolean isPrivate', async () => {
    const response = await request(createApp()).patch(`/api/users/${TARGET}`).send({ isPrivate: 'yes', userId: TARGET });
    expect(response.status).toBe(400);
  });

  it('rejects changing someone else profile or photo', async () => {
    const app = createApp();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

    const privacy = await request(app).patch(`/api/users/${TARGET}`).send({ isPrivate: false, userId: FOLLOWER });
    expect(privacy.status).toBe(403);

    const upload = await request(app)
      .post(`/api/users/${TARGET}/avatar`)
      .field('userId', FOLLOWER)
      .attach('image', png, { filename: 'avatar.png', contentType: 'image/png' });
    expect(upload.status).toBe(403);

    const removal = await request(app).delete(`/api/users/${TARGET}/avatar`).send({ userId: FOLLOWER });
    expect(removal.status).toBe(403);

    // 鍵アカウントの設定が他人の操作で変わっていないこと
    const profile = await request(app).get(`/api/users/${PRIVATE_TARGET}`);
    expect(profile.body.isPrivate).toBe(true);
  });

  it('uploads and removes a profile photo', async () => {
    const app = createApp();
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const upload = await request(app).post(`/api/users/${TARGET}/avatar`).field('userId', TARGET).attach('image', png, { filename: 'avatar.png', contentType: 'image/png' });
    expect(upload.status).toBe(200);
    expect(upload.body.avatarUrl).toMatch(/\/uploads\/.+\.png$/);

    const profile = await request(app).get(`/api/users/${TARGET}`);
    expect(profile.body.avatarUrl).toBe(upload.body.avatarUrl);

    const removed = await request(app).delete(`/api/users/${TARGET}/avatar`).send({ userId: TARGET });
    expect(removed.status).toBe(200);
    expect(removed.body.avatarUrl).toBeNull();
  });

  it('rejects a non-image profile photo', async () => {
    const response = await request(createApp())
      .post(`/api/users/${TARGET}/avatar`)
      .field('userId', TARGET)
      .attach('image', Buffer.from('not an image'), { filename: 'memo.txt', contentType: 'text/plain' });
    expect(response.status).toBe(400);
  });
});
