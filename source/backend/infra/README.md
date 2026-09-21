# 実際の AWS で動かす手順（フォロー関係の DynamoDB 版）

ハッカソン後に足した DynamoDB 版のフォロー関係の保存（`src/improvements/follows/`）を、
自分の AWS アカウントの実テーブルで確かめるための一式です。

| ファイル | 内容 |
|---|---|
| `follow-table.yaml` | CloudFormation のテンプレート。テーブル1つと GSI 1つだけを作ります |
| `iam-policy.json` | この確認に必要な権限だけを並べた IAM の方針（`ACCOUNT_ID` を自分の値に置き換えて使います） |
| `env.example` | `backend/.env` に書き足す行の雛形（保存先、テーブル名、リージョン） |

**現状**: テストは、条件式を解釈するインメモリの偽物に対して通っています。
実際の AWS ではまだ動かしていません。下の手順を実行したら、結果をこの README に追記します。

## 課金について

テーブルはオンデマンド（`PAY_PER_REQUEST`）にしています。読み書きした回数だけの課金で、
置いたままでも読み書きが無ければ読み書きの料金は出ません。DynamoDB の無料枠（25 WCU・25 RCU）は
プロビジョンドの容量が対象でオンデマンドには適用されませんが、確認用スクリプトが発行するのは
30回前後で、公式の料金表（書き込み100万回あたり1ドル未満。2026年9月に米国東部の表で確認）に照らすと
1円に届きません。プロビジョンドにしなかったのは、消し忘れたときに、無料枠の対象外のアカウントでは
時間単位の料金が出続けるためです。どちらにしても、使い終わったら手順7でスタックを消します。

## 手順

コマンドは PowerShell で、`source/backend` をカレントディレクトリにして実行します。
リージョンは東京（`ap-northeast-1`）、スタック名は `follow-store-dev`、
テーブル名は `follow-relations-dev` として書いています。

### 1. AWS CLI を入れる（Windows）

```powershell
winget install -e --id Amazon.AWSCLI
```

winget が使えなければ、公式のインストーラ `https://awscli.amazonaws.com/AWSCLIV2.msi` を実行します。
PowerShell を開き直してから、入ったことを確かめます。

```powershell
aws --version
```

### 2. IAM で最小権限の利用者を作り、アクセスキーを発行する

**ルート利用者のアクセスキーは作りません。** ルートのキーはアカウントの全権限を持ち、権限を絞れないためです。
この確認のためだけの IAM 利用者を作り、必要な権限だけを付けます。

1. AWS の管理画面に、普段使っている管理者のログインで入ります
2. 右上のアカウント名を開き、12桁のアカウントIDを控えます
3. `infra/iam-policy.json` の `ACCOUNT_ID`（5か所）を、そのアカウントIDに置き換えた内容を用意します
   （置き換えたものはコミットしません。管理画面に貼るだけです）
4. IAM → ポリシー → ポリシーの作成 → JSON に貼り付け、`follow-store-dev-policy` の名前で保存します
5. IAM → ユーザー → ユーザーの作成。名前は `follow-store-dev`。管理画面へのアクセスは付けません。
   「ポリシーを直接アタッチする」で、4 のポリシーだけを付けます
6. 作った利用者 → セキュリティ認証情報 → アクセスキーを作成 → 用途は「コマンドラインインターフェイス (CLI)」。
   表示されたアクセスキーIDとシークレットを控えます（シークレットが見られるのはこの画面だけです）

付けている権限は次の3種類だけです。

