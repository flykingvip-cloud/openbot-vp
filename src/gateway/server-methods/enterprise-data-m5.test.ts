// @vitest-environment node
import fs from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GOVERNANCE_ADMIN_REQUIRED_MESSAGE } from "../enterprise-data/enterprise-data-seat-context.js";
import { listEnterpriseKnowledgeProjectionBindings } from "../enterprise-data/enterprise-knowledge-projection-binding-store.js";
import { runProjectionMaterialization } from "../enterprise-data/projection-materializer.js";
import {
  ensureEnterpriseDataCatalogSeeded,
  seedEnterpriseDataCatalog,
} from "../enterprise-data/seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "../enterprise-data/store.js";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const { createEnterpriseDataM5Handlers } = await import("./enterprise-data-m5.js");

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-enterprise-data-m5-handler-test-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { code?: string }) => ({
    code,
    message,
    ...extra,
  }),
}));

const tenantId = "tenant-acme";
const nowIso = "2026-06-05T12:00:00.000Z";
const adminScope = {
  enterpriseId: tenantId,
  user: { id: "emp-admin-001" },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};
const memberScope = {
  enterpriseId: tenantId,
  user: { id: "emp-member-001" },
  membership: null,
  isEnterpriseAdmin: false,
  permissions: new Set(["operator"]),
};

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string };
  responseCount?: number;
};

async function withEnterpriseDataStore<T>(
  runTenantId: string,
  _client: unknown,
  run: (store: Awaited<ReturnType<typeof loadEnterpriseDataStore>>) => Promise<T> | T,
): Promise<T> {
  const store = await loadEnterpriseDataStore();
  ensureEnterpriseDataCatalogSeeded({
    store,
    tenantId: runTenantId,
    nowIso: new Date().toISOString(),
  });
  const result = await run(store);
  await saveEnterpriseDataStore(store);
  return result;
}

const m5Handlers = createEnterpriseDataM5Handlers(withEnterpriseDataStore);

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

async function seedCatalog() {
  const store = normalizeEnterpriseDataStore(null);
  seedEnterpriseDataCatalog({ store, tenantId, nowIso });
  await saveEnterpriseDataStore(store);
}

