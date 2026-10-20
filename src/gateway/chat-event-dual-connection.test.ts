import { beforeEach, describe, expect, it } from "vitest";
import { broadcastChatEvent, collectChatEventRecipientConnIds } from "./chat-event-isolation.js";
import {
  resetGroupChatAclCacheForTests,
  seedGroupChatAclForTests,
} from "./chat-group-acl-cache.js";
import {
  noteChatRunTenant,
  noteChatSessionInterest,
  resetChatSessionInterestForTests,
} from "./chat-session-interest.js";

/**
 * Frame-level dual-connection / cross-tenant acceptance for P0 matrix
 * (daibai-conversation-isolation-conditional-approval-2026-08-12.md §4).
 *
 * Tests assert final broadcastToConnIds recipients — not proxy group checks
 * for steward claims.
 */
describe("chat event dual-connection matrix", () => {
  beforeEach(() => {
    resetChatSessionInterestForTests();
    resetGroupChatAclCacheForTests();
  });

  it("does not deliver alice steward finals to bob's connections", () => {
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
    noteChatRunTenant("run-a", "tenant-a");
    const aliceTab1 = {
      connId: "alice-1",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const aliceTab2 = {
      connId: "alice-2",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const bobTab = {
      connId: "bob-1",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const payload = {
      runId: "run-a",
      sessionKey: "agent:main:employee:alice",
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "secret-for-alice" }] },
    };
    const delivered = new Map<string, unknown>();
    broadcastChatEvent({
      sessionKey: "agent:main:employee:alice",
      payload,
      clients: [aliceTab1, aliceTab2, bobTab],
      broadcastToConnIds: (_event, body, connIds) => {
        for (const id of connIds) {
          delivered.set(id, body);
        }
      },
    });
    expect(delivered.has("alice-1")).toBe(true);
    expect(delivered.has("alice-2")).toBe(true);
    expect(delivered.has("bob-1")).toBe(false);
    expect(JSON.stringify(delivered.get("alice-1"))).toContain("secret-for-alice");
  });

  it("keeps delta/error/abort bodies off foreign connections", () => {
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
    const alice = {
      connId: "alice-1",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const bob = {
      connId: "bob-1",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    for (const state of ["delta", "error", "aborted"] as const) {
      const delivered: string[] = [];
      broadcastChatEvent({
        sessionKey: "agent:main:employee:alice",
        payload: { runId: `run-${state}`, state, message: { text: `${state}-secret` } },
        clients: [alice, bob],
        opts: { tenantId: "tenant-a" },
        broadcastToConnIds: (_e, _p, ids) => {
          delivered.push(...ids);
        },
      });
      expect(delivered, state).toEqual(["alice-1"]);
    }
  });

  it("does not deliver steward events across tenants for the same userId", () => {
    // Negative test: same platformUserId, different sessionEnterpriseId.
    // Must assert steward sessionKey recipients — not a space:/group proxy.
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
    noteChatRunTenant("run-steward-a", "tenant-a");
    const aliceTenantA = {
      connId: "a-ta",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const aliceTenantB = {
      connId: "a-tb",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-b",
    };
    const delivered: string[] = [];
    broadcastChatEvent({
      sessionKey: "agent:main:employee:alice",
      payload: {
        runId: "run-steward-a",
        state: "final",
        message: { text: "tenant-a-only-secret" },
      },
      clients: [aliceTenantA, aliceTenantB],
      broadcastToConnIds: (_e, _p, ids) => {
        delivered.push(...ids);
      },
    });
    expect(delivered).toEqual(["a-ta"]);
    expect(
      collectChatEventRecipientConnIds(
        [aliceTenantA, aliceTenantB],
        "agent:main:employee:alice",
        "tenant-a",
      ),
    ).toEqual(new Set(["a-ta"]));
  });

  it("does not deliver group events across tenants for the same groupId", () => {
    // Both tenants have groupId "shared-gid" with different member sets.
    seedGroupChatAclForTests({
      groupId: "shared-gid",
      tenantId: "tenant-a",
      memberUserIds: new Set(["alice"]),
    });
    seedGroupChatAclForTests({
      groupId: "shared-gid",
      tenantId: "tenant-b",
      memberUserIds: new Set(["alice", "bob"]),
    });
    const aliceA = {
      connId: "a-ta",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const aliceB = {
      connId: "a-tb",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-b",
    };
    const bobB = {
      connId: "b-tb",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-b",
    };
    const deliveredA: string[] = [];
    broadcastChatEvent({
      sessionKey: "space:shared-gid",
      payload: { runId: "run-g-a", state: "final", message: { text: "from-tenant-a" } },
      clients: [aliceA, aliceB, bobB],
      opts: { tenantId: "tenant-a" },
      broadcastToConnIds: (_e, _p, ids) => {
        deliveredA.push(...ids);
      },
    });
    expect(deliveredA).toEqual(["a-ta"]);

    const deliveredB: string[] = [];
    broadcastChatEvent({
      sessionKey: "space:shared-gid",
      payload: { runId: "run-g-b", state: "final", message: { text: "from-tenant-b" } },
      clients: [aliceA, aliceB, bobB],
      opts: { tenantId: "tenant-b" },
      broadcastToConnIds: (_e, _p, ids) => {
        deliveredB.push(...ids);
      },
    });
    expect(new Set(deliveredB)).toEqual(new Set(["a-tb", "b-tb"]));
  });

  it("stops delivering after group membership is removed from cache", () => {
    seedGroupChatAclForTests({
      groupId: "grp-x",
      tenantId: "tenant-a",
      memberUserIds: new Set(["alice", "bob"]),
    });
    const alice = {
      connId: "c-a",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const bob = {
      connId: "c-b",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    expect(collectChatEventRecipientConnIds([alice, bob], "space:grp-x", "tenant-a")).toEqual(
      new Set(["c-a", "c-b"]),
    );
    seedGroupChatAclForTests({
      groupId: "grp-x",
      tenantId: "tenant-a",
      memberUserIds: new Set(["alice"]),
    });
    expect(collectChatEventRecipientConnIds([alice, bob], "space:grp-x", "tenant-a")).toEqual(
      new Set(["c-a"]),
    );
  });

  it("keeps personal-bot events off other employees without interest", () => {
    noteChatSessionInterest("agent:sales:main", "alice", "tenant-a");
    const alice = {
      connId: "c-a",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const bob = {
      connId: "c-b",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const delivered: string[] = [];
    broadcastChatEvent({
      sessionKey: "agent:sales:main",
      payload: { state: "delta", message: { text: "sales-secret" } },
      clients: [alice, bob],
      opts: { tenantId: "tenant-a" },
      broadcastToConnIds: (_e, _p, ids) => {
        delivered.push(...ids);
      },
    });
    expect(delivered).toEqual(["c-a"]);
  });
});
