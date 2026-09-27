# 開発ルール

このリポジトリで変更するときの規約。

## ブランチ運用

main / develop / 作業ブランチの3層で運用する。

| ブランチ | 役割 | 変更が入る経路 |
|---|---|---|
| `main` | 公開する状態だけを置く | develop からのリリース PR のみ |
| `develop` | 次に main へ入れる変更を統合する場所。GitHub の既定ブランチ | 作業ブランチからの PR |
| `feature/…` `fix/…` `docs/…` `chore/…` | 1つの目的の変更 | develop から切る |

- main と develop へ直接 push しない。必ず PR を経由する
- 作業ブランチは develop から切り、develop へ PR を出す。main へは develop からのリリース PR だけを出す
- マージ後は作業ブランチを削除する

この運用は 2026-09-27 から適用している。それより前の PR（#1〜#4）は、作業ブランチから main へ直接マージしていた。

## 変更の前に通すもの

バックエンド（`source/backend`）:

```bash
npm test            # vitest
npm run typecheck   # tsc --noEmit
```

フロントエンド（`source/frontend`）:

```bash
flutter analyze
```

## 絶対に守ること

- API キーを書いた `.env` をコミットしない。見本は `.env.example` に置き、値は `YOUR_...` のままにする
- 提出時点でチームと共同で編集したファイルは、提出時の内容を保つ。ハッカソン後の改良は `improvements/` に分けて置く
- 他のメンバーの氏名・連絡先を書かない
