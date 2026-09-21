/**
 * DynamoDB 版のフォロー関係の保存。ハッカソン後に自分ひとりで足したもの。
 *
 * キー設計（テーブル1つ + GSI 1つ。Scan は使わない）
 *
 *   1項目 = 「follower が followee をフォローしている（またはリクエスト中）」という関係1つ
 *
 *   テーブル   pk     = USER#<followerId>      sk     = FOLLOWS#<followeeId>
 *   GSI(gsi1)  gsi1pk = USER#<followeeId>      gsi1sk = <status>#<followerId>
 *
 *   - 2者間の状態          GetItem(pk, sk)。強い整合性で読む（公開範囲の判定に使うため）
 *   - フォロー中の一覧     テーブルを pk で Query
 *   - フォロワーの一覧     GSI を gsi1pk で Query、gsi1sk が "accepted#" で始まるもの
 *   - 保留中リクエスト     GSI を gsi1pk で Query、gsi1sk が "pending#" で始まるもの
 *
 * なぜこの形か
 *   - テーブルのキーに status を入れない。入れると「保留中」と「承認済み」が別の項目として
 *     並存でき、attribute_not_exists で二重作成を防げなくなる。2者の組で項目が1つに決まる
 *     からこそ、条件つき書き込みが効く
 *   - status は GSI のソートキーの先頭に入れる。GSI のキーは普通の属性なので更新でき、
 *     承認のとき status と gsi1sk を同じ1回の条件つき更新で書き換えられる。
 *     これで「届いている保留中リクエスト」を、フィルタではなくキーの条件だけで引ける
 *   - フォロー中の一覧だけは、自分が出した保留中リクエストを FilterExpression で除いている。
 *     1人が同時に出している未承認リクエストは少数で、読み捨ての量が小さい。
 *     ここにも GSI を足すと書き込みのたびに料金が1つ分増えるので、足さなかった
 *   - GSI は結果整合性。承認の直後、フォロワーの一覧に出るまでわずかに遅れることがある。
 *     見える・見えないの判定は GetItem（強い整合性）の側で行うので、判定は遅れない
 *
 * 同時書き込みの守り方（JSON 版はプロセス内のキューだったが、こちらは保存先の側で守る）
 *   - 作成   attribute_not_exists(pk)            同じ2者の関係を二重に作らせない
 *   - 承認   status が pending のときだけ更新     二重承認、取り消し済みリクエストの承認を失敗させる
 *   - 拒否   status が pending のときだけ削除     承認済みの関係を「拒否」で消させない
 *   条件が成り立たなかったとき DynamoDB は ConditionalCheckFailedException を返す。
 *   それを FollowStore のエラー（HTTP の status つき）に翻訳する。
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  DeleteCommand,
  DeleteCommandOutput,
  GetCommand,
  GetCommandOutput,
  PutCommand,
  QueryCommand,
  QueryCommandInput,
  QueryCommandOutput,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

import { FollowStatus } from '../../types/user';
import { FollowAlreadyExistsError, FollowRequestNotFoundError, FollowStore, StoredFollowStatus } from './store';

export const DEFAULT_INDEX_NAME = 'gsi1';

/** このストアが発行するコマンド。Scan は含めていない。 */
export type FollowCommand = GetCommand | PutCommand | UpdateCommand | DeleteCommand | QueryCommand;

/**
 * DocumentClient のうち、このストアが使う部分だけ。
 * 外から渡せるようにして、テストでは実 AWS の代わりにインメモリの偽物を渡す。
 */
export interface DynamoSender {
  send(command: FollowCommand): Promise<unknown>;
}

export type DynamoFollowStoreOptions = {
  client: DynamoSender;
  tableName: string;
  indexName?: string;
};

export const userKey = (userId: string) => `USER#${userId}`;
export const followsKey = (followeeId: string) => `FOLLOWS#${followeeId}`;
export const statusKey = (status: StoredFollowStatus, followerId: string) => `${status}#${followerId}`;

export function keyOf(followerId: string, followeeId: string) {
  return { pk: userKey(followerId), sk: followsKey(followeeId) };
}

function isConditionalCheckFailed(error: unknown): boolean {
  return (
    error instanceof ConditionalCheckFailedException ||
    (error as { name?: unknown } | undefined)?.name === 'ConditionalCheckFailedException'
  );
}

