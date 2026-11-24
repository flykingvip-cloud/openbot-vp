import { describe, expect, it, vi } from "vitest";
import type { DiagnoseConversationAction } from "./diagnose-next-actions.js";
import { createMemoryInterventionCaseStore } from "./intervention-case-store.js";
import { dispatchInterventionCase } from "./intervention-dispatch.js";
import { materializeInterventionCases } from "./intervention-from-next-actions.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";

const memoryAction: DiagnoseConversationAction = {
  actionId: "act:memory:bot-ceo",
  title: "补当日记忆",
  actor: "diagnosed_agent",
  actorLabel: "被诊断数字人",
  reason: "记忆未落盘",
  prompt: "x",
  agentPrompt: "请写入 memory/",
  handoffChannel: "diagnosed_agent_session",
  targetAgentId: "bot-ceo",
  targetSessionKey: "agent:bot-ceo:main",
};

describe("dispatchInterventionCase", () => {
  it("dispatches member/agent 1:1 and refuses group_parent", async () => {
    const store = createMemoryInterventionCaseStore();
    const [agentCase] = materializeInterventionCases([memoryAction], {
      tenantId: "tenant-a",
      store,
    });
    const send = vi.fn(async () => ({ runId: "run-1" }));
    const injectReceipt = vi.fn(async () => undefined);
    const ok = await dispatchInterventionCase({
      case: agentCase,
      store,
      requesterUserId: "user-1",
      tenantId: "tenant-a",
      tenantAdmin: true,
      agentPrompt: memoryAction.agentPrompt,
      sessionExists: () => true,
      send,
      injectReceipt,
    });
    expect(ok.ok).toBe(true);
    // Path B: DAIBAI open; non-canary tenant records skip without forcing receipted.
    expect(ok.case.status).toBe("dispatched");
    expect(ok.case.daibaiReceipt?.skipReason).toBe("tenant_not_canary");
    expect(send).toHaveBeenCalled();

    const [parent] = materializeInterventionCases([memoryAction], {
      tenantId: "tenant-a",
      growthGroupId: "grp-1",
      store,
    });
    const refused = await dispatchInterventionCase({
      case: parent,
      store,
      requesterUserId: "user-1",
      tenantId: "tenant-a",
      tenantAdmin: true,
      agentPrompt: "x",
    });
    expect(refused).toMatchObject({ ok: false, reason: "parent_dispatch_forbidden" });
  });

  it("hard-rejects space sessionKey with group_not_1to1", async () => {
    const store = createMemoryInterventionCaseStore();
    const [row] = materializeInterventionCases([memoryAction], { tenantId: "tenant-a", store });
    const poisoned = {
      ...row,
      target: {
        kind: "member_1to1" as const,
        agentId: "bot-ceo",
        sessionKey: "agent:bot-ceo:space:grp-1",
      },
    };
    store.put(poisoned);
    const result = await dispatchInterventionCase({
      case: poisoned,
      store,
      requesterUserId: "user-1",
      tenantId: "tenant-a",
      tenantAdmin: true,
      agentPrompt: "x",
      sessionExists: () => true,
      send: async () => ({ runId: "nope" }),
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("group_not_1to1");
    expect(result.case.status).toBe("blocked");
  });

  it("keeps production daibai open and remediation compile-time false", () => {
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
  });
});

// These historical cutover / functional rehearsals explicitly opt into writes
// against injected local ports. Default-closed behavior is covered separately
// in write-policy.test.ts; this is not production enablement.
vi.mock("./write-policy.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./write-policy.js")>();
  return {
    ...actual,
    DIAGNOSIS_WRITE_POLICY: {
      selfEvolutionConfirm: true,
      conversationDelivery: true,
      daibaiDelivery: true,
    },
  };
});
