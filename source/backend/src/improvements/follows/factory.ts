/**
 * 保存先の切り替え。ハッカソン後に足したもの。
 *
 *   FOLLOW_STORE        json（既定）| dynamodb
 *   FOLLOW_TABLE_NAME   DynamoDB のテーブル名（dynamodb のとき必須）
 *   FOLLOW_INDEX_NAME   GSI の名前（省略時は gsi1）
 *   AWS_REGION          リージョン（dynamodb のとき必須）
 *
 * アクセスキーはここでは扱わない。AWS SDK の既定の認証情報チェーン
 * （`aws configure` で作られる ~/.aws/credentials、環境変数、実行環境のロール）に任せる。
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

import { createDynamoFollowStore, DynamoSender } from './dynamoFollowStore';
import { createJsonFollowStore } from './jsonFollowStore';
import { FollowStore } from './store';

type Env = Record<string, string | undefined>;

/** 設定の誤りは、最初のリクエストではなく起動の時点で分かるようにする。 */
export class FollowStoreConfigError extends Error {}

export type DynamoSettings = { tableName: string; region: string; indexName?: string };

/** 環境変数から DynamoDB の設定を読む。足りないものがあれば、その名前を並べたエラーにする。 */
export function dynamoSettingsFromEnv(env: Env = process.env): DynamoSettings {
  const tableName = env.FOLLOW_TABLE_NAME?.trim();
  const region = env.AWS_REGION?.trim();
  const missing = [!tableName && 'FOLLOW_TABLE_NAME', !region && 'AWS_REGION'].filter(Boolean);
  if (!tableName || !region) {
    throw new FollowStoreConfigError(`DynamoDB を使うには ${missing.join(' と ')} を設定してください`);
  }
  return { tableName, region, indexName: env.FOLLOW_INDEX_NAME?.trim() || undefined };
}

export function createDocumentClient(region: string): DynamoDBDocumentClient {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
}

/**
 * 環境変数に従って保存先を作る。
 * client を渡すと DynamoDB のクライアントを差し替えられる（テスト用）。
 */
export function followStoreFromEnv(env: Env = process.env, client?: DynamoSender): FollowStore {
  const kind = (env.FOLLOW_STORE ?? 'json').trim().toLowerCase();
  if (kind === 'json' || kind === '') return createJsonFollowStore();
  if (kind !== 'dynamodb') {
    throw new FollowStoreConfigError(`FOLLOW_STORE は json か dynamodb で指定してください（指定された値: ${kind}）`);
  }
  const settings = dynamoSettingsFromEnv(env);
  return createDynamoFollowStore({
    client: client ?? createDocumentClient(settings.region),
    tableName: settings.tableName,
    indexName: settings.indexName,
  });
}
