import { vi } from "vitest";
/**
 * Track I WS infra — materialize RPC + resolveExpandInput SoT semantics.
 * Gates stay closed. Memory store is process-local.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEmptyAgentRegistryStore } from "../gateway/agent-registry/types.js";
import type { DataPlaneCase } from "./diagnose-data-plane-cases.js";
import { expandDiagnoseGroupMembers } from "./diagnose-group-member-expand.js";
import type { DiagnoseConversationAction } from "./diagnose-next-actions.js";
import { DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED } from "./diagnose-professional-protocol.js";
import { createMemoryInterventionCaseStore } from "./intervention-case-store.js";
import {
  createInterventionGatewayHandlers,
  setSharedInterventionCaseStoreForTests,
} from "./intervention-gateway.js";
import {
  DIAGNOSIS_INTERVENTION_EXPAND_METHOD,
  DIAGNOSIS_INTERVENTION_LIST_METHOD,
  DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD,
} from "./intervention-methods.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";

const TENANT = "tenant-ws-infra";
const SAMPLE_GROUP = "grp-daniel-hhd-gmail-com-upbeyond";

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

type RpcResult = {
  ok: boolean;
  payload?: unknown;
  error?: { message?: string; code?: string };
};

function mockAuth(tenantId = TENANT) {
  return {
    principal: {
      schemaVersion: 1 as const,
      principalId: "steward-ws",
      kind: "user" as const,
      tenantId,
    },
    trusted: { tenantId },
  };
}

async function callHandler(
  handlers: ReturnType<typeof createInterventionGatewayHandlers>,
  method: string,
  params: Record<string, unknown>,
): Promise<RpcResult> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  return await new Promise<RpcResult>((resolve) => {
    void handler({
      params,
      client: { sessionDomain: "tenant", sessionKind: "admin" },
      respond: (ok: boolean, payload?: unknown, error?: { message?: string; code?: string }) => {
        resolve({ ok, payload, error });
      },
    } as never);
  });
}

afterEach(() => {
  setSharedInterventionCaseStoreForTests(null);
});

describe("diagnosis.intervention.materialize (WS infra)", () => {
  it("keeps CONFIRM+DAIBAI open and REMEDIATION false (Path B 2026-10-19)", () => {
    expect(DIAGNOSIS_SELF_EVOLUTION_CONFIRM_ENABLED).toBe(true);
    expect(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED).toBe(true);
    expect(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED).toBe(false);
  });

  it("rejects unauthorized callers", async () => {
    const store = createMemoryInterventionCaseStore();
    const handlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => null,
    });
    const res = await callHandler(handlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {
      actions: [memoryAction],
    });
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("unauthorized");
  });

  it("requires actions or dataPlaneCases", async () => {
    const store = createMemoryInterventionCaseStore();
    const handlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
    });
    const res = await callHandler(handlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {});
    expect(res.ok).toBe(false);
    expect(res.error?.message).toBe("actions_or_dataPlaneCases_required");
  });

  it("materializes actions + dataPlaneCases into the shared store; list sees them", async () => {
    const store = createMemoryInterventionCaseStore();
    setSharedInterventionCaseStoreForTests(store);
    const handlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
    });

    const dp: DataPlaneCase = {
      schemaVersion: 1,
      caseKind: "locator_failed",
      status: "suggested",
      tenantId: TENANT,
      findingCode: "locator_failed",
      source: {
        growthAgentId: null,
        growthGroupId: SAMPLE_GROUP,
        reportRef: "cdr:ws-infra",
      },
      target: { kind: "group_parent", agentId: null, sessionKey: null },
      locatorFailureCode: "workspace_unreadable",
      createdAt: "2026-10-15T00:00:00.000Z",
    };

    const mat = await callHandler(handlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {
      actions: [memoryAction],
      dataPlaneCases: [dp],
      growthGroupId: SAMPLE_GROUP,
    });
    expect(mat.ok).toBe(true);
    const matPayload = mat.payload as { cases: unknown[]; count: number };
    expect(matPayload.count).toBe(2);
    expect(matPayload.cases).toHaveLength(2);

    const list = await callHandler(handlers, DIAGNOSIS_INTERVENTION_LIST_METHOD, {
      tenantId: TENANT,
    });
    expect(list.ok).toBe(true);
    const listed = list.payload as { cases: Array<{ status: string }>; count: number };
    expect(listed.count).toBeGreaterThanOrEqual(2);
    expect(listed.cases.some((c) => c.status === "expanding")).toBe(true);
    expect(listed.cases.some((c) => c.status === "suggested")).toBe(true);
  });
});

describe("resolveExpandInput SoT semantics (null ≠ [])", () => {
  it("stub loadMembers null → members_unreadable; stub [] → 无成员绑定", async () => {
    const registry = createEmptyAgentRegistryStore();

    const unreadable = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: SAMPLE_GROUP,
      registry,
      loadMembers: async () => null,
    });
    expect(unreadable.emptyReason).toBe("members_unreadable");
    expect(unreadable.members).toEqual([]);

    const empty = await expandDiagnoseGroupMembers({
      tenantId: TENANT,
      groupId: SAMPLE_GROUP,
      registry,
      loadMembers: async () => [],
    });
    expect(empty.emptyReason).toBe("无成员绑定");
    expect(empty.members).toEqual([]);
  });

  it("gateway expand with resolveExpandInput loaders: null and [] both fail without omitting deps", async () => {
    const store = createMemoryInterventionCaseStore();
    const registry = createEmptyAgentRegistryStore();

    const matHandlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
    });
    const mat = await callHandler(matHandlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {
      actions: [memoryAction],
      growthGroupId: SAMPLE_GROUP,
    });
    expect(mat.ok).toBe(true);
    const parentId = (mat.payload as { cases: Array<{ caseId: string }> }).cases[0].caseId;

    const nullHandlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
      resolveExpandInput: async ({ tenantId, groupId }) => ({
        tenantId: (tenantId ?? "").trim(),
        groupId,
        registry,
        loadMembers: async () => null,
        sessionKeyExists: () => false,
      }),
    });
    const nullExpand = await callHandler(nullHandlers, DIAGNOSIS_INTERVENTION_EXPAND_METHOD, {
      caseId: parentId,
    });
    expect(nullExpand.ok).toBe(false);
    expect(nullExpand.error?.message ?? (nullExpand.payload as { reason?: string })?.reason).toBe(
      "expand_failed",
    );

    // Rematerialize a fresh parent for [] path (prior expand blocked the first)
    const mat2 = await callHandler(matHandlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {
      actions: [{ ...memoryAction, actionId: "act:memory:bot-ceo-empty" }],
      growthGroupId: SAMPLE_GROUP,
    });
    const parentId2 = (mat2.payload as { cases: Array<{ caseId: string }> }).cases[0].caseId;

    const emptyHandlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
      resolveExpandInput: async ({ tenantId, groupId }) => ({
        tenantId: (tenantId ?? "").trim(),
        groupId,
        registry,
        loadMembers: async () => [],
        sessionKeyExists: () => false,
      }),
    });
    const emptyExpand = await callHandler(emptyHandlers, DIAGNOSIS_INTERVENTION_EXPAND_METHOD, {
      caseId: parentId2,
    });
    expect(emptyExpand.ok).toBe(false);
    expect(emptyExpand.error?.message ?? (emptyExpand.payload as { reason?: string })?.reason).toBe(
      "expand_failed",
    );
  });

  it("with members, expand walks the members path (not missing-deps expand_failed)", async () => {
    const store = createMemoryInterventionCaseStore();
    const registry = createEmptyAgentRegistryStore();
    const handlers = createInterventionGatewayHandlers({
      store,
      resolveAuth: async () => mockAuth() as never,
      resolveExpandInput: async ({ tenantId, groupId }) => ({
        tenantId: (tenantId ?? "").trim(),
        groupId,
        registry,
        loadMembers: async () => [
          { memberKind: "bot", agentId: "bot-a", userId: "u-a", status: "active" },
          { memberKind: "bot", agentId: "bot-b", userId: "u-b", status: "active" },
        ],
        sessionKeyExists: () => true,
      }),
    });

    const mat = await callHandler(handlers, DIAGNOSIS_INTERVENTION_MATERIALIZE_METHOD, {
      actions: [memoryAction],
      growthGroupId: SAMPLE_GROUP,
    });
    const parentId = (mat.payload as { cases: Array<{ caseId: string }> }).cases[0].caseId;

    const expandRes = await callHandler(handlers, DIAGNOSIS_INTERVENTION_EXPAND_METHOD, {
      caseId: parentId,
    });
    expect(expandRes.ok).toBe(true);
    const payload = expandRes.payload as {
      parent: { status: string };
      children: Array<{ target: { kind: string; sessionKey: string | null } }>;
    };
    expect(payload.parent.status).toBe("queued");
    expect(payload.children.length).toBeGreaterThan(0);
    expect(payload.children.every((c) => c.target.kind === "member_1to1")).toBe(true);
    expect(
      payload.children.every((c) => !String(c.target.sessionKey ?? "").includes(":space:")),
    ).toBe(true);
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
