/**
 * DocumentClient の代わりに渡す、インメモリの偽物。ハッカソン後に足したもの。
 *
 * 目的は、実 AWS を使わずに「条件つき書き込みが成り立つか・失敗するか」まで再現すること。
 * 応答を固定で返すだけのモックだと、条件式を書き間違えていてもテストが通ってしまう。
 * そこで式を実際に解釈し、項目の状態に照らして成否を決める。
 *
 * 実物に寄せてあるところ
 *   - ConditionExpression が成り立たなければ、SDK の ConditionalCheckFailedException を投げる
 *   - 項目が無いときの `#status = :pending` は成り立たない（実物と同じ）
 *   - 予約語（status など）を式にそのまま書くとエラー。使っていない名前・値の指定もエラー
 *   - Query はキーの条件で絞ってから FilterExpression をかける。ページ分割（LastEvaluatedKey）も返せる
 *   - GSI への Query は、射影した属性だけを返す
 *   - 知らないコマンド（Scan を含む）は受け付けない
 *
 * 寄せていないところ
 *   - GSI の結果整合性（書いた直後から読める）。料金、スロットリング、項目サイズの上限
 *   - 式の文法は、dynamoFollowStore が使う範囲だけ。知らない書き方は黙って通さずエラーにする
 *
 * 実物との差は、確認用スクリプト（npm run smoke:aws）を実 AWS に流して確かめる。
 */

import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';

import type { DynamoSender, FollowCommand } from '../../src/improvements/follows/dynamoFollowStore';

type Item = Record<string, unknown>;
type KeySchema = { pk: string; sk: string };

export type FakeTableDefinition = {
  tableName: string;
  key: KeySchema;
  /** GSI。projection は INCLUDE で足す属性（キーは常に入る） */
  indexes: Record<string, KeySchema & { projection: string[] }>;
};

/** infra/follow-table.yaml と同じ形。 */
export const FOLLOW_TABLE: FakeTableDefinition = {
  tableName: 'fake-follow-table',
  key: { pk: 'pk', sk: 'sk' },
  indexes: { gsi1: { pk: 'gsi1pk', sk: 'gsi1sk', projection: ['followerId'] } },
};

/** 式にそのまま書けない語（実物の予約語のうち、このコードに関係するもの）。 */
const RESERVED = new Set(['status', 'name', 'count', 'key', 'items', 'user', 'users']);

class ValidationError extends Error {
  readonly name = 'ValidationException';
}

// ---- 式の解釈 -------------------------------------------------------------

type Condition =
  | { type: 'and'; terms: Condition[] }
  | { type: 'exists'; path: string; expected: boolean }
  | { type: 'beginsWith'; path: string; value: unknown }
  | { type: 'equals'; path: string; value: unknown };

