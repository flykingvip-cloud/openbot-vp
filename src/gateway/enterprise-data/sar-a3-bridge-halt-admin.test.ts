// @vitest-environment node
/**
 * A3: product admin RPCs for SAR bridge upsert + halt/resume.
 * Trusted enterprise-admin identity, durable store, E5-style admin audit.
 * Does not claim in-flight side-effect withdrawal. Does not claim R5 / E overall.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { upsertDataSource } from "./data-source-store.js";
import {
  GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
  createTrustedExecutionContextForTest,
} from "./enterprise-data-seat-context.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { listSarAdminAuditEvents } from "./sar-admin-audit.js";
import { evaluateSarExecutionHalt } from "./sar-execution-halt.js";
import type { SarGovernanceProvider } from "./sar-governance-bridge.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-sar-a3-bridge-halt-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const requireAdminTenantMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("./enterprise-data-seat-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-data-seat-context.js")>();
  return {
    ...actual,
    requireResolvedEnterpriseAdminTenantId: requireAdminTenantMock,
  };
});

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { details?: { code?: string } }) => ({
    code,
    message,
    details: extra?.details,
  }),
}));

const { createEnterpriseDataSarAdminHandlers, GOVERNANCE_ADMIN_REQUIRED_MESSAGE: exportedMsg } =
  await import("../server-methods/enterprise-data-sar-admin.js");

const tenantId = "tenant-acme";
const nowIso = "2026-10-18T10:30:00.000Z";
const adminId = "emp-admin-001";
const ownerId = "emp-owner";
const seatId = "seat-site";
const bindingId = "bind-a3";
const sourceId = "src-site-a3";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const capabilityId = "fixture.sar.a3.read";
const sarVersion = "2026.10.18";
const artifactDigest = "sha256:a3-digest-1";

function cleanTmp() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

function adminScope() {
  return {
    enterpriseId: tenantId,
    user: { id: adminId },
    membership: null,
    isEnterpriseAdmin: true,
    permissions: new Set(["operator"]),
  };
}

function memberScope() {
  return {
    enterpriseId: tenantId,
    user: { id: "emp-member-001" },
    membership: null,
    isEnterpriseAdmin: false,
    permissions: new Set(["operator"]),
  };
}

function seedWebsiteStore(): EnterpriseDataStore {
  const store = normalizeEnterpriseDataStore(null);
  upsertScopePolicy({
    store,
    tenantId,
    nowIso,
    policy: {
      scopePolicyId: "scope-self",
      displayName: "self",
      scopeType: "SELF",
    },
  });
  upsertConnectorAction({
    store,
    tenantId,
    nowIso,
    action: {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      displayName: "网站会话读取",
      category: "external",
      riskLevel: "LOW",
      requiresApproval: false,
      readOnly: true,
      outputSchema: { type: "object" },
      lifecycle: "active",
    },
  });
  registerRuntimeHandler({
    store,
    tenantId,
    nowIso,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    handlerRef: "enterprise-data/sar-bridge/read",
  });
  upsertSeatActionGrant({
    store,
    tenantId,
    seatId,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    scopePolicyId: "scope-self",
    nowIso,
  });
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: "site-a3",
      displayName: "网站 A3",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId,
    },
  });
  return store;
}

function readResult(overrides: Partial<SiteRunResult> = {}): SiteRunResult {
  return {
    runId: "run-a3-1",
    capabilityId,
    version: sarVersion,
    status: "succeeded",
    verification: "passed",
    completeness: "complete",
    data: [{ id: "row-1" }],
    evidenceRef: "evidence-a3",
    durationMs: 3,
    repair: "none",
    ...overrides,
  };
}

function providerFor(calls: string[]): SarGovernanceProvider {
  return {
    async execute() {
      calls.push("execute");
      return { result: readResult(), scopeEnforcedBeforeRead: true };
    },
  };
}

type InvokeOutcome = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; details?: { code?: string } };
};

async function callHandler(
  method: string,
  params: Record<string, unknown>,
  store: EnterpriseDataStore,
): Promise<InvokeOutcome> {
  await saveEnterpriseDataStore(store);
  async function withStore<T>(
    runTenantId: string,
    _client: unknown,
    run: (s: EnterpriseDataStore) => Promise<T> | T,
  ): Promise<T> {
    expect(runTenantId).toBe(tenantId);
    const loaded = await loadEnterpriseDataStore();
    const result = await run(loaded);
    await saveEnterpriseDataStore(loaded);
    return result;
  }
  const handlers = createEnterpriseDataSarAdminHandlers(withStore);
  const handler = handlers[method];
  let ok = false;
  let payload: Record<string, unknown> | undefined;
  let error: { message?: string; details?: { code?: string } } | undefined;
  await handler({
    req: { type: "req", id: "a3", method },
    params: { tenantId, ...params },
    client: { user: "admin@acme.test" } as never,
    context: {} as never,
    respond: (success: boolean, data?: unknown, err?: unknown) => {
      ok = success;
      payload = data as Record<string, unknown> | undefined;
      error = err as { message?: string; details?: { code?: string } } | undefined;
    },
  } as never);
  const reloaded = await loadEnterpriseDataStore();
  Object.assign(store, reloaded);
  return { ok, payload, error };
}

describe("A3 SAR bridge/halt admin product RPC", () => {
  beforeEach(() => {
    cleanTmp();
    requireAdminTenantMock.mockReset();
    resolveBillingScopeMock.mockReset();
    requireAdminTenantMock.mockResolvedValue(tenantId);
    resolveBillingScopeMock.mockResolvedValue(adminScope());
  });
  afterEach(() => {
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  });

  it("authorized admin upserts a bridge with persistence and audit", async () => {
    const store = seedWebsiteStore();
    const outcome = await callHandler(
      "enterprise-data.sar.bridges.upsert",
      {
        sourceId,
        bindingId,
        userId: ownerId,
        capabilityId,
        capabilityVersion: sarVersion,
        artifactDigest,
        actionRef,
        verification: "passed",
        supportedScopeTypes: ["SELF"],
        enforcedFilterFields: [],
      },
      store,
    );
    expect(outcome.ok).toBe(true);
    expect(outcome.payload?.bridge).toMatchObject({
      tenantId,
      sourceId,
      capabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId,
      userId: ownerId,
      verification: "passed",
      effect: "read",
    });
    const audit = outcome.payload?.audit as { action: string; actorId: string; subjectId: string };
    expect(audit.action).toBe("bridge_upsert");
    expect(audit.actorId).toBe(adminId);
    expect(audit.subjectId).toBeTruthy();

    const listed = await callHandler("enterprise-data.sar.bridges.list", {}, store);
    expect(listed.ok).toBe(true);
    const bridges = listed.payload?.bridges;
    expect(Array.isArray(bridges) ? bridges.length : 0).toBe(1);

    const audits = listSarAdminAuditEvents({ store, tenantId, action: "bridge_upsert" });
    expect(audits).toHaveLength(1);
    expect(audits[0]?.actorId).toBe(adminId);

    const reloaded = await loadEnterpriseDataStore();
    expect(Object.keys(reloaded.sarExecutionBridges ?? {})).toHaveLength(1);
    expect(Object.keys(reloaded.sarAdminAuditEvents ?? {})).toHaveLength(1);
  });

  it("unauthorized non-admin is rejected before mutation", async () => {
    requireAdminTenantMock.mockImplementation(async ({ respond }) => {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
      });
      return null;
    });
    resolveBillingScopeMock.mockResolvedValue(memberScope());
    const store = seedWebsiteStore();
    const outcome = await callHandler(
      "enterprise-data.sar.bridges.upsert",
      {
        sourceId,
        bindingId,
        userId: ownerId,
        capabilityId,
        capabilityVersion: sarVersion,
        artifactDigest,
        actionRef,
        supportedScopeTypes: ["SELF"],
      },
      store,
    );
    expect(outcome.ok).toBe(false);
    expect(outcome.error?.message).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
    expect(Object.keys(store.sarExecutionBridges ?? {})).toHaveLength(0);
    expect(listSarAdminAuditEvents({ store, tenantId })).toHaveLength(0);
    expect(exportedMsg).toBe(GOVERNANCE_ADMIN_REQUIRED_MESSAGE);
  });

  it("halt blocks new runs; resume allows; never claims in-flight withdrawal", async () => {
    const store = seedWebsiteStore();
    const upsert = await callHandler(
      "enterprise-data.sar.bridges.upsert",
      {
        sourceId,
        bindingId,
        userId: ownerId,
        capabilityId,
        capabilityVersion: sarVersion,
        artifactDigest,
        actionRef,
        verification: "passed",
        supportedScopeTypes: ["SELF"],
        enforcedFilterFields: [],
      },
      store,
    );
    expect(upsert.ok).toBe(true);

    const calls: string[] = [];
    const provider = providerFor(calls);
    const context = createTrustedExecutionContextForTest({
      tenantId,
      seatId,
      employeeId: ownerId,
      userId: ownerId,
    });

    const before = await invokeEnterpriseDataAction({
      store,
      context,
      ref: actionRef,
      sourceId,
      nowIso: new Date().toISOString(),
      sarProvider: provider,
    });
    expect(before.ok).toBe(true);
    expect(calls).toHaveLength(1);

    const halted = await callHandler(
      "enterprise-data.sar.halts.set",
      {
        scope: "capability",
        capabilityId,
        reason: "A3 admin halt for fixture",
      },
      store,
    );
    expect(halted.ok).toBe(true);
    expect(halted.payload?.inFlightSideEffectsWithdrawn).toBe(false);
    expect(halted.payload?.priorWriteMayBeReplayed).toBe(false);
    expect(halted.payload?.blocksNewRun).toBe(true);
    const haltAudit = halted.payload?.audit as {
      action: string;
      inFlightSideEffectsWithdrawn?: boolean;
      priorWriteMayBeReplayed?: boolean;
    };
    expect(haltAudit.action).toBe("halt_set");
    expect(haltAudit.inFlightSideEffectsWithdrawn).toBe(false);
    expect(haltAudit.priorWriteMayBeReplayed).toBe(false);

    const decision = evaluateSarExecutionHalt({
      store,
      tenantId,
      capabilityId,
      version: sarVersion,
    });
    expect(decision.blocked).toBe(true);
    expect(decision.inFlightSideEffectsWithdrawn).toBe(false);
    expect(decision.priorWriteMayBeReplayed).toBe(false);

    const blocked = await invokeEnterpriseDataAction({
      store,
      context,
      ref: actionRef,
      sourceId,
      nowIso: new Date().toISOString(),
      sarProvider: provider,
    });
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("SAR_EXECUTION_HALTED");
      expect(blocked.details?.inFlightSideEffectsWithdrawn).toBe(false);
      expect(blocked.details?.priorWriteMayBeReplayed).toBe(false);
      expect(blocked.details?.blocksNewRun).toBe(true);
    }
    expect(calls).toHaveLength(1);

    const halt = halted.payload?.halt as { haltId: string } | undefined;
    expect(halt).toBeTruthy();
    const haltId = halt!.haltId;
    const resumed = await callHandler("enterprise-data.sar.halts.clear", { haltId }, store);
    expect(resumed.ok).toBe(true);
    expect(resumed.payload?.resumed).toBe(true);
    expect(resumed.payload?.inFlightSideEffectsWithdrawn).toBe(false);
    const audit = resumed.payload?.audit as { action: string } | undefined;
    expect(audit?.action).toBe("halt_clear");

    const after = await invokeEnterpriseDataAction({
      store,
      context,
      ref: actionRef,
      sourceId,
      nowIso: new Date().toISOString(),
      sarProvider: provider,
    });
    expect(after.ok).toBe(true);
    expect(calls).toHaveLength(2);

    const auditList = await callHandler("enterprise-data.sar.admin-audit.list", {}, store);
    expect(auditList.ok).toBe(true);
    const events = auditList.payload?.events as Array<{ action: string }>;
    const actions = events.map((e) => e.action).toSorted();
    expect(actions).toEqual(["bridge_upsert", "halt_clear", "halt_set"].toSorted());
  });

  it("unauthorized halt set is rejected", async () => {
    requireAdminTenantMock.mockImplementation(async ({ respond }) => {
      respond(false, undefined, {
        code: "INVALID_REQUEST",
        message: GOVERNANCE_ADMIN_REQUIRED_MESSAGE,
      });
      return null;
    });
    const store = seedWebsiteStore();
    const outcome = await callHandler(
      "enterprise-data.sar.halts.set",
      { scope: "tenant", reason: "should fail" },
      store,
    );
    expect(outcome.ok).toBe(false);
    expect(Object.keys(store.sarExecutionHalts ?? {})).toHaveLength(0);
  });

  it("source honesty: product handlers call upsert/set/clear and admin gate", () => {
    const source = fs.readFileSync(
      new URL("../server-methods/enterprise-data-sar-admin.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("upsertSarExecutionBridge");
    expect(source).toContain("setSarExecutionHalt");
    expect(source).toContain("clearSarExecutionHalt");
    expect(source).toContain("requireResolvedEnterpriseAdminTenantId");
    expect(source).toContain("recordSarAdminAudit");
    expect(source).toContain("inFlightSideEffectsWithdrawn: false");
    expect(source).not.toMatch(/inFlightSideEffectsWithdrawn:\s*true/);

    const registry = fs.readFileSync(
      new URL("../server-methods/enterprise-data.ts", import.meta.url),
      "utf8",
    );
    expect(registry).toContain("createEnterpriseDataSarAdminHandlers");
    expect(registry).toContain("enterpriseDataSarAdminHandlers");
  });
});
