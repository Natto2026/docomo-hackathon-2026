/**
 * 発行したコマンドの種類を記録する包み。ハッカソン後に足したもの。
 *
 * 「Scan を使っていない」を主張ではなく記録で確かめるために使う。
 * テスト（偽物のクライアント）と確認用スクリプト（実 AWS）の両方で同じものを通す。
 */

import { DynamoSender, FollowCommand } from './dynamoFollowStore';

export type CommandRecorder = {
  client: DynamoSender;
  /** 発行した順のコマンド名（GetCommand、QueryCommand など） */
  readonly sent: string[];
  /** コマンド名ごとの件数 */
  counts(): Record<string, number>;
  clear(): void;
};

export function recordCommands(inner: DynamoSender): CommandRecorder {
  const sent: string[] = [];
  return {
    sent,
    client: {
      send(command: FollowCommand) {
        sent.push(command.constructor.name);
        return inner.send(command);
      },
    },
    counts() {
      const result: Record<string, number> = {};
      for (const name of sent) result[name] = (result[name] ?? 0) + 1;
      return result;
    },
    clear() {
      sent.length = 0;
    },
  };
}