async function invoke(
  method: string,
  params: Record<string, unknown> = {},
  options: { admin?: boolean } = {},
): Promise<InvokeResult> {
  const handler = m5Handlers[method] as GatewayRequestHandler | undefined;
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  resolveBillingScopeMock.mockImplementation(async () =>
    options.admin === false ? memberScope : adminScope,
  );
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: { connect: {} as never, user: "admin@acme.test" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as { message?: string } | undefined,
        responseCount: (response?.responseCount ?? 0) + 1,
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  if (!response) {
    throw new Error(`handler ${method} did not respond`);
  }
  return response;
}

describe("enterprise-data M5 gateway handlers", () => {
  beforeEach(async () => {
    cleanStore();
    resolveBillingScopeMock.mockReset();
    await seedCatalog();
  });

  it("rejects member on lineage.resolve", async () => {
    const response = await invoke(
      "enterprise-data.lineage.resolve",
      { tenantId, objectId: "missing" },
      { admin: false },
    );
    expect(response.ok).toBe(false);
    expect(response.responseCount).toBe(1);
    expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("does not replace admin rejection with a missing-id error", async () => {
    const lineage = await invoke("enterprise-data.lineage.get", { tenantId }, { admin: false });
    const audit = await invoke("enterprise-data.supply-audit.get", { tenantId }, { admin: false });
    for (const response of [lineage, audit]) {
      expect(response.responseCount).toBe(1);
      expect(response.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    }
    // get is employee-readable for own requests; missing id still fails validation first.
    const approval = await invoke(
      "enterprise-data.governance-approvals.get",
      { tenantId },
      { admin: false },
    );
    expect(approval.responseCount).toBe(1);
    expect(approval.error?.message).toBe("approvalId is required");
  });

  it("resolves lineage chain after materialization", async () => {
    const objectId = await materializeProfileFeedItem();
    const response = await invoke("enterprise-data.lineage.resolve", { tenantId, objectId });
    expect(response.ok).toBe(true);
    const resolution = response.payload?.resolution as {
      chain?: Array<{ layer: string }>;
      reverseChain?: Array<{ role: string; id: string }>;
    };
    expect(resolution.chain?.some((node) => node.layer === "connector_action")).toBe(true);
    const reverseRoles = resolution.reverseChain?.map((node) => node.role) ?? [];
    expect(reverseRoles.indexOf("projection")).toBeLessThan(
      reverseRoles.indexOf("connector_action"),
    );
    expect(reverseRoles.indexOf("connector_action")).toBeLessThan(
      reverseRoles.indexOf("source_data"),
    );
    expect(resolution.reverseChain?.find((node) => node.role === "connector_action")?.id).toBe(
      "crm-salesforce::crm.customer.read_summary@v1",
    );
  });

  it("lists supply audit events after materialization", async () => {
    await materializeProfileFeedItem();
    const response = await invoke("enterprise-data.supply-audit.list", { tenantId });
    expect(response.ok).toBe(true);
    expect((response.payload?.events as unknown[])?.length).toBeGreaterThan(0);
  });

  it("creates and decides governance approvals by category", async () => {
    const sourceId = await getCrmSourceId();
    const store = await loadEnterpriseDataStore();
    store.dataSources[sourceId].status = "disconnected";
    await saveEnterpriseDataStore(store);

    const created = await invoke("enterprise-data.governance-approvals.create", {
      tenantId,
      category: "source_onboarding",
      subjectId: sourceId,
      reason: "onboard CRM",
    });
    expect(created.ok).toBe(true);
    const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
    const decided = await invoke("enterprise-data.governance-approvals.decide", {
      tenantId,
      approvalId,
      decision: "approved",
    });
    expect(decided.ok).toBe(true);
    const overview = await invoke("enterprise-data.governance-approvals.overview", { tenantId });
    expect(overview.ok).toBe(true);
    expect((overview.payload?.overview as { totalPending?: number })?.totalPending).toBe(0);
  });
});

it("allows employee to create mcp_tool_mapping and list only mine", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "feishu",
      mcpTool: "docs.search",
      reason: "need search",
    },
    { admin: false },
  );
  expect(created.ok).toBe(true);
  const request = created.payload?.request as {
    approvalId?: string;
    status?: string;
    fulfillmentStatus?: string;
    reviewState?: string;
  };
  expect(request.status).toBe("pending");
  expect(request.reviewState).toBe("submitted");
  expect(request.fulfillmentStatus).toBe("not_required");

  const listed = await invoke(
    "enterprise-data.governance-approvals.list",
    { tenantId, category: "mcp_tool_mapping" },
    { admin: false },
  );
  expect(listed.ok).toBe(true);
  expect((listed.payload?.requests as unknown[])?.length).toBe(1);

  const decideAsMember = await invoke(
    "enterprise-data.governance-approvals.decide",
    { tenantId, approvalId: request.approvalId, decision: "approved" },
    { admin: false },
  );
  expect(decideAsMember.ok).toBe(false);
  expect(decideAsMember.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
});

it("admin approve_intent_only does not provision; fulfill marks done", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "jira",
      mcpTool: "issue.get",
    },
    { admin: false },
  );
  const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
  const decided = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_intent_only",
  });
  expect(decided.ok).toBe(true);
  const req = decided.payload?.request as {
    status?: string;
    fulfillmentStatus?: string;
    fulfillmentMode?: string;
  };
  expect(req.status).toBe("approved");
  expect(req.fulfillmentMode).toBe("approve_intent_only");
  expect(req.fulfillmentStatus).toBe("pending_admin_save");
  expect(typeof decided.payload?.fulfillmentDeeplinkQuery).toBe("string");

  const provisionBlocked = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_and_provision",
  });
  // already decided → not pending
  expect(provisionBlocked.ok).toBe(false);

  const fulfilled = await invoke("enterprise-data.governance-approvals.fulfill", {
    tenantId,
    approvalId,
    provisionReceipt: { capabilityId: "cap-demo", handlerRef: "mcp://jira/issue.get" },
  });
  expect(fulfilled.ok).toBe(true);
  expect((fulfilled.payload?.request as { fulfillmentStatus?: string })?.fulfillmentStatus).toBe(
    "fulfilled",
  );
});

it("admin approve_and_provision writes mapping and the requester seat grant", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "gmail",
      mcpTool: "list_messages",
      requesterSeatId: "seat-requester",
      discoveryStatusSnapshot: "mapped_pending_grant",
    },
    { admin: false },
  );
  expect(created.ok).toBe(true);
  const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
  const memberDecide = await invoke(
    "enterprise-data.governance-approvals.decide",
    {
      tenantId,
      approvalId,
      decision: "approved",
      fulfillmentMode: "approve_and_provision",
      seatId: "seat-evil",
    },
    { admin: false },
  );
  expect(memberDecide.ok).toBe(false);
  expect(memberDecide.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);

  const decided = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_and_provision",
    seatId: "seat-evil",
  });
  expect(decided.ok).toBe(true);
  const request = decided.payload?.request as {
    status?: string;
    fulfillmentStatus?: string;
    fulfillmentMode?: string;
    provisionReceipt?: { capabilityId?: string; grantId?: string; handlerRef?: string };
  };
  expect(request.status).toBe("approved");
  expect(request.fulfillmentMode).toBe("approve_and_provision");
  expect(request.fulfillmentStatus).toBe("fulfilled");
  expect(request.provisionReceipt?.capabilityId).toBeTruthy();
  expect(request.provisionReceipt?.grantId).toBeTruthy();
  expect(request.provisionReceipt?.handlerRef).toContain("gmail");
  const store = await loadEnterpriseDataStore();
  const grants = Object.values(store.seatActionGrants).filter(
    (grant) => grant.actionKey.includes("gmail") || grant.seatId === "seat-requester",
  );
  expect(grants.map((grant) => grant.seatId)).toEqual(["seat-requester"]);
  expect(grants.some((grant) => grant.seatId === "seat-evil")).toBe(false);
});