export function createDynamoFollowStore(options: DynamoFollowStoreOptions): FollowStore {
  const { client, tableName } = options;
  const indexName = options.indexName ?? DEFAULT_INDEX_NAME;

  /** 1回の Query は 1MB までしか返さないので、続きがある限り引き直す。 */
  async function queryAll(input: QueryCommandInput): Promise<QueryCommandOutput[]> {
    const pages: QueryCommandOutput[] = [];
    let startKey: QueryCommandInput['ExclusiveStartKey'];
    do {
      const page = (await client.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }))) as QueryCommandOutput;
      pages.push(page);
      startKey = page.LastEvaluatedKey;
    } while (startKey);
    return pages;
  }

  /** GSI を「followee 宛て・指定の status」で引く。 */
  function incomingQuery(followeeId: string, status: StoredFollowStatus): QueryCommandInput {
    return {
      TableName: tableName,
      IndexName: indexName,
      KeyConditionExpression: '#gsi1pk = :followee AND begins_with(#gsi1sk, :status)',
      ExpressionAttributeNames: { '#gsi1pk': 'gsi1pk', '#gsi1sk': 'gsi1sk' },
      ExpressionAttributeValues: { ':followee': userKey(followeeId), ':status': `${status}#` },
    };
  }

  async function incomingIds(followeeId: string, status: StoredFollowStatus): Promise<string[]> {
    const pages = await queryAll(incomingQuery(followeeId, status));
    return pages.flatMap((page) => (page.Items ?? []).map((item) => String(item.followerId)));
  }

  async function approve(followeeId: string, followerId: string): Promise<void> {
    try {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: keyOf(followerId, followeeId),
          // status は DynamoDB の予約語なので名前を置き換えて書く
          UpdateExpression: 'SET #status = :accepted, #gsi1sk = :acceptedKey',
          ConditionExpression: '#status = :pending',
          ExpressionAttributeNames: { '#status': 'status', '#gsi1sk': 'gsi1sk' },
          ExpressionAttributeValues: {
            ':accepted': 'accepted',
            ':pending': 'pending',
            ':acceptedKey': statusKey('accepted', followerId),
          },
        }),
      );
    } catch (error) {
      // 項目が無い場合も、#status = :pending が成り立たないので同じ例外になる
      if (isConditionalCheckFailed(error)) throw new FollowRequestNotFoundError();
      throw error;
    }
  }

  return {
    kind: 'dynamodb',

    async getStatus(followerId, followeeId): Promise<FollowStatus> {
      const output = (await client.send(
        new GetCommand({ TableName: tableName, Key: keyOf(followerId, followeeId), ConsistentRead: true }),
      )) as GetCommandOutput;
      return output.Item?.status === 'pending' ? 'pending' : output.Item ? 'accepted' : 'none';
    },

    async create(followerId, followeeId, status) {
      try {
        await client.send(
          new PutCommand({
            TableName: tableName,
            Item: {
              ...keyOf(followerId, followeeId),
              gsi1pk: userKey(followeeId),
              gsi1sk: statusKey(status, followerId),
              followerId,
              followeeId,
              status,
              createdAt: new Date().toISOString(),
            },
            ConditionExpression: 'attribute_not_exists(pk)',
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) throw new FollowAlreadyExistsError();
        throw error;
      }
    },

    async remove(followerId, followeeId) {
      const output = (await client.send(
        new DeleteCommand({ TableName: tableName, Key: keyOf(followerId, followeeId), ReturnValues: 'ALL_OLD' }),
      )) as DeleteCommandOutput;
      return output.Attributes !== undefined;
    },

    approve,

    async reject(followeeId, followerId) {
      try {
        await client.send(
          new DeleteCommand({
            TableName: tableName,
            Key: keyOf(followerId, followeeId),
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':pending': 'pending' },
          }),
        );
      } catch (error) {
        if (isConditionalCheckFailed(error)) throw new FollowRequestNotFoundError();
        throw error;
      }
    },

    async approveAllPending(followeeId) {
      let approved = 0;
      for (const followerId of await incomingIds(followeeId, 'pending')) {
        try {
          await approve(followeeId, followerId);
          approved += 1;
        } catch (error) {
          // 一覧を引いてから承認するまでの間に取り消されたものは数えずに進む
          if (!(error instanceof FollowRequestNotFoundError)) throw error;
        }
      }
      return approved;
    },

    async listFollowingIds(followerId) {
      const pages = await queryAll({
        TableName: tableName,
        KeyConditionExpression: '#pk = :follower',
        FilterExpression: '#status = :accepted',
        ExpressionAttributeNames: { '#pk': 'pk', '#status': 'status' },
        ExpressionAttributeValues: { ':follower': userKey(followerId), ':accepted': 'accepted' },
      });
      return pages.flatMap((page) => (page.Items ?? []).map((item) => String(item.followeeId)));
    },

    listFollowerIds: (followeeId) => incomingIds(followeeId, 'accepted'),

    listPendingRequesterIds: (followeeId) => incomingIds(followeeId, 'pending'),

    async countFollowers(followeeId) {
      // 件数だけなら項目を受け取らない（Select: COUNT）
      const pages = await queryAll({ ...incomingQuery(followeeId, 'accepted'), Select: 'COUNT' });
      return pages.reduce((total, page) => total + (page.Count ?? 0), 0);
    },
  };
}
