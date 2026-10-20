// @vitest-environment node
// Feature: cost-budget-billing
// Property 6: 租户隔离

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isScopeAuthorizedForTenant,
  scopeHasPermission,
  USAGE_BUDGET_PERMISSION,
  type BillingScope,
} from "./scope.ts";
import { listUsageRecords, recordUsage } from "./usage-records-store.ts";

let storePath: string;

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-billing-isolation-"));
  storePath = path.join(dir, "usage.json");
});

afterEach(() => {
  try {
    fs.rmSync(path.dirname(storePath), { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function makeScope(enterpriseId: string | null, admin: boolean): BillingScope {
  return {
    enterpriseId,
    user: null,
    membership: null,
    isEnterpriseAdmin: admin,
    permissions: new Set(admin ? [USAGE_BUDGET_PERMISSION] : []),
  };
}

describe("Property 6: 租户隔离", () => {
  it("两租户的用量数据集合无交集；按租户查询只返回自身数据", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 8 }),
        fc.array(fc.string({ minLength: 1, maxLength: 6 }), { maxLength: 8 }),
        async (eventsA, eventsB) => {
          fs.rmSync(storePath, { force: true });
          // 写入两个租户的用量（eventId 各自去重）
          for (const e of eventsA) {
            await recordUsage(
              { enterpriseId: "ent-A", userId: "u", eventId: e, key: "ai_token", quantity: 1 },
              storePath,
            );
          }
          for (const e of eventsB) {
            await recordUsage(
              { enterpriseId: "ent-B", userId: "u", eventId: e, key: "ai_token", quantity: 1 },
              storePath,
            );
          }
          const a = await listUsageRecords("ent-A", {}, storePath);
          const b = await listUsageRecords("ent-B", {}, storePath);
          // A 的结果全部属于 ent-A，B 同理
          expect(a.every((r) => r.enterpriseId === "ent-A")).toBe(true);
          expect(b.every((r) => r.enterpriseId === "ent-B")).toBe(true);
          // 两集合 id 无交集
          const idsA = new Set(a.map((r) => r.id));
          const idsB = new Set(b.map((r) => r.id));
          for (const id of idsA) {
            expect(idsB.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it("isScopeAuthorizedForTenant：仅匹配自身 enterpriseId 时放行", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 8 }),
        fc.string({ minLength: 1, maxLength: 8 }),
        (scopeTenant, targetTenant) => {
          const scope = makeScope(scopeTenant, false);
          const authorized = isScopeAuthorizedForTenant(scope, targetTenant);
          expect(authorized).toBe(scopeTenant === targetTenant);
        },
      ),
      { numRuns: 200 },
    );
  });

  it("无 enterpriseId 的作用域一律拒绝", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 8 }), (target) => {
        expect(isScopeAuthorizedForTenant(makeScope(null, true), target)).toBe(false);
      }),
      { numRuns: 100 },
    );
  });

  it("usage:budget 权限仅企业管理员持有", () => {
    expect(scopeHasPermission(makeScope("ent-A", true), USAGE_BUDGET_PERMISSION)).toBe(true);
    expect(scopeHasPermission(makeScope("ent-A", false), USAGE_BUDGET_PERMISSION)).toBe(false);
  });
});
