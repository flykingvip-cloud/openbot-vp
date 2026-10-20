import { describe, expect, it } from "vitest";
import type { DataPlaneCase } from "./diagnose-data-plane-cases.js";
import type { DiagnoseConversationAction } from "./diagnose-next-actions.js";
import { createMemoryInterventionCaseStore } from "./intervention-case-store.js";
import {
  expandGroupInterventionCase,
  materializeInterventionCases,
  materializeInterventionCasesFromDataPlane,
} from "./intervention-from-next-actions.js";

const identityAction: DiagnoseConversationAction = {
  actionId: "act:identity:bot-ceo",
  title: "补身份字段",
  actor: "owner",
  actorLabel: "主人（大白代为收集）",
  reason: "未确认：IDENTITY.name",
  prompt: "请向主人收集",
  agentPrompt: "请向主人收集未确认字段",
  handoffChannel: "steward",
  targetAgentId: "bot-ceo",
  targetSessionKey: null,
};

const memoryAction: DiagnoseConversationAction = {
  actionId: "act:memory:bot-ceo",
  title: "补当日记忆",
  actor: "diagnosed_agent",
  actorLabel: "被诊断数字人（CEO）",
  reason: "本窗有活动但记忆未落盘",
  prompt: "请让写入 memory",
  agentPrompt: "请把今日要点写入 memory/",
  handoffChannel: "diagnosed_agent_session",
  targetAgentId: "bot-ceo",
  targetSessionKey: "agent:bot-ceo:main",
};

describe("materializeInterventionCases", () => {
  it("queues agent 1:1 cases for 补身份 / 补记忆", () => {
    const store = createMemoryInterventionCaseStore();
    const rows = materializeInterventionCases([identityAction, memoryAction], {
      tenantId: "tenant-a",
      store,
    });
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      title: "补身份字段",
      actionKind: "identity",
      status: "queued",
      target: { kind: "agent_1to1", sessionKey: "agent:bot-ceo:main" },
    });
    expect(rows[1]).toMatchObject({
      title: "补当日记忆",
      actionKind: "memory",
      status: "queued",
      actor: "diagnosed_agent",
    });
    expect(store.list({ tenantId: "tenant-a" })).toHaveLength(2);
  });

  it("marks group targets expanding (parent never gets a space sessionKey)", () => {
    const rows = materializeInterventionCases([memoryAction], {
      tenantId: "tenant-a",
      growthGroupId: "grp-daniel-hhd-gmail-com-upbeyond",
    });
    expect(rows[0]?.status).toBe("expanding");
    expect(rows[0]?.target).toEqual({
      kind: "group_parent",
      agentId: "bot-ceo",
      sessionKey: null,
    });
  });
});

describe("dataPlaneCases → InterventionCase", () => {
  it("maps locator_failed to status=suggested without renaming fields", () => {
    const dp: DataPlaneCase = {
      schemaVersion: 1,
      caseKind: "locator_failed",
      status: "suggested",
      tenantId: "tenant-a",
      findingCode: "locator_failed",
      source: {
        growthAgentId: null,
        growthGroupId: "grp-daniel-hhd-gmail-com-upbeyond",
        reportRef: "cdr:sample",
      },
      target: { kind: "group_parent", agentId: null, sessionKey: null },
      locatorFailureCode: "workspace_unreadable",
      createdAt: "2026-10-14T12:00:00.000Z",
    };
    const rows = materializeInterventionCasesFromDataPlane([dp], { tenantId: "tenant-a" });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("suggested");
    expect(rows[0]?.source.dataPlaneCaseKind).toBe("locator_failed");
    expect(rows[0]?.source.findingCode).toBe("locator_failed");
    expect(rows[0]?.target.kind).toBe("group_parent");
    expect(rows[0]?.target.sessionKey).toBeNull();
  });
});

describe("expandGroupInterventionCase", () => {
  it("creates member_1to1 children via Track D expand rows; parent stays aggregate queued", async () => {
    const store = createMemoryInterventionCaseStore();
    const [parent] = materializeInterventionCases([memoryAction], {
      tenantId: "tenant-a",
      growthGroupId: "grp-1",
      store,
    });
    const result = await expandGroupInterventionCase({
      parent: parent,
      store,
      expandResult: {
        groupId: "grp-1",
        members: [
          {
            userId: "u1",
            memberKind: "bot",
            agentId: "bot-a",
            agentAssetId: "asset-a",
            sessionKey1to1: "agent:bot-a:main",
            sessionKeyExists: true,
          },
          {
            userId: "u2",
            memberKind: "bot",
            agentId: "bot-b",
            agentAssetId: "asset-b",
            sessionKey1to1: "agent:bot-b:main",
            sessionKeyExists: true,
          },
        ],
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.parent.status).toBe("queued");
    expect(result.parent.children).toHaveLength(2);
    expect(result.children.every((c) => c.target.kind === "member_1to1")).toBe(true);
    expect(result.children.every((c) => !c.target.sessionKey?.includes(":space:"))).toBe(true);
  });

  it("blocks when expand yields no members", async () => {
    const store = createMemoryInterventionCaseStore();
    const [parent] = materializeInterventionCases([memoryAction], {
      tenantId: "tenant-a",
      growthGroupId: "grp-empty",
      store,
    });
    const result = await expandGroupInterventionCase({
      parent: parent,
      store,
      expandResult: { groupId: "grp-empty", members: [], emptyReason: "无成员绑定" },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.parent.status).toBe("blocked");
    expect(result.parent.blockReason).toBe("expand_failed");
  });
});
