/**
 * Working DNA 治理 RPC 的注册一致性。
 *
 * 这两个方法曾经「UI 在调、method list 在声明、后端实现不存在」——恢复后必须锁住
 * handler / method list / scope 三处齐备，否则又会退化成半个功能。
 */

import { describe, expect, it, vi } from "vitest";

const WORKING_STYLE_METHODS = [
  "agents.list-working-style-effects",
  "agents.working-style-effectiveness",
] as const;

describe("Working DNA governance RPC registration", () => {
  it("has a handler for every declared method (dispatchable, not orphaned)", async () => {
    const { agentGrowthHandlers } = await import("./agent-growth.js");
    const { listGatewayMethods } = await import("../server-methods-list.js");
    const declared = new Set(listGatewayMethods());
    for (const method of WORKING_STYLE_METHODS) {
      expect(declared.has(method), `${method} missing from the gateway method list`).toBe(true);
      expect(Object.hasOwn(agentGrowthHandlers, method), `${method} has no handler`).toBe(true);
    }
  });

  it("is read-scoped (governance observability, not a mutation)", async () => {
    const { getMethodScopeGroups, READ_SCOPE } = await import("../method-scopes.js");
    const groups = getMethodScopeGroups();
    const scopeOf = (method: string): string => {
      for (const [scope, methods] of Object.entries(groups)) {
        if (methods.includes(method)) {
          return scope;
        }
      }
      return "UNSCOPED";
    };
    for (const method of WORKING_STYLE_METHODS) {
      expect(scopeOf(method)).toBe(READ_SCOPE);
    }
  });

  it("returns an empty effects list when no agent has changed behavior yet", async () => {
    const { agentGrowthHandlers } = await import("./agent-growth.js");
    const respond = vi.fn();
    await agentGrowthHandlers["agents.list-working-style-effects"]({
      req: {} as never,
      params: {},
      respond: respond as never,
      context: {} as never,
      client: null,
      isWebchatConnect: () => false,
    });
    expect(respond).toHaveBeenCalledWith(true, { effects: expect.any(Array) }, undefined);
  });
});
