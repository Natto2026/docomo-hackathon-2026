// デモ用の他ユーザー投稿を data/posts.json に追加する(既にある ID はスキップ)。
// 使い方: node scripts/seed-demo-posts.js
const fs = require('node:fs');
const path = require('node:path');

const file = path.resolve(__dirname, '../data/posts.json');
const posts = JSON.parse(fs.readFileSync(file, 'utf8'));
const seeds = [
  { id: 'post-002', authorId: 'demo-user-2', authorName: 'さくら', body: '中央公園でコスモスが咲き始めていました。散歩におすすめです。', imageUrl: null, latitude: 34.7047, longitude: 135.4972, category: 'おすすめ', postType: 'normal', likeCount: 2, commentCount: 0, createdAt: '2026-09-09T08:10:00.000Z', comments: [] },
  { id: 'post-003', authorId: 'demo-user-3', authorName: 'たろう', body: '駅前のラーメン屋、今なら並ばずに入れます!', imageUrl: null, latitude: 34.9858, longitude: 135.7588, category: 'グルメ', postType: 'realtime', likeCount: 1, commentCount: 0, createdAt: '2026-09-09T08:30:00.000Z', comments: [] },
  { id: 'post-004', authorId: 'demo-user-2', authorName: 'さくら', body: '海沿いの公園から見た夕日がきれいでした。', imageUrl: null, latitude: 34.9825, longitude: 135.7517, category: '風景', postType: 'normal', likeCount: 4, commentCount: 0, createdAt: '2026-09-09T08:45:00.000Z', comments: [] },
];

let added = 0;
for (const seed of seeds) {
  if (posts.some((post) => post.id === seed.id)) continue;
  posts.push(seed);
  added += 1;
}
fs.writeFileSync(file, `${JSON.stringify(posts, null, 2)}\n`, 'utf8');
console.log(`seeded ${added} post(s), total ${posts.length}`);
