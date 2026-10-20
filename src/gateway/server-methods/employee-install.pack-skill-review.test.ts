import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "./types.js";

const tmpDir = path.join(os.tmpdir(), `openbot-pack-skill-review-${process.pid}`);

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const syncInstallToRuntime = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("../runtime-binding-sync.js", () => ({
  syncInstallToRuntime,
}));

const { PACK_CN_OFFICE, buildPackManifest } = await import("../capability-packs/starter-packs.js");
const { registerCapability } = await import("../capability-governance-store.js");
const { GOVERNANCE_ADMIN_REQUIRED_MESSAGE } =
  await import("../enterprise-data/enterprise-data-seat-context.js");
const { loadEnterpriseDataStore } = await import("../enterprise-data/store.js");
const { employeeInstallHandlers, __employeeInstallStoreInternals } =
  await import("./employee-install.js");
const { employeeCapabilityHandlers } = await import("./employee-capability.js");
const { skillLifecycleHandlers } = await import("./skill-lifecycle.js");
const { createEnterpriseDataM5Handlers } = await import("./enterprise-data-m5.js");

const tenantId = "tenant-acme";
const memberScope = {
  enterpriseId: tenantId,
  user: { id: "emp-member-001" },
  membership: null,
  isEnterpriseAdmin: false,
  permissions: new Set(["operator"]),
};
const adminScope = {
  enterpriseId: tenantId,
  user: { id: "emp-admin-001" },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};

const skill = PACK_CN_OFFICE.skills.find((entry) => entry.skillKey === "feishu-integration");
if (!skill) {
  throw new Error("feishu-integration missing from PACK_CN_OFFICE");
}
const manifest = buildPackManifest({ skill, pack: PACK_CN_OFFICE });

type HandlerResponse = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; details?: Record<string, unknown> };
};

async function withEnterpriseDataStore<T>(
  _tenantId: string,
  _client: unknown,
  run: (store: Awaited<ReturnType<typeof loadEnterpriseDataStore>>) => Promise<T> | T,
): Promise<T> {
  const { saveEnterpriseDataStore } = await import("../enterprise-data/store.js");
  const store = await loadEnterpriseDataStore();
  const result = await run(store);
  await saveEnterpriseDataStore(store);
  return result;
}

const m5Handlers = createEnterpriseDataM5Handlers(withEnterpriseDataStore);

function useScope(admin: boolean) {
  resolveBillingScopeMock.mockImplementation(async () => (admin ? adminScope : memberScope));
}

async function invoke(
  handlers: Record<string, GatewayRequestHandler>,
  method: string,
  params: Record<string, unknown>,
  admin = false,
): Promise<HandlerResponse> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  useScope(admin);
  let response: HandlerResponse | null = null;
  await handler({
    req: { type: "req", id: "test", method, params },
    params,
    client: {
      connect: {
        role: "operator",
        scopes: ["write"],
        client: { id: "openbot-control-ui", version: "1.0.0", platform: "test", mode: "test" },
        minProtocol: 1,
        maxProtocol: 1,
      },
      user: admin ? "admin@acme.test" : "member@acme.test",
    },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as HandlerResponse["error"],
      };
    },
    context: {} as GatewayRequestHandlerOptions["context"],
  });
  return response ?? { ok: false };
}

function clean() {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  fs.mkdirSync(tmpDir, { recursive: true });
  __employeeInstallStoreInternals.reset();
  delete process.env.OPENBOT_MULTITENANT;
  delete process.env.OPENCLAW_MULTITENANT;
  delete process.env.OPENBOT_MULTI_TENANT;
  syncInstallToRuntime.mockReset();
  syncInstallToRuntime.mockResolvedValue({ synced: false, reason: "test-held" });
  registerCapability(manifest, undefined, {
    defaultEnabled: true,
    employeeVisibilityMode: "enterprise_review_required",
    updatedBy: "pack-skill-review-test",
  });
}

