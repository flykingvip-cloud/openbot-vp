// @vitest-environment node
// Feature: cost-budget-billing
// Property 5: Append-only 追溯性不变量

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  appendLedgerRecord,
  assertAppendOnly,
  LedgerImmutabilityError,
} from "./append-only-ledger.ts";

type Rec = { id: string; value: number };

const recordArb = fc.record({
  id: fc.string({ minLength: 1, maxLength: 8 }),
  value: fc.integer(),
});

// 生成 id 互不相同的记录集合
const uniqueCollectionArb = fc.array(recordArb, { maxLength: 30 }).map((records) => {
  const seen = new Set<string>();
  return records.filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)));
});

describe("Property 5: append-only ledger invariants", () => {
  it("追加后长度恰好 +1，且既有记录字段不变", () => {
    fc.assert(
      fc.property(uniqueCollectionArb, recordArb, (collection, incoming) => {
        // 仅在 id 不冲突时验证成功追加路径
        fc.pre(!collection.some((r) => r.id === incoming.id));
        const next = appendLedgerRecord(collection, incoming);
        expect(next.length).toBe(collection.length + 1);
        // 既有记录原样保留
        for (let i = 0; i < collection.length; i += 1) {
          expect(next[i]).toEqual(collection[i]);
        }
        // 新记录追加在末尾
        expect(next[next.length - 1]).toEqual(incoming);
      }),
      { numRuns: 200 },
    );
  });

  it("入参集合不被修改（无副作用）", () => {
    fc.assert(
      fc.property(uniqueCollectionArb, recordArb, (collection, incoming) => {
        fc.pre(!collection.some((r) => r.id === incoming.id));
        const snapshot = structuredClone(collection);
        appendLedgerRecord(collection, incoming);
        expect(collection).toEqual(snapshot);
      }),
      { numRuns: 200 },
    );
  });

  it("重复 id 写入被拒绝（不可覆盖既有记录）", () => {
    fc.assert(
      fc.property(
        uniqueCollectionArb.filter((c) => c.length > 0),
        fc.integer(),
        (collection, newValue) => {
          const target = collection[0];
          const duplicate: Rec = { id: target.id, value: newValue };
          expect(() => appendLedgerRecord(collection, duplicate)).toThrow(LedgerImmutabilityError);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("assertAppendOnly: 仅追加的演进合法；删除或修改既有记录被拒", () => {
    fc.assert(
      fc.property(uniqueCollectionArb, recordArb, (collection, incoming) => {
        fc.pre(!collection.some((r) => r.id === incoming.id));
        // 合法：纯追加
        expect(() => assertAppendOnly(collection, [...collection, incoming])).not.toThrow();
        // 非法：删除既有记录
        if (collection.length > 0) {
          expect(() => assertAppendOnly(collection, collection.slice(1))).toThrow(
            LedgerImmutabilityError,
          );
          // 非法：修改既有记录字段
          const mutated = collection.map((r, i) => (i === 0 ? { ...r, value: r.value + 1 } : r));
          expect(() => assertAppendOnly(collection, mutated)).toThrow(LedgerImmutabilityError);
        }
      }),
      { numRuns: 200 },
    );
  });
});