| 対象 | 許可する操作 | 理由 |
|---|---|---|
| スタック `follow-store-dev` | `cloudformation:CreateStack` / `DescribeStacks` / `DescribeStackEvents` / `DeleteStack` | スタックの作成、完了待ち、失敗時の原因確認、削除 |
| テーブル `follow-relations-dev` | `dynamodb:CreateTable` / `DeleteTable` / `DescribeTable` と、`Describe…`・`ListTagsOfResource`・`GetResourcePolicy` の読み取り | CloudFormation は呼び出した利用者の権限でテーブルを作り、作成後に設定を読み取るため |
| テーブルとその GSI `gsi1` | `dynamodb:GetItem` / `PutItem` / `UpdateItem` / `DeleteItem` / `Query` | アプリと確認用スクリプトが使う操作。**`Scan` は許可していません**。設計どおり Scan を使っていなければ困らず、使っていれば権限エラーで分かります |

この方針は、実際の AWS ではまだ試していません。手順4が権限不足で失敗したときは、
次のコマンドで出る失敗の理由に、足りない操作の名前が書かれています。それをポリシーに足してやり直します。

```powershell
aws cloudformation describe-stack-events --stack-name follow-store-dev --region ap-northeast-1 --query "StackEvents[?contains(ResourceStatus,'FAILED')].[LogicalResourceId,ResourceStatusReason]" --output text
```

### 3. `aws configure`

```powershell
aws configure
```

聞かれる4項目に、手順2のアクセスキーID、シークレット、`ap-northeast-1`、`json` を入れます。
キーは PC の `~/.aws/credentials` に保存されます。リポジトリにも `.env` にも書きません。

### 4. スタックを作る

```powershell
aws cloudformation create-stack --stack-name follow-store-dev --template-body file://infra/follow-table.yaml --region ap-northeast-1
aws cloudformation wait stack-create-complete --stack-name follow-store-dev --region ap-northeast-1
aws dynamodb describe-table --table-name follow-relations-dev --region ap-northeast-1 --query "Table.[TableStatus,BillingModeSummary.BillingMode,GlobalSecondaryIndexes[0].IndexStatus]"
```

最後のコマンドが `ACTIVE`、`PAY_PER_REQUEST`、`ACTIVE` を返せば準備完了です。

### 5. `.env` を設定する

`infra/env.example` の3行を `backend/.env` に書き足します（`.env` が無ければ新しく作ります）。

```
FOLLOW_STORE=dynamodb
FOLLOW_TABLE_NAME=follow-relations-dev
AWS_REGION=ap-northeast-1
```

### 6. 確認用スクリプトを流す

```powershell
npm run smoke:aws
```

リクエスト → 二重リクエスト（失敗するはず）→ 承認 → 二重承認（失敗するはず）→ 取り消し後の承認（失敗するはず）→
Query での確認 → 後片付け、を実テーブルに流します。各段の `OK` / `NG` と、発行したコマンドの種類・件数、
Scan を発行していないことが出ます。利用者IDは `smoke-fictional-…` で始まる架空の値で、
最後に自分が作った項目だけを消します。全段 `OK` なら終了コードは 0 です。

アプリごと DynamoDB で動かす場合は、この `.env` のまま `npm run dev` で起動します。

### 7. 使い終わったらスタックを消す

```powershell
aws cloudformation delete-stack --stack-name follow-store-dev --region ap-northeast-1
aws cloudformation wait stack-delete-complete --stack-name follow-store-dev --region ap-northeast-1
```

消えたことを確かめます。どちらも「存在しない」というエラーになれば消えています。

```powershell
aws cloudformation describe-stacks --stack-name follow-store-dev --region ap-northeast-1
aws dynamodb describe-table --table-name follow-relations-dev --region ap-northeast-1
```

課金が出ていないことは、管理画面に普段のログインで入り、
「請求とコスト管理」→「請求書」で当月の DynamoDB の行を見て確かめます
（反映には1日ほどかかることがあります。IAM 利用者 `follow-store-dev` には請求を見る権限がありません）。

最後に、`backend/.env` の `FOLLOW_STORE` を `json` に戻すか行ごと消し、
もう使わないなら IAM → ユーザー → `follow-store-dev` でアクセスキーを無効化または削除します。
