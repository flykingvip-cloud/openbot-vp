import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  broadcastChatEvent,
  collectChatEventRecipientConnIds,
  extractGroupIdFromChatSessionKey,
  isCollaborationSpaceChildSessionKey,
  resolveClientStewardOwnerId,
  shouldDeliverChatEventToClient,
} from "./chat-event-isolation.js";
import {
  refreshGroupChatAclCache,
  resetGroupChatAclCacheForTests,
  seedGroupChatAclForTests,
  upsertAuthorizedGroupChatAclMember,
} from "./chat-group-acl-cache.js";
import {
  noteChatRunTenant,
  noteChatSessionInterest,
  resetChatSessionInterestForTests,
} from "./chat-session-interest.js";

describe("chat-event-isolation", () => {
  beforeEach(() => {
    resetChatSessionInterestForTests();
    resetGroupChatAclCacheForTests();
  });

  it("resolves platformUserId ahead of raw user email", () => {
    expect(
      resolveClientStewardOwnerId({
        platformUserId: "User-Alice",
        user: "alice@example.com",
      }),
    ).toBe("user-alice");
  });

  it("delivers employee steward chat only to the matching owner in the resource tenant", () => {
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
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
    const key = "agent:main:employee:alice";
    expect(shouldDeliverChatEventToClient(alice, key, "tenant-a")).toBe(true);
    expect(shouldDeliverChatEventToClient(bob, key, "tenant-a")).toBe(false);
    expect(collectChatEventRecipientConnIds([alice, bob], key, "tenant-a")).toEqual(
      new Set(["c-a"]),
    );
  });

  it("delivers the same user's steward events to all of their same-tenant connections", () => {
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
    const tab1 = {
      connId: "c-a1",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const tab2 = {
      connId: "c-a2",
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
    expect(
      collectChatEventRecipientConnIds([tab1, tab2, bob], "agent:main:employee:alice", "tenant-a"),
    ).toEqual(new Set(["c-a1", "c-a2"]));
  });

  it("denies employee shells without platformUserId for steward sessions", () => {
    expect(
      shouldDeliverChatEventToClient(
        { connId: "c1", sessionDomain: "employee", sessionEnterpriseId: "tenant-a" },
        "agent:main:employee:alice",
        "tenant-a",
      ),
    ).toBe(false);
  });

  it("denies steward delivery to employee shells when resource tenant is unknown", () => {
    expect(
      shouldDeliverChatEventToClient(
        {
          connId: "c-a",
          platformUserId: "alice",
          sessionDomain: "employee",
          sessionEnterpriseId: "tenant-a",
        },
        "agent:main:employee:alice",
        null,
      ),
    ).toBe(false);
  });

  it("blocks global steward chat from employee shells", () => {
    expect(
      shouldDeliverChatEventToClient(
        { connId: "c1", platformUserId: "alice", sessionDomain: "employee" },
        "agent:main:main",
      ),
    ).toBe(false);
    expect(
      shouldDeliverChatEventToClient({ connId: "c-ops", sessionDomain: "platform" }, "main"),
    ).toBe(true);
  });

  it("never returns null / broadcast-all for personal bot keys", () => {
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
    expect(collectChatEventRecipientConnIds([alice, bob], "agent:sales:main", "tenant-a")).toEqual(
      new Set(),
    );
    noteChatSessionInterest("agent:sales:main", "alice", "tenant-a");
    expect(collectChatEventRecipientConnIds([alice, bob], "agent:sales:main", "tenant-a")).toEqual(
      new Set(["c-a"]),
    );
  });

  it("delivers group chat only to cached members in the resource tenant", () => {
    seedGroupChatAclForTests({
      groupId: "grp-1",
      tenantId: "tenant-a",
      memberUserIds: new Set(["alice"]),
    });
    noteChatSessionInterest("space:grp-1", "alice", "tenant-a");
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
    const aliceOtherTenant = {
      connId: "c-a2",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-b",
    };
    expect(extractGroupIdFromChatSessionKey("space:grp-1")).toBe("grp-1");
    expect(isCollaborationSpaceChildSessionKey("space:grp-1")).toBe(false);
    expect(isCollaborationSpaceChildSessionKey("agent:bot-2:main:space:grp-1")).toBe(true);
    expect(extractGroupIdFromChatSessionKey("agent:bot-2:main:space:grp-1")).toBe("grp-1");
    expect(
      extractGroupIdFromChatSessionKey("agent:bot--agent:main:space:grp-cod7432-gmail-com-测试组"),
    ).toBe("grp-cod7432-gmail-com-测试组");
    expect(
      collectChatEventRecipientConnIds([alice, bob, aliceOtherTenant], "space:grp-1", "tenant-a"),
    ).toEqual(new Set(["c-a"]));
  });

  it("keeps same groupId ACL entries for different tenants without overwrite", () => {
    seedGroupChatAclForTests({
      groupId: "shared-gid",
      tenantId: "tenant-a",
      memberUserIds: new Set(["alice"]),
    });
    seedGroupChatAclForTests({
      groupId: "shared-gid",
      tenantId: "tenant-b",
      memberUserIds: new Set(["bob"]),
    });
    const aliceA = {
      connId: "a-ta",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const bobB = {
      connId: "b-tb",
      platformUserId: "bob",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-b",
    };
    expect(
      collectChatEventRecipientConnIds([aliceA, bobB], "space:shared-gid", "tenant-a"),
    ).toEqual(new Set(["a-ta"]));
    expect(
      collectChatEventRecipientConnIds([aliceA, bobB], "space:shared-gid", "tenant-b"),
    ).toEqual(new Set(["b-tb"]));
  });

  it("inherits parent ChatTurn tenant for :user child runIds", () => {
    noteChatRunTenant("turn-uuid", "tenant-a");
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
    const aliceA = {
      connId: "a-ta",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const delivered: string[] = [];
    const count = broadcastChatEvent({
      sessionKey: "agent:main:employee:alice",
      payload: { runId: "turn-uuid:user", state: "user_echo", message: { role: "user" } },
      clients: [aliceA],
      broadcastToConnIds: (_e, _p, ids) => {
        delivered.push(...ids);
      },
    });
    expect(count).toBe(1);
    expect(delivered).toEqual(["a-ta"]);
  });

  it("delivers group bot-child finals after chat.send seeds the space ACL", () => {
    noteChatRunTenant("turn-group-child", "tenant-a");
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-ops",
      memberUserId: "alice",
    });
    const alice = {
      connId: "c-alice",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    const botKey = "agent:bot-2:main:space:grp-ops";
    expect(extractGroupIdFromChatSessionKey(botKey)).toBe("grp-ops");
    expect(collectChatEventRecipientConnIds([alice], botKey, "tenant-a")).toEqual(
      new Set(["c-alice"]),
    );
    const delivered: string[] = [];
    const count = broadcastChatEvent({
      sessionKey: botKey,
      payload: {
        runId: "turn-group-child:bot-2",
        state: "final",
        message: { role: "assistant", content: [{ type: "text", text: "小组窗口生效" }] },
      },
      clients: [alice],
      broadcastToConnIds: (_e, _p, ids) => {
        delivered.push(...ids);
      },
      opts: { runId: "turn-group-child:bot-2" },
    });
    expect(count).toBe(1);
    expect(delivered).toEqual(["c-alice"]);
  });

  it("delivers group events after chat.send seeds the sender into the ACL cache", () => {
    noteChatRunTenant("turn-group", "tenant-a");
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-ops",
      memberUserId: "alice",
    });
    const alice = {
      connId: "c-alice",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    expect(collectChatEventRecipientConnIds([alice], "space:grp-ops", "tenant-a")).toEqual(
      new Set(["c-alice"]),
    );
  });

  it("still delivers group events after a tenant-less catalog refresh", async () => {
    upsertAuthorizedGroupChatAclMember({
      tenantId: "tenant-a",
      groupId: "grp-cod7432-gmail-com-测试组",
      memberUserId: "alice",
    });
    await refreshGroupChatAclCache({
      force: true,
      listSpaces: (async () => ({
        spaces: [{ groupId: "grp-cod7432-gmail-com-测试组", title: "测试组" }],
      })) as never,
    });
    const alice = {
      connId: "c-alice",
      platformUserId: "alice",
      sessionDomain: "employee" as const,
      sessionEnterpriseId: "tenant-a",
    };
    expect(
      collectChatEventRecipientConnIds([alice], "space:grp-cod7432-gmail-com-测试组", "tenant-a"),
    ).toEqual(new Set(["c-alice"]));
  });

  it("resolves resource tenant from run binding on broadcastChatEvent", () => {
    noteChatRunTenant("run-tenant-a", "tenant-a");
    noteChatSessionInterest("agent:main:employee:alice", "alice", "tenant-a");
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
    const delivered: string[] = [];
    broadcastChatEvent({
      sessionKey: "agent:main:employee:alice",
      payload: { runId: "run-tenant-a", state: "final", message: { text: "secret" } },
      clients: [aliceA, aliceB],
      broadcastToConnIds: (_e, _p, ids) => {
        delivered.push(...ids);
      },
    });
    expect(delivered).toEqual(["a-ta"]);
  });

  it("returns 0 and skips fan-out when no recipients for final", () => {
    const broadcastToConnIds = vi.fn();
    const count = broadcastChatEvent({
      sessionKey: "agent:main:employee:nobody",
      payload: { runId: "run-empty", state: "final", message: { text: "ghost" } },
      clients: [],
      broadcastToConnIds,
    });
    expect(count).toBe(0);
    expect(broadcastToConnIds).not.toHaveBeenCalled();
  });
});