it("approve_and_provision failure stays approved and does not mark the request fulfilled", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "slack",
      mcpTool: "chat.post",
      discoveryStatusSnapshot: "mapped_pending_grant",
    },
    { admin: false },
  );
  const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
  const decided = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_and_provision",
    seatId: "seat-evil",
  });
  expect(decided.ok).toBe(true);
  const request = decided.payload?.request as {
    status?: string;
    fulfillmentStatus?: string;
    decidedAt?: string;
    provisionError?: string;
  };
  expect(request.status).toBe("approved");
  expect(request.fulfillmentStatus).toBe("failed");
  expect(request.provisionError).toContain("没有席位");
  const store = await loadEnterpriseDataStore();
  expect(
    Object.values(store.seatActionGrants).some(
      (grant) => grant.seatId === "seat-evil" || grant.actionKey.includes("slack"),
    ),
  ).toBe(false);

  const stored = Object.values(store.governanceApprovalRequests).find(
    (item) => item.approvalId === approvalId,
  );
  if (!stored) {
    throw new Error("missing approval");
  }
  stored.requesterSeatId = "seat-requester";
  await saveEnterpriseDataStore(store);
  const retried = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_and_provision",
  });
  expect(retried.ok).toBe(true);
  const retriedRequest = retried.payload?.request as {
    fulfillmentStatus?: string;
    decidedAt?: string;
    decidedBy?: string;
  };
  expect(retriedRequest.fulfillmentStatus).toBe("fulfilled");
  expect(retriedRequest.decidedAt).toBe(request.decidedAt);
  expect(retriedRequest.decidedBy).toBe("emp-admin-001");
});

it("rejects approve_and_provision for pack_skill_review", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "pack_skill_review",
      packId: "cn-office",
      skillKey: "meeting.schedule",
      targetRobotId: "robot-1",
    },
    { admin: false },
  );
  const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
  const decided = await invoke("enterprise-data.governance-approvals.decide", {
    tenantId,
    approvalId,
    decision: "approved",
    fulfillmentMode: "approve_and_provision",
  });
  expect(decided.ok).toBe(false);
  expect(decided.error?.message).toContain("only supported for mcp_tool_mapping");
  const store = await loadEnterpriseDataStore();
  const stored = Object.values(store.governanceApprovalRequests).find(
    (item) => item.approvalId === approvalId,
  );
  expect(stored?.status).toBe("pending");
});

it("employee can cancel own pending mcp request", async () => {
  const created = await invoke(
    "enterprise-data.governance-approvals.create",
    {
      tenantId,
      category: "mcp_tool_mapping",
      mcpServer: "slack",
      mcpTool: "chat.post",
    },
    { admin: false },
  );
  const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
  const cancelled = await invoke(
    "enterprise-data.governance-approvals.cancel",
    { tenantId, approvalId },
    { admin: false },
  );
  expect(cancelled.ok).toBe(true);
  expect((cancelled.payload?.request as { status?: string })?.status).toBe("cancelled");
});

async function materializeProfileFeedItem(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find((item) => {
    const spec = store.enterpriseKnowledgeProjectionSpecs[item.projectionId];
    return spec?.projectionKey === "customer.profile";
  });
  if (!binding) {
    throw new Error("profile binding not found");
  }
  const result = await runProjectionMaterialization({
    store,
    tenantId,
    bindingId: binding.bindingId,
    nowIso: new Date().toISOString(),
  });
  await saveEnterpriseDataStore(store);
  return result.objectId;
}

async function getCrmSourceId(): Promise<string> {
  const store = await loadEnterpriseDataStore();
  const source = Object.values(store.dataSources).find(
    (item) => item.tenantId === tenantId && item.sourceKey === "crm-salesforce",
  );
  if (!source) {
    throw new Error("CRM source not found");
  }
  return source.sourceId;
}
