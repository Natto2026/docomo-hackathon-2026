# ソースコード（自分が担当した範囲の抽出）

ハッカソンで自分が書いた・手を入れたファイルを**すべて**取り出し、画面まで動かせる形にしたものである。
自分が単独で書いたファイルに加えて、他のメンバーと共同で編集したファイルと、ビルドに必要な
最小限の他メンバーのファイルも含めている。公開は主催元の許可とチームの了承を得ている。

## 含めているもの・いないもの

| | 扱い |
|---|---|
| 提出時点で自分が単独で書いたファイル（42件） | 提出したものと同じ内容である（下の「置き換えたもの」を除く） |
| 提出時点で他のメンバーと共同で編集したファイル（23件） | 同上。どのファイルかは下の表にある。自分が書いたのはその一部である |
| ビルドと起動に必要な、他のメンバーが書いたファイル（28件） | 同上。自分は手を入れていない。Flutter の設定・Android と Web のひな形・アイコン、現在地の取得（`location_service.dart`）、距離の計算（`distanceService.ts`） |
| ハッカソン後に足した改良（25件。実装15、テスト6、実際の AWS で動かすための一式4） | `src/improvements/`、`tests/improvements/`、`infra/` にある |
| 単体で動かすための設定など（10件） | `package.json`、`package-lock.json`、`tsconfig.json`、`.gitignore`、`pubspec.lock`、架空データの `data/posts.json` と `data/likes.json`、テストの前後で data/ を戻す設定（`vitest.repo.config.ts`・`tests/restoreData.ts`）、この README |
| チームのリポジトリの README | **含めていない**。ソースコードではなく、他のメンバーの手元のパスが書かれているため |
| チームが操作して溜まった投稿データ（`data/posts.json` の元） | **含めていない**。架空のデータに差し替えている |
| 主催元から配布された資料、企画資料、審査の資料そのもの | **含めていない**（審査で受けた指摘の要旨は、[リポジトリのREADME](../README.md#アイデアソンからの経緯)に自分の言葉で書いている） |
| git の履歴 | 引き継いでいない。他のメンバーの氏名とメールアドレスが混ざるためである |

`source/` 配下は合計128ファイルである（42 + 23 + 28 + 25 + 10）。各ファイルの一覧は
[scripts/extract_from_team_repo.py](../scripts/extract_from_team_repo.py) の `SOLE_FILES`・`SHARED_FILES`・`SUPPORT_FILES` にある。
単独か共同かは、チームのリポジトリの git の履歴で、そのファイルに自分以外のコミットがあるかどうかで分けている。

### 置き換えたもの

- テストデータとデモ投稿の店名・地名・住所・座標は、架空の名前と、大阪駅・京都駅の周辺の座標に置き換えている。位置どうしの距離は保っている
- 地図と現在地の既定の座標（取得できないときの初期位置）も、同じく大阪駅の周辺にしている
- 自分の名前に由来する表示名は、中立な名前（デモユーザー）にしている
- `frontend/pubspec.yaml` の説明文が、チームのリポジトリの時点で文字化けしていたため、元の「地域限定SNS ハッカソンデモ」に戻している

処理の中身には手を入れていない。

### 共同で編集したファイル（23件）

「自分の行」は、チームのリポジトリの提出時点で `git blame` を取り、その行を最後に変更したコミットが
自分のものである行数である。他のメンバーが書いた行を自分が整形しただけでも自分の行に数えられるので、目安である。

| ファイル | 自分の行 |
|---|---|
| `backend/src/routes/posts.ts` | 103 / 206 行（50%） |
| `backend/src/server.ts` | 20 / 43 行（47%） |
| `backend/src/services/likeService.ts` | 23 / 38 行（61%） |
| `backend/src/services/postService.ts` | 21 / 60 行（35%） |
| `backend/src/types/post.ts` | 6 / 34 行（18%） |
| `backend/tests/posts.test.ts` | 72 / 168 行（43%） |
| `frontend/lib/main.dart` | 47 / 67 行（70%） |
| `frontend/lib/models/post.dart` | 65 / 137 行（47%） |
| `frontend/lib/screens/create_post_screen.dart` | 326 / 475 行（69%） |
| `frontend/lib/screens/map_screen.dart` | 410 / 443 行（93%） |
| `frontend/lib/screens/post_detail_screen.dart` | 168 / 320 行（53%） |
| `frontend/lib/screens/timeline_screen.dart` | 163 / 217 行（75%） |
| `frontend/lib/services/api_client.dart` | 275 / 365 行（75%） |
| `frontend/lib/widgets/post_card.dart` | 31 / 94 行（33%） |
| `frontend/test/create_post_screen_test.dart` | 30 / 68 行（44%） |
| `frontend/test/post_model_test.dart` | 8 / 108 行（7%） |
| `frontend/test/timeline_screen_test.dart` | 82 / 147 行（56%） |
| `frontend/test/widget_test.dart` | 1 / 21 行（5%） |
| `frontend/.env.example` | 2 / 4 行（50%） |
| `frontend/android/app/build.gradle.kts` | 26 / 75 行（35%） |
| `frontend/android/app/src/main/AndroidManifest.xml` | 1 / 47 行（2%） |
| `frontend/pubspec.yaml` | 2 / 29 行（7%） |
| `frontend/web/index.html.template` | 108 / 127 行（85%） |

地図画面では、同じ場所の投稿を1つのピンにまとめる処理（`MapScreen.groupPosts`）、店の紐づけ、
地図の選択カードの表示を自分が書いた。投稿とコメントの削除のうち、削除のときに画像ファイルを消す処理
（`src/utils/upload.ts`）は自分が単独で書いたファイルにある。

## 自分が単独で書いたもの

### バックエンド（Node.js + TypeScript + Express）

| ファイル | 内容 |
|---|---|
| `src/services/jsonStore.ts` | JSON ファイルへの保存。同時書き込みで内容が壊れないようにしている |
| `src/services/followService.ts` | フォロー、承認制のフォローリクエスト、承認・却下 |
| `src/services/userService.ts` | 利用者の取得・更新、公開範囲の判定 |
| `src/services/placesService.ts` | 店・施設の周辺候補、名前での検索、住所の逆引き |
| `src/routes/users.ts` | 利用者・フォロー・プロフィール写真の API |
| `src/routes/places.ts` | 店・施設の API |
| `src/utils/env.ts` | `.env` の読み込み。鍵をソースに置かないため |
| `src/utils/params.ts` | クエリ文字列の検証 |
| `src/utils/upload.ts` | 画像アップロードの受け口とサイズ制限 |
| `src/types/user.ts` | 利用者とフォローの型 |
| `tests/users.test.ts` | 利用者・フォロー・公開範囲のテスト |
| `tests/places.test.ts` | 店・施設のテスト（外部 API は差し替えて実行） |

### フロントエンド（Flutter）

利用者一覧、プロフィール、フォローリクエストの画面と、地図の選択カード、
現在地アイコン、フォローボタン、利用者切り替えなどの部品。およびそのテスト。

## ハッカソン後に足したもの

`src/improvements/` 配下は、発表で出た指摘と、そのあとの振り返りで見つけた課題を受けて、ハッカソン終了後に足したものである。
提出時点のファイルには手を入れず、改良は `src/improvements/app.ts` から、提出時点のアプリ（`src/server.ts` の `createApp()`）の手前に差し込んでいる。当時のコードとテストの内容はそのまま残っている（変えたのは、上に書いた置き換えだけである）。

### 踏破率（`improvements/coverage/`）

「半径を絞ると、知らなかった場所が見つかる」という主張を数字で裏づける。

```
GET /api/coverage?latitude=&longitude=&userId=&radius=&limit=

半径5km以内に123か所。行ったことがあるのは18%で、残り101か所は未訪問です。
```

あわせて、未訪問の場所を近い順に返し、半径1.5km / 5km / 20km での候補数を並べる。
広げるほど候補は増えるが、増えた分は「今日行ける場所」ではない、という対比を出すためである。
場所の取得にはハッカソンで書いた `placesService` をそのまま使っている。

### ログイン（`improvements/auth/`）

提出時点では操作者をクライアントの申告（`userId` など）で受け取っていた。
誰でも他人を名乗れるため、公開範囲をサーバー側で判定していても鍵アカウントが成り立たない。

- パスワードは scrypt で導出した鍵だけを保存する
- セッションは識別子だけを Cookie に入れ、中身はサーバー側に置く（失効を効かせるため）
- Cookie は HttpOnly、SameSite=Lax、本番は Secure
- 利用者IDの誤りとパスワードの誤りを区別せず、存在する利用者IDを外から調べられないようにする
- 身元はルーターの手前で上書きする。提出時のルーターに手を入れずになりすましだけを塞ぐため

既定では無効にしてある。提出時点の動きを残し、当時のテストがそのまま通るようにするためである。
有効にするには `improvements/app.ts` の `createApp({ requireAuth: true })` を使う。

```bash
npm test   # 提出時点のテストと、追加したテストの両方が走る
```

### フォロー関係の保存を DynamoDB に移せるようにする（`improvements/follows/`）

提出時点のフォロー関係は `data/follows.json` に保存している。同時書き込みはファイルごとの直列化キューで
防いでいるが、キューはプロセスの中にあるので、サーバーを複数立てた時点で守れなくなる。
チームは別のブランチで DynamoDB を採用していたので、ハッカソン後に、自分の担当分である
フォロー関係（鍵アカウントの承認制を含む）を同じ DynamoDB に移せるようにした。
チームのブランチのコードは使っていない。キー設計から作り直している。

**保存の抽象**（`store.ts`）。提出時点の `followService` が実際に使われている操作だけを interface にした
（2者間の状態、作成、解除、承認、拒否、保留中の一括承認、フォロー中・フォロワー・保留中リクエストの一覧、フォロワー数）。
全件の読み出しは、DynamoDB では Scan になるため入れていない。全件から数えていた公開範囲の判定は、
2者間の状態の問い合わせに置き換えた（`visibility.ts`）。
JSON 版（`jsonFollowStore.ts`）は `followService` を呼ぶだけの薄いアダプタで、提出時点のファイルは変えていない。

**キー設計**（`dynamoFollowStore.ts`）。テーブル1つと GSI 1つ。Scan は使わない。

| | パーティションキー | ソートキー | 引けるもの |
|---|---|---|---|
| テーブル | `USER#<フォローする側>` | `FOLLOWS#<される側>` | 2者間の状態（GetItem、強い整合性）、フォロー中の一覧（Query） |
| GSI `gsi1` | `USER#<される側>` | `<status>#<する側>` | フォロワー（`accepted#` で始まるもの）、届いている保留中リクエスト（`pending#` で始まるもの） |

- テーブルのキーに status を入れない。入れると「保留中」と「承認済み」が別の項目として並存でき、
  二重作成を防げなくなる。2者の組で項目が1つに決まるから、条件つき書き込みが効く
- status は GSI のソートキーの先頭に入れる。GSI のキーは普通の属性なので更新でき、承認のときに
  status と一緒に1回の更新で書き換えられる。保留中リクエストを、フィルタではなくキーの条件だけで引ける
- フォロー中の一覧だけは、自分が出した保留中リクエストを FilterExpression で除いている。
  1人が同時に出している未承認リクエストは少数で、GSI をもう1つ足すと書き込みのたびに料金が増えるため
- GSI は結果整合性なので、承認の直後、フォロワーの一覧に出るまでわずかに遅れることがある。
  投稿が見えるかどうかの判定は GetItem（強い整合性）で行うので、判定は遅れない

**条件つき書き込み**。JSON 版はプロセスの中のキューで守っていたが、DynamoDB 版は保存先の側で守る。

| 操作 | 条件 | 防いでいるもの |
|---|---|---|
| 作成 | `attribute_not_exists(pk)` | 同じリクエストの二重作成。承認待ちの関係を、2回目の作成で承認済みに上書きされること |
| 承認 | status が pending のときだけ更新 | 二重承認。取り消されたリクエストの承認（UpdateItem は項目が無いと作ってしまうので、条件が無いと関係が復活する） |
| 拒否 | status が pending のときだけ削除 | 承認済みの関係を「拒否」で消されること |

条件が成り立たないと DynamoDB は `ConditionalCheckFailedException` を返す。これを `improvements/auth` の
`AuthError` と同じ形（HTTP の status を持つエラー）に翻訳し、ルーターが `{ "error": "…" }` の JSON で返す。
二重承認と取り消し後の承認は、提出時点と同じ 404「フォローリクエストが見つかりません」になる。
フォローの二度押しだけは、提出時点の API に合わせて、エラーにせず今の状態を返している。

**保存先の切り替え**（`factory.ts`、`route.ts`）。環境変数で選ぶ。既定は JSON。

```
FOLLOW_STORE=json | dynamodb     既定は json
FOLLOW_TABLE_NAME=               dynamodb のとき必須
AWS_REGION=                      dynamodb のとき必須
```

`dynamodb` のときだけ、同じ URL・同じ応答の形のルーターを、提出時のルーターの手前に差し込む
（ログインと同じやり方）。投稿の一覧と1件の取得、いいね・コメントの前の公開範囲の判定も、
同じく差し込んだルーター（`postsRoute.ts`）が保存先に問い合わせる。`json` のときは何も差し込まず、提出時点のルーターがそのまま応答する。
アクセスキーはコードにも `.env` にも書かず、AWS SDK の既定の認証情報チェーンに任せる。
DynamoDB のクライアントは外から渡せるので、テストでは偽物を渡している。
提出時点の `.env.example` には手を入れていないので、`.env` に書き足す行の雛形は `infra/env.example` に分けた。

**テストの考え方**。同じテスト群を JSON 版と DynamoDB 版の両方に流す契約テストにして、
保存先を替えても振る舞いが変わらないことを、保存の層と API の両方で確かめている。
DynamoDB 版は実際の AWS を使わず、条件式を解釈するインメモリの偽物（`tests/improvements/fakeDynamo.ts`）で動かす。
応答を固定で返すモックでは、条件式を書き間違えてもテストが通ってしまうためである。
条件を外すと二重リクエスト・二重承認・取り消し後の承認のテストが落ちることは、実際に外して確かめた。
Scan を使っていないことは、発行したコマンドの種類を記録して検査している。

**実際の AWS での確認**。偽物と実物の差（式の文法、GSI の結果整合性、権限）を確かめるために、CloudFormation で
自分のアカウントにテーブルを作り、確認用スクリプト（`npm run smoke:aws`）を流した。11段すべて成功し、Scan は発行していない。
手順と結果は [backend/infra/README.md](backend/infra/README.md) にある。

**まだやっていないこと**。移したのはフォロー関係だけで、利用者・投稿・ログイン情報は JSON のまま。
プロフィール写真の登録と削除は提出時のルーターが応答するので、その応答に含まれるフォロワー数などは JSON の値になる。
利用者の一覧は1人につき4回の問い合わせになる。本番なら件数を利用者の側に持たせる。
一覧の並びは、JSON 版は追加順、DynamoDB 版はIDの順になる。
DynamoDB 版では、鍵アカウントの投稿へのいいねとコメントが、承認されたあとも 403 になる。
手前のルーターは DynamoDB のフォロー関係で通すが、書き込みを行う提出時点のルーターが
JSON のフォロー関係で判定し直すためである。提出時点のファイルに手を入れないと直せないので、残している。

## 動かし方（バックエンド）

Node.js 20 以上が必要である（AWS SDK for JavaScript v3 が 20 以上を求めるため）。

```bash
cd source/backend
npm install
npm test               # 提出時点のテストと、改良のテストをすべて実行する
npm run dev            # 提出時点のアプリを http://localhost:3000 で起動する
npm run dev:improved   # 改良（ログイン・踏破率・保存先の切り替え）を載せて http://127.0.0.1:3000 で起動する
npm run smoke:aws   # 実際の AWS への確認。設定が無ければ何もせず説明を出して終わる
```

店・施設の検索に Google Places API を使う場合は `.env.example` を `.env` に写して
`GOOGLE_PLACES_API_KEY` を設定する。設定しない場合は OpenStreetMap（Overpass API と Nominatim）の
公開サーバーに問い合わせる。鍵を書かなくてもテストは通る
（外部への問い合わせを差し替えて実行するため）。

## 動かし方（画面）

Flutter 3 系で、Web（Chrome）と Android で動く。バックエンドを先に `npm run dev` で起動しておく。

```powershell
cd source/frontend
flutter pub get
flutter test                  # 画面のテスト
copy .env.example .env        # frontend の .env。GOOGLE_MAPS_WEB_API_KEY に、ブラウザ用に制限した Google Maps の鍵を書く
powershell -File tools/generate_web_index.ps1   # 鍵を埋め込んだ web/index.html を作る（公開しない）
flutter run -d chrome
```

鍵を持っていない場合は、`web/index.html.template` を `web/index.html` に写せば起動できる（地図は「エラーが発生しました」と表示される）。
Android のエミュレーターでは、API の接続先が `http://10.0.2.2:3000/api` になる。
投稿画面を開くと周辺の店・施設を探しに行く。OpenStreetMap の公開サーバーが混んでいると応答が返らず、
候補の欄が読み込み中のままになることがある（バックエンドの `.env` に `GOOGLE_PLACES_API_KEY` を書くと Google に切り替わる）。
Android での起動は、手元に Android SDK がないため確かめていない。Web（Chrome）では、タイムライン・利用者・投稿の画面が表示されることを確かめた。
パスに日本語などが含まれると `flutter analyze` が失敗することがある（Dart の解析サーバーの制約）。

## 設計上の判断

同時書き込みへの対処は `src/services/jsonStore.ts` にある。
どう対処し、なぜそうしたかは[リポジトリのREADME](../README.md#同時書き込みへの対処)に書いている。

審査での指摘と振り返りの課題にどう対応したかは[リポジトリのREADME](../README.md#ハッカソン後に取り組んだこと)に、
残っている課題は[今後の改善点](../README.md#今後の改善点)に書いている。