const TOKEN = /\s*(attribute_not_exists|attribute_exists|begins_with|AND\b|SET\b|[#:]?[A-Za-z_][A-Za-z0-9_]*|[(),=])/y;

function tokenize(expression: string): string[] {
  const tokens: string[] = [];
  TOKEN.lastIndex = 0;
  while (TOKEN.lastIndex < expression.length) {
    const position = TOKEN.lastIndex;
    const match = TOKEN.exec(expression);
    if (!match) {
      if (expression.slice(position).trim() === '') break;
      throw new ValidationError(`偽物が解釈できない式です: ${expression}`);
    }
    tokens.push(match[1]);
  }
  return tokens;
}

/** 1コマンド分の式を解釈する。名前と値の使い残しも、実物と同じくエラーにする。 */
class Expressions {
  private readonly usedNames = new Set<string>();
  private readonly usedValues = new Set<string>();

  constructor(
    private readonly names: Record<string, string> = {},
    private readonly values: Record<string, unknown> = {},
  ) {}

  private path(token: string): string {
    if (token.startsWith('#')) {
      if (!(token in this.names)) throw new ValidationError(`ExpressionAttributeNames に ${token} がありません`);
      this.usedNames.add(token);
      return this.names[token];
    }
    if (RESERVED.has(token.toLowerCase())) throw new ValidationError(`予約語は式にそのまま書けません: ${token}`);
    return token;
  }

  private value(token: string): unknown {
    if (!token?.startsWith(':') || !(token in this.values)) {
      throw new ValidationError(`ExpressionAttributeValues に ${token} がありません`);
    }
    this.usedValues.add(token);
    return this.values[token];
  }

  condition(expression: string): Condition {
    const tokens = tokenize(expression);
    let index = 0;
    const next = () => tokens[index++];
    const expect = (token: string) => {
      if (next() !== token) throw new ValidationError(`偽物が解釈できない式です: ${expression}`);
    };

    const term = (): Condition => {
      const head = next();
      if (head === 'attribute_not_exists' || head === 'attribute_exists') {
        expect('(');
        const path = this.path(next());
        expect(')');
        return { type: 'exists', path, expected: head === 'attribute_exists' };
      }
      if (head === 'begins_with') {
        expect('(');
        const path = this.path(next());
        expect(',');
        const value = this.value(next());
        expect(')');
        return { type: 'beginsWith', path, value };
      }
      const path = this.path(head);
      expect('=');
      return { type: 'equals', path, value: this.value(next()) };
    };

    const terms = [term()];
    while (index < tokens.length) {
      expect('AND');
      terms.push(term());
    }
    return terms.length === 1 ? terms[0] : { type: 'and', terms };
  }

  /** `SET a = :x, b = :y` だけを扱う。 */
  assignments(expression: string): Array<{ path: string; value: unknown }> {
    const tokens = tokenize(expression);
    if (tokens[0] !== 'SET') throw new ValidationError(`偽物は SET だけを扱います: ${expression}`);
    const result: Array<{ path: string; value: unknown }> = [];
    for (let index = 1; index < tokens.length; index += 4) {
      if (tokens[index + 1] !== '=' || (tokens[index + 3] !== undefined && tokens[index + 3] !== ',')) {
        throw new ValidationError(`偽物が解釈できない式です: ${expression}`);
      }
      result.push({ path: this.path(tokens[index]), value: this.value(tokens[index + 2]) });
    }
    return result;
  }

  assertAllUsed(): void {
    const unusedNames = Object.keys(this.names).filter((name) => !this.usedNames.has(name));
    const unusedValues = Object.keys(this.values).filter((name) => !this.usedValues.has(name));
    if (unusedNames.length > 0 || unusedValues.length > 0) {
      throw new ValidationError(`式で使っていない指定があります: ${[...unusedNames, ...unusedValues].join(', ')}`);
    }
  }
}

function holds(condition: Condition, item: Item | undefined): boolean {
  switch (condition.type) {
    case 'and':
      return condition.terms.every((term) => holds(term, item));
    case 'exists':
      return (item !== undefined && item[condition.path] !== undefined) === condition.expected;
    case 'beginsWith':
      return typeof item?.[condition.path] === 'string' &&
        (item[condition.path] as string).startsWith(String(condition.value));
    case 'equals':
      return item !== undefined && item[condition.path] === condition.value;
  }
}

// ---- 偽物の本体 -----------------------------------------------------------

export type FakeDynamo = DynamoSender & {
  /** 受け取ったコマンド名（拒否したものも含む） */
  readonly received: string[];
  /** 保存されている項目の写し */
  items(): Item[];
  /** Query の1ページあたりの件数。小さくするとページ分割を再現できる */
  pageSize: number;
};

export function createFakeDynamo(definition: FakeTableDefinition = FOLLOW_TABLE): FakeDynamo {
  const table = new Map<string, Item>();
  const received: string[] = [];
  const { key } = definition;

  const idOf = (source: Item) => {
    const pk = source[key.pk];
    const sk = source[key.sk];
    if (typeof pk !== 'string' || typeof sk !== 'string' || pk === '' || sk === '') {
      throw new ValidationError('キー（pk と sk）が正しく指定されていません');
    }
    return `${pk} ${sk}`;
  };

  const checkTable = (tableName: string | undefined) => {
    if (tableName !== definition.tableName) {
      const error = new Error(`テーブルがありません: ${tableName}`);
      error.name = 'ResourceNotFoundException';
      throw error;
    }
  };

  const conditionFailed = () =>
    new ConditionalCheckFailedException({ message: 'The conditional request failed', $metadata: {} });

  function query(input: QueryCommand['input']) {
    const expressions = new Expressions(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
    const index = input.IndexName === undefined ? undefined : definition.indexes[input.IndexName];
    if (input.IndexName !== undefined && !index) throw new ValidationError(`インデックスがありません: ${input.IndexName}`);
    const schema = index ?? key;

    const keyCondition = expressions.condition(input.KeyConditionExpression ?? '');
    const keyTerms = keyCondition.type === 'and' ? keyCondition.terms : [keyCondition];
    const partition = keyTerms[0];
    if (partition.type !== 'equals' || partition.path !== schema.pk) {
      throw new ValidationError('Query にはパーティションキーの一致条件が必要です');
    }
    if (keyTerms.slice(1).some((term) => term.type === 'and' || term.path !== schema.sk)) {
      throw new ValidationError('キーの条件に書けるのはパーティションキーとソートキーだけです');
    }
    const filter = input.FilterExpression ? expressions.condition(input.FilterExpression) : undefined;
    expressions.assertAllUsed();

    const matched = [...table.values()]
      // GSI には、そのキーの属性を両方持つ項目だけが入る
      .filter((item) => item[schema.pk] !== undefined && item[schema.sk] !== undefined)
      .filter((item) => holds(keyCondition, item))
      .sort((a, b) => (String(a[schema.sk]) < String(b[schema.sk]) ? -1 : 1));

    const startId = input.ExclusiveStartKey ? idOf(input.ExclusiveStartKey) : undefined;
    const startAt = startId === undefined ? 0 : matched.findIndex((item) => idOf(item) === startId) + 1;
    // 実物と同じく、ページの上限はフィルタをかける前の件数に効く
    const page = matched.slice(startAt, startAt + fake.pageSize);
    const hasMore = startAt + fake.pageSize < matched.length;
    const last = page[page.length - 1];

    const visible = page.filter((item) => (filter ? holds(filter, item) : true));
    const project = (item: Item): Item => {
      if (!index) return { ...item };
      const attributes = [key.pk, key.sk, index.pk, index.sk, ...index.projection];
      return Object.fromEntries(attributes.filter((name) => item[name] !== undefined).map((name) => [name, item[name]]));
    };

    return {
      Count: visible.length,
      ScannedCount: page.length,
      Items: input.Select === 'COUNT' ? undefined : visible.map(project),
      LastEvaluatedKey: hasMore && last
        ? Object.fromEntries([key.pk, key.sk, schema.pk, schema.sk].map((name) => [name, last[name]]))
        : undefined,
      $metadata: {},
    };
  }

  const fake: FakeDynamo = {
    received,
    pageSize: 100,
    items: () => [...table.values()].map((item) => ({ ...item })),

    async send(command: FollowCommand): Promise<unknown> {
      received.push(command.constructor.name);

      if (command instanceof GetCommand) {
        checkTable(command.input.TableName);
        const item = table.get(idOf(command.input.Key ?? {}));
        return { Item: item ? { ...item } : undefined, $metadata: {} };
      }

      if (command instanceof PutCommand) {
        const { input } = command;
        checkTable(input.TableName);
        const expressions = new Expressions(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const condition = input.ConditionExpression ? expressions.condition(input.ConditionExpression) : undefined;
        expressions.assertAllUsed();
        const id = idOf(input.Item ?? {});
        if (condition && !holds(condition, table.get(id))) throw conditionFailed();
        table.set(id, { ...input.Item });
        return { $metadata: {} };
      }

      if (command instanceof UpdateCommand) {
        const { input } = command;
        checkTable(input.TableName);
        const expressions = new Expressions(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const assignments = expressions.assignments(input.UpdateExpression ?? '');
        const condition = input.ConditionExpression ? expressions.condition(input.ConditionExpression) : undefined;
        expressions.assertAllUsed();
        if (assignments.some(({ path }) => path === key.pk || path === key.sk)) {
          throw new ValidationError('テーブルのキーは更新できません');
        }
        const id = idOf(input.Key ?? {});
        const current = table.get(id);
        if (condition && !holds(condition, current)) throw conditionFailed();
        // 実物の UpdateItem は、項目が無ければ作る。条件で止めていなければここで作られてしまう
        const updated: Item = { ...(current ?? input.Key) };
        for (const { path, value } of assignments) updated[path] = value;
        table.set(id, updated);
        return { $metadata: {} };
      }

      if (command instanceof DeleteCommand) {
        const { input } = command;
        checkTable(input.TableName);
        const expressions = new Expressions(input.ExpressionAttributeNames, input.ExpressionAttributeValues);
        const condition = input.ConditionExpression ? expressions.condition(input.ConditionExpression) : undefined;
        expressions.assertAllUsed();
        const id = idOf(input.Key ?? {});
        const current = table.get(id);
        if (condition && !holds(condition, current)) throw conditionFailed();
        table.delete(id);
        return { Attributes: input.ReturnValues === 'ALL_OLD' && current ? { ...current } : undefined, $metadata: {} };
      }

      if (command instanceof QueryCommand) {
        checkTable(command.input.TableName);
        return query(command.input);
      }

      throw new ValidationError(`偽物が受け付けないコマンドです: ${(command as { constructor: { name: string } }).constructor.name}`);
    },
  };

  return fake;
}