describe("cn-office pack skill review gates employee install", () => {
  beforeEach(() => {
    clean();
  });

  it("blocks confirm until approve_intent_only is fulfilled, and decide does not install", async () => {
    const listed = await invoke(employeeInstallHandlers, "employee-install.list-sources", {
      targetRobotId: "robot-1",
      tenantId: "evil-tenant",
      employeeId: "someone-else",
    });
    expect(listed.ok).toBe(true);
    const sources = listed.payload?.sources as Array<Record<string, unknown>>;
    const row = sources.find((entry) => entry.capabilityId === manifest.id);
    expect(row?.requiresApproval).toBe(true);
    expect(row?.governanceLabel).toBe("需要企业审核");
    expect(row?.approvalStatus).toBe("missing");
    expect(row?.packId).toBe("cn-office");
    expect(row?.skillKey).toBe("feishu-integration");

    const storeBefore = await loadEnterpriseDataStore();
    const approvalsBefore = Object.keys(storeBefore.governanceApprovalRequests).length;
    await invoke(employeeInstallHandlers, "employee-install.list-sources", {
      targetRobotId: "robot-1",
    });
    const storeAfterList = await loadEnterpriseDataStore();
    expect(Object.keys(storeAfterList.governanceApprovalRequests)).toHaveLength(approvalsBefore);

    const blocked = await invoke(employeeInstallHandlers, "employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: manifest.id,
      source: "enterprise-distributed",
      tenantId: "evil-tenant",
      employeeId: "someone-else",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.details).toMatchObject({
      code: "PACK_SKILL_REVIEW_REQUIRED",
      nextStep: "submit_pack_skill_review",
      category: "pack_skill_review",
      packId: "cn-office",
      skillKey: "feishu-integration",
      targetRobotId: "robot-1",
      rpc: "enterprise-data.governance-approvals.create",
    });
    expect(syncInstallToRuntime).not.toHaveBeenCalled();

    const created = await invoke(
      m5Handlers,
      "enterprise-data.governance-approvals.create",
      {
        category: "pack_skill_review",
        packId: "cn-office",
        skillKey: "feishu-integration",
        targetRobotId: "robot-1",
        reason: "岗位需要飞书集成",
      },
      false,
    );
    expect(created.ok).toBe(true);
    const approvalId = (created.payload?.request as { approvalId?: string })?.approvalId;
    expect(approvalId).toBeTruthy();

    const memberDecide = await invoke(
      m5Handlers,
      "enterprise-data.governance-approvals.decide",
      { approvalId, decision: "approved", fulfillmentMode: "approve_and_provision" },
      false,
    );
    expect(memberDecide.ok).toBe(false);
    expect(memberDecide.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    expect(syncInstallToRuntime).not.toHaveBeenCalled();

    const decided = await invoke(
      m5Handlers,
      "enterprise-data.governance-approvals.decide",
      {
        approvalId,
        decision: "approved",
        fulfillmentMode: "approve_intent_only",
        decisionNote: "同意安装意图",
      },
      true,
    );
    expect(decided.ok).toBe(true);
    expect(decided.payload?.request).toMatchObject({
      status: "approved",
      fulfillmentMode: "approve_intent_only",
      fulfillmentStatus: "pending_admin_save",
    });
    expect(syncInstallToRuntime).not.toHaveBeenCalled();

    const stillBlocked = await invoke(employeeInstallHandlers, "employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: manifest.id,
      source: "enterprise-distributed",
    });
    expect(stillBlocked.ok).toBe(false);
    expect(stillBlocked.error?.details?.nextStep).toBe("wait_admin_fulfill");
    expect(stillBlocked.error?.details?.capabilityAccessRequestId).toBe(approvalId);

    const memberFulfill = await invoke(
      m5Handlers,
      "enterprise-data.governance-approvals.fulfill",
      { approvalId },
      false,
    );
    expect(memberFulfill.ok).toBe(false);
    expect(syncInstallToRuntime).not.toHaveBeenCalled();

    const fulfilled = await invoke(
      m5Handlers,
      "enterprise-data.governance-approvals.fulfill",
      {
        approvalId,
        provisionReceipt: {
          handlerRef: "pack-skill-review-unlock",
          packId: "cn-office",
          skillKey: "feishu-integration",
          targetRobotId: "robot-1",
          capabilityId: manifest.id,
        },
      },
      true,
    );
    expect(fulfilled.ok).toBe(true);
    expect(fulfilled.payload?.request).toMatchObject({ fulfillmentStatus: "fulfilled" });
    expect(syncInstallToRuntime).not.toHaveBeenCalled();

    const store = await loadEnterpriseDataStore();
    expect(Object.keys(store.seatActionGrants)).toHaveLength(0);
    expect(Object.keys(store.dataCapabilities)).toHaveLength(0);

    const allowed = await invoke(employeeInstallHandlers, "employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: manifest.id,
      source: "enterprise-distributed",
      tenantId: "evil-tenant",
    });
    expect(allowed.ok).toBe(true);
    const requestId = allowed.payload?.requestId as string;
    const confirmed = await invoke(employeeInstallHandlers, "employee-install.confirm", {
      requestId,
    });
    expect(confirmed.ok).toBe(true);
    expect(syncInstallToRuntime).toHaveBeenCalledTimes(1);

    const listedAfter = await invoke(employeeInstallHandlers, "employee-install.list-sources", {
      targetRobotId: "robot-1",
    });
    const afterSources = listedAfter.payload?.sources;
    expect(Array.isArray(afterSources)).toBe(true);
    const afterRow = (afterSources as Array<Record<string, unknown>>).find(
      (entry) => entry.capabilityId === manifest.id,
    );
    expect(afterRow?.requiresApproval).toBe(true);
    expect(afterRow?.approvalStatus).toBe("fulfilled");
    expect(afterRow?.capabilityAccessRequestId).toBe(approvalId);
  });

  it("does not accept another tenant's fulfilled review", async () => {
    const { createCapabilityAccessRequest, fulfillGovernanceApprovalRequest } =
      await import("../enterprise-data/capability-access-request.js");
    const { decideGovernanceApprovalRequest } =
      await import("../enterprise-data/governance-approval-store.js");
    const { saveEnterpriseDataStore } = await import("../enterprise-data/store.js");
    const store = await loadEnterpriseDataStore();
    const request = createCapabilityAccessRequest({
      store,
      tenantId: "evil-tenant",
      category: "pack_skill_review",
      packId: "cn-office",
      skillKey: "feishu-integration",
      targetRobotId: "robot-1",
      requestedBy: "emp-member-001",
      nowIso: "2026-10-16T00:00:00.000Z",
    });
    decideGovernanceApprovalRequest({
      store,
      tenantId: "evil-tenant",
      approvalId: request.approvalId,
      decision: "approved",
      decidedBy: "emp-admin-001",
      nowIso: "2026-10-16T00:00:00.000Z",
    });
    fulfillGovernanceApprovalRequest({
      store,
      tenantId: "evil-tenant",
      approvalId: request.approvalId,
      fulfilledBy: "emp-admin-001",
      nowIso: "2026-10-16T00:00:00.000Z",
      provisionReceipt: { handlerRef: "pack-skill-review-unlock", packId: "cn-office" },
    });
    await saveEnterpriseDataStore(store);

    const blocked = await invoke(employeeInstallHandlers, "employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: manifest.id,
      source: "enterprise-distributed",
      tenantId: "evil-tenant",
      requestedBy: "emp-member-001",
    });
    expect(blocked.ok).toBe(false);
    expect(blocked.error?.details?.code).toBe("PACK_SKILL_REVIEW_REQUIRED");
    expect(syncInstallToRuntime).not.toHaveBeenCalled();
  });

  it("blocks employee-capability and robot-skills install paths before fulfillment", async () => {
    const capability = await invoke(
      employeeCapabilityHandlers,
      "employee-capability.install-to-robot",
      {
        capabilityId: manifest.id,
        agentId: "robot-1",
      },
    );
    expect(capability.ok).toBe(false);
    expect(capability.error?.details?.code).toBe("PACK_SKILL_REVIEW_REQUIRED");

    const robot = await invoke(skillLifecycleHandlers, "robot-skills.install", {
      skillId: "feishu-integration",
      agentId: "robot-1",
    });
    expect(robot.ok).toBe(false);
    expect(robot.error?.details?.code).toBe("PACK_SKILL_REVIEW_REQUIRED");
    expect(syncInstallToRuntime).not.toHaveBeenCalled();
  });

  it("still confirms a skill that is not enterprise-review pack scoped", async () => {
    const created = await invoke(employeeInstallHandlers, "employee-install.create-request", {
      targetRobotId: "robot-1",
      capabilityId: "cap-not-in-review-pack",
      source: "platform-marketplace",
    });
    expect(created.ok).toBe(true);
    const confirmed = await invoke(employeeInstallHandlers, "employee-install.confirm", {
      requestId: created.payload?.requestId,
    });
    expect(confirmed.ok).toBe(true);
    expect(syncInstallToRuntime).toHaveBeenCalledTimes(1);
  });
});
