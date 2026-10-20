import { describe, expect, it } from "vitest";
import {
  createEmptyAgentRegistryStore,
  type AgentRegistryStore,
} from "../gateway/agent-registry/types.js";
import {
  assertNoSpaceSessionKeys,
  expandDiagnoseGroupMembers,
  type ExpandMemberSource,
} from "./diagnose-group-member-expand.js";

const TENANT = "tenant-a";
const GROUP = "grp-daniel-hhd";
const ASSET = "asset-11111111-1111-4111-8111-111111111111";

function registry(): AgentRegistryStore {
  const store = createEmptyAgentRegistryStore();
  store.assets[ASSET] = {
    agentAssetId: ASSET,
    enterpriseId: TENANT,
    agentSlug: "bot-2",
    displayName: "销售助手",
    status: "active",
    legacyAgentId: "bot-2",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
  store.ownerBindings["own-1"] = {
    bindingId: "own-1",
    enterpriseId: TENANT,
    agentAssetId: ASSET,
    ownerType: "membership",
    ownerId: "employee-9",
    isPrimary: true,
    effectiveAt: "2026-09-19T00:00:00.000Z",
  };
  store.assets["asset-bot-x"] = {
    agentAssetId: "asset-bot-x",
    enterpriseId: TENANT,
    agentSlug: "bot-x",
    displayName: "组内机器人",
    status: "active",
    legacyAgentId: "bot-x",
    createdAt: "2026-09-19T00:00:00.000Z",
    updatedAt: "2026-09-19T00:00:00.000Z",
  };
  return store;
}

describe("expandDiagnoseGroupMembers", () => {
  it("two_humans expands rows with 1:1 session keys", async () => {
    const members: ExpandMemberSource[] = [
      { memberKind: "human", userId: "employee-9", status: "active" },
      { memberKind: "human", userId: "employee-other", status: "active" },
    ];
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: async () => members,
      registry: registry(),
      sessionKeyExists: (agentId, key) => agentId === "bot-2" && key === "agent:bot-2:main",
    });
    expect(result.members).toHaveLength(2);
    expect(result.emptyReason).toBeUndefined();
    const owner = result.members.find((row) => row.userId === "employee-9");
    expect(owner?.agentId).toBe("bot-2");
    expect(owner?.agentAssetId).toBe(ASSET);
    expect(owner?.sessionKey1to1).toBe("agent:bot-2:main");
    expect(owner?.sessionKeyExists).toBe(true);
    expect(assertNoSpaceSessionKeys(result)).toBe(true);
  });

  it("empty_members sets 无成员绑定", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: async () => [],
      registry: registry(),
    });
    expect(result.members).toEqual([]);
    expect(result.emptyReason).toBe("无成员绑定");
  });

  it("bots_listed keeps bot memberKind and 1:1 session form", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: async () => [{ memberKind: "bot", agentId: "bot-x", status: "active" }],
      registry: registry(),
    });
    expect(result.members).toHaveLength(1);
    expect(result.members[0]?.memberKind).toBe("bot");
    expect(result.members[0]?.sessionKey1to1).toBe("agent:bot-x:main");
    expect(result.members[0]?.sessionKey1to1).not.toContain(":space:");
  });

  it("no_space_session — sessionKey1to1 never contains :space:", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: async () => [
        { memberKind: "human", userId: "employee-9", status: "active" },
        { memberKind: "bot", agentId: "bot-x", status: "active" },
      ],
      registry: registry(),
    });
    for (const row of result.members) {
      expect(row.sessionKey1to1 ?? "").not.toContain(":space:");
    }
  });

  it("unreadable members → members_unreadable", async () => {
    const result = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: GROUP,
      loadMembers: async () => null,
      registry: registry(),
    });
    expect(result.emptyReason).toBe("members_unreadable");
    expect(result.members).toEqual([]);
  });
});
