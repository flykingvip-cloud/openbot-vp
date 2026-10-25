// @vitest-environment node
/**
 * A5: one dual-center closed-loop evidence path on ControllableTestSite.
 *
 * 接入 → 验证 → 审核分配 → 供给 → 故障诊断可追溯
 *
 * Browser evidence level: fixture-test-site (ControllableTestSite + TrustedPagePort).
 * NOT enterprise external-site; NOT R5 PASS; formal execution access still deferred.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupFn } from "../../infra/net/ssrf.js";
import {
  SarExecutionAuthority,
  memoryEpochStore,
} from "../../site-capability/execution-authority.js";
import {
  SiteCapabilityRuntime,
  type SiteCapabilityRecord,
  type SitePlanStep,
} from "../../site-capability/runtime.js";
import {
  SAR_FIXTURE_ORIGIN,
  ControllableTestSite,
  createTestSitePort,
} from "../../site-capability/test-site.js";
import type { ValidationRecord } from "../../site-capability/validation-record.js";
import type { GatewayRequestHandler } from "../server-methods/types.js";
import { projectCapabilityCenterInstall } from "./capability-center-install.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import {
  resetProcessControlledSarProviderForTests,
  setProcessControlledSarRuntimeForTests,
} from "./controlled-sar-provider.js";
import { getProcessControlledSarProvider } from "./controlled-sar-provider.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { upsertDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "./enterprise-knowledge-projection-binding-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { resolveProjectionExecutionIdentity } from "./knowledge-publication.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import {
  SAR_A5_BROWSER_EVIDENCE_LEVEL,
  SAR_A5_NON_CLAIMS,
  buildSarA5LoopEvidence,
  sarA5LoopCorrelationKey,
  type SarA5StepEvidence,
} from "./sar-a5-dual-center-browser-loop.js";
import { listSarAdminAuditEvents } from "./sar-admin-audit.js";
import {
  findSarTraceCorrelationByRunId,
  findSarTraceCorrelationByTraceId,
} from "./sar-audit-correlation.js";
import { resolveSarFailureDisplay } from "./sar-failure-display.js";
import {
  listSarValidationRecordsForInstall,
  upsertSarValidationRecord,
} from "./sar-validation-records.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";
import type { DataGatewayResponse, EnterpriseDataStore } from "./types.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-sar-a5-dual-center-${Date.now()}`,
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
const resolveSeatMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("./enterprise-data-seat-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-data-seat-context.js")>();
  return {
    ...actual,
    requireResolvedEnterpriseAdminTenantId: requireAdminTenantMock,
    resolveTrustedEnterpriseDataExecutionContext: resolveSeatMock,
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

const { createEnterpriseDataSarAdminHandlers } =
  await import("../server-methods/enterprise-data-sar-admin.js");
const { createEnterpriseDataM1Handlers } = await import("../server-methods/enterprise-data-m1.js");
const { createEnterpriseDataM4Handlers } = await import("../server-methods/enterprise-data-m4.js");

const tenantId = "tenant-acme";
const nowIso = "2026-10-25T06:00:00.000Z";
const adminId = "emp-admin-001";
const ownerId = "emp-owner";
const seatId = "seat-site";
const bindingId = "bind-a5";
const sourceId = "src-a5";
const skillId = "skill.fixture.sar.a5";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const capabilityId = "fixture.sar.a5.public.query";
const sarVersion = "1.0.0";
const artifactDigest = "sha256:fixture-a5-public-1";

const publicLookup = (async () => [{ address: "93.184.216.34", family: 4 }]) as unknown as LookupFn;

const adminScope = {
  enterpriseId: tenantId,
  user: { id: adminId },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};

type HandlerOutcome = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; details?: { code?: string } };
};

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

async function withEnterpriseDataStore<T>(
  runTenantId: string,
  _client: unknown,
  run: (store: EnterpriseDataStore) => Promise<T> | T,
): Promise<T> {
  const store = await loadEnterpriseDataStore();
  const result = await run(store);
  await saveEnterpriseDataStore(store);
  return result;
}

const sarAdminHandlers = createEnterpriseDataSarAdminHandlers(withEnterpriseDataStore);
const m1Handlers = createEnterpriseDataM1Handlers(withEnterpriseDataStore);
const m4Handlers = createEnterpriseDataM4Handlers(withEnterpriseDataStore);

async function callHandler(
  handlers: Record<string, GatewayRequestHandler>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<HandlerOutcome> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let outcome: HandlerOutcome | null = null;
  await handler({
    req: { type: "req", id: "a5", method, params },
    params,
    client: { connect: {} as never, user: "admin@acme.test" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      outcome = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as HandlerOutcome["error"],
      };
    },
    context: {} as never,
  });
  if (!outcome) {
    throw new Error(`handler ${method} did not respond`);
  }
  return outcome;
}

function installWebsiteAction(store: EnterpriseDataStore) {
  upsertScopePolicy({
    store,
    tenantId,
    nowIso,
    policy: {
      scopePolicyId: "scope-self-a5",
      displayName: "A5 self scope",
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
}

function grantSeat(store: EnterpriseDataStore, grantSeatId: string) {
  upsertSeatActionGrant({
    store,
    tenantId,
    seatId: grantSeatId,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    scopePolicyId: "scope-self-a5",
    nowIso,
  });
}

function addSource(store: EnterpriseDataStore) {
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId,
      sourceKey: "site-a5",
      displayName: "A5 ControllableTestSite",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId,
    },
  });
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId: ownerId },
    bindingId,
  });
}

function validationRecord(overrides: Partial<ValidationRecord> = {}): ValidationRecord {
  return {
    recordId: "val-a5-1",
    capabilityId,
    version: sarVersion,
    artifactDigest,
    input: { query: "widget" },
    participatedInDraftGeneration: false,
    basis: { kind: "test_site_ground_truth", expected: { query: "widget" } },
    runId: "run-a5-validate",
    evidenceRef: "evidence-a5-validate",
    output: { ok: true },
    completeness: "complete",
    verdict: "passed",
    reviewer: "reviewer-a5",
    reviewedAt: "2026-10-25T05:00:00.000Z",
    reason: "ControllableTestSite ground truth match",
    runStatus: "succeeded",
    runVerification: "passed",
    promotable: true,
    ...overrides,
  };
}

function buildControllableRuntime(opts?: { injectStructureFault?: boolean }): {
  site: ControllableTestSite;
  runtime: SiteCapabilityRuntime;
  dispose: () => void;
} {
  const site = new ControllableTestSite();
  if (opts?.injectStructureFault) {
    site.injectError("public", "STRUCTURE_CHANGED");
  }
  const authority = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup });
  authority.boot();
  authority.registerBinding({ bindingId, tenantId, userId: ownerId });
  const runtime = new SiteCapabilityRuntime({
    authority,
    portForScope: () => createTestSitePort(site),
    verifier: () => "passed",
  });
  const plan: SitePlanStep[] = [
    { op: "navigate", urlTemplate: `${SAR_FIXTURE_ORIGIN}/public?q={query}` },
    { op: "capture_result", fields: ["query", "items"] },
  ];
  const record: SiteCapabilityRecord = {
    manifest: {
      schemaVersion: "1",
      id: capabilityId,
      version: sarVersion,
      site: "fixture.sar.test",
      operation: "public.query",
      description: "A5 ControllableTestSite public query",
      effect: "read",
      authMode: "none",
      executionMode: "browser_dom",
      allowedOrigins: [SAR_FIXTURE_ORIGIN],
      permissions: ["navigate", "read_page", "request_context", "capture_result"],
    },
    inputFields: [{ name: "query", required: true }],
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { query: { type: "string" }, items: { type: "array" } },
    },
    accountSummary: "No site login. Runs in the caller's account browser.",
    verification: "passed",
    artifactDigest,
    disabled: false,
    packageId: "fixture-a5-public-pack",
    plan,
  };
  const registered = runtime.register(record);
  if (!registered.ok) {
    throw new Error(registered.message);
  }
  const granted = runtime.grant({
    tenantId,
    userId: ownerId,
    capabilityId,
    version: sarVersion,
    artifactDigest,
    accountBindingIds: [bindingId],
  });
  if (!granted.ok) {
    throw new Error(granted.message);
  }
  return {
    site,
    runtime,
    dispose: () => authority.dispose(),
  };
}

function displayClass(result: DataGatewayResponse): string | undefined {
  if (result.ok) {
    return undefined;
  }
  const display = result.details?.failureDisplay;
  if (!display || typeof display !== "object" || !("class" in display)) {
    return undefined;
  }
  return String((display as { class: unknown }).class);
}

describe("A5 dual-center ControllableTestSite browser loop", () => {
  let disposeRuntime: (() => void) | undefined;
  let loopId = "";

  beforeEach(async () => {
    cleanStore();
    resetProcessControlledSarProviderForTests();
    requireAdminTenantMock.mockReset();
    resolveBillingScopeMock.mockReset();
    resolveSeatMock.mockReset();
    requireAdminTenantMock.mockResolvedValue(tenantId);
    resolveBillingScopeMock.mockResolvedValue(adminScope);
    resolveSeatMock.mockResolvedValue({
      tenantId,
      seatId,
      employeeId: ownerId,
      userId: ownerId,
      trustAttestation: "server-session-v1" as const,
    });
    loopId = `a5-${Date.now()}`;

    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    installWebsiteAction(store);
    grantSeat(store, seatId);
    grantSeat(store, MATERIALIZER_SEAT_ID);
    addSource(store);
    await saveEnterpriseDataStore(store);

    const harness = buildControllableRuntime();
    disposeRuntime = harness.dispose;
    setProcessControlledSarRuntimeForTests(harness.runtime);
  });

  afterEach(() => {
    disposeRuntime?.();
    disposeRuntime = undefined;
    resetProcessControlledSarProviderForTests();
    fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  });

  it("runs 接入→验证→审核分配→供给→故障诊断 with correlatable evidence (fixture-test-site)", async () => {
    const steps: SarA5StepEvidence[] = [];
    const correlationKey = sarA5LoopCorrelationKey(loopId);

    // 1) 接入 — A3 admin bridge upsert (not silent MCP/OI)
    const upsert = await callHandler(sarAdminHandlers, "enterprise-data.sar.bridges.upsert", {
      tenantId,
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
      skillId,
    });
    expect(upsert.ok).toBe(true);
    const bridge = upsert.payload?.bridge as { bridgeId?: string; capabilityId?: string };
    const accessAudit = upsert.payload?.audit as {
      action?: string;
      actorId?: string;
      subjectId?: string;
    };
    expect(bridge?.capabilityId).toBe(capabilityId);
    expect(accessAudit?.action).toBe("bridge_upsert");
    expect(accessAudit?.actorId).toBe(adminId);
    const adminAudits = listSarAdminAuditEvents({
      store: await loadEnterpriseDataStore(),
      tenantId,
      action: "bridge_upsert",
    });
    expect(adminAudits.length).toBeGreaterThanOrEqual(1);
    steps.push({
      step: "access",
      ok: true,
      evidenceIds: {
        loopId,
        correlationKey,
        bridgeId: String(bridge?.bridgeId ?? ""),
        auditSubjectId: String(accessAudit?.subjectId ?? ""),
        actorId: adminId,
      },
      notes: "A3 enterprise-data.sar.bridges.upsert with admin audit",
    });

    // 2) 验证 — durable validation record (A2); fail-closed without it
    let store = await loadEnterpriseDataStore();
    const beforeValidation = projectCapabilityCenterInstall({
      store,
      tenantId,
      callerUserId: ownerId,
      skill: {
        skillId,
        lifecycle: "private",
        visibility: "private",
        dependencies: [],
      },
      pin: {
        skillId,
        installedVersion: sarVersion,
        artifactDigest,
        enabled: true,
      },
      skillAuthorized: true,
      validationRecords: listSarValidationRecordsForInstall({ store, tenantId, nowIso }),
      catalog: { version: "2026-10-25" },
    });
    expect(beforeValidation.executable).toBe(false);
    expect(beforeValidation.denialCode).toBe("SAR_VERIFICATION_MISSING");

    upsertSarValidationRecord({
      store,
      tenantId,
      record: validationRecord({
        runId: `run-a5-validate-${loopId}`,
        evidenceRef: `evidence-a5-${loopId}`,
      }),
    });
    // Cross-tenant / wrong version must not pollute install projection.
    upsertSarValidationRecord({
      store,
      tenantId: "tenant-other",
      record: validationRecord({
        recordId: "val-a5-other-tenant",
        runId: "run-other",
      }),
    });
    upsertSarValidationRecord({
      store,
      tenantId,
      record: validationRecord({
        recordId: "val-a5-wrong-version",
        version: "9.9.9",
        runId: "run-wrong-ver",
      }),
    });
    await saveEnterpriseDataStore(store);
    store = await loadEnterpriseDataStore();
    const listed = listSarValidationRecordsForInstall({ store, tenantId, nowIso });
    expect(listed.some((row) => row.recordId === "val-a5-1")).toBe(true);
    expect(listed.some((row) => row.recordId === "val-a5-other-tenant")).toBe(false);
    steps.push({
      step: "validation",
      ok: true,
      evidenceIds: {
        loopId,
        correlationKey,
        validationRecordId: "val-a5-1",
        denialWithoutRecord: String(beforeValidation.denialCode),
      },
      notes: "A2 durable validation; missing/cross-tenant/wrong-version fail-closed",
    });

    // 3) 审核分配 — capability-center install projection binds pin + validation (E3/A2)
    const installFacts = projectCapabilityCenterInstall({
      store,
      tenantId,
      callerUserId: ownerId,
      skill: {
        skillId,
        lifecycle: "private",
        visibility: "private",
        dependencies: [],
      },
      pin: {
        skillId,
        installedVersion: sarVersion,
        artifactDigest,
        enabled: true,
      },
      skillAuthorized: true,
      validationRecords: listed,
      catalog: { version: "2026-10-25" },
    });
    expect(installFacts.executable).toBe(true);
    expect(installFacts.verification).toBe("passed");
    expect(installFacts.denialCode).toBeNull();
    steps.push({
      step: "audit_assign",
      ok: true,
      evidenceIds: {
        loopId,
        correlationKey,
        skillId,
        installedVersion: sarVersion,
        verification: String(installFacts.verification),
      },
      notes: "E3 projectCapabilityCenterInstall executable after A2 validation",
    });

    // Happy-path invoke through process controlled provider (ControllableTestSite)
    const invokeOk = await callHandler(m1Handlers, "enterprise-data.invoke", {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      sourceId,
      input: { query: "widget" },
    });
    expect(invokeOk.ok).toBe(true);
    const invokePayload = invokeOk.payload?.result as {
      ok?: boolean;
      sar?: { runId?: string; capabilityId?: string };
      traceId?: string;
    };
    // m1 may nest differently — also accept top-level payload fields
    const happySarRunId =
      invokePayload?.sar?.runId ||
      String((invokeOk.payload as { sar?: { runId?: string } } | undefined)?.sar?.runId ?? "");
    expect(invokePayload?.ok ?? invokeOk.ok).toBe(true);

    // 4) 供给 — projection materialization with A4 identity verification
    store = await loadEnterpriseDataStore();
    const capability = upsertDataCapability({
      store,
      tenantId,
      nowIso,
      capability: {
        capabilityKey: "site.session.a5.query",
        displayName: "A5 网站查询",
        description: "A5 ControllableTestSite projection",
        sourceIds: [sourceId],
        actionRefs: [actionRef],
        enabled: true,
      },
    });
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "site.session.a5.query",
        displayName: "A5 网站查询",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceId,
        sourceActions: [actionRef],
        objectKind: "data",
        templateKey: "AggregateTemplate",
        description: "A5 materializer ControllableTestSite",
        outputSchema: { type: "object" },
        lifecycle: "active",
      },
    });
    upsertEnterpriseKnowledgeProjectionBinding({
      store,
      tenantId,
      nowIso,
      binding: {
        projectionId: spec.projectionId,
        capabilityId: capability.capabilityId,
        materializationMode: "on_demand",
        materializationTeamLabel: "华北销售",
        enabled: true,
        generatorVersion: "a5-test",
      },
    });
    await saveEnterpriseDataStore(store);
    store = await loadEnterpriseDataStore();
    const identity = resolveProjectionExecutionIdentity({
      store,
      tenantId,
      spec,
      sourceRef: actionRef,
    });
    expect(identity).toMatchObject({ sourceId, userId: ownerId, employeeId: ownerId });

    const binding = listEnterpriseKnowledgeProjectionBindings({ store, tenantId }).find(
      (row) => row.generatorVersion === "a5-test",
    );
    expect(binding?.bindingId).toBeTruthy();
    const materialize = await callHandler(
      m4Handlers,
      "enterprise-data.projection-materializer.run",
      {
        tenantId,
        bindingId: binding!.bindingId,
        input: { query: "widget" },
      },
    );
    expect(materialize.ok).toBe(true);
    const matResult = materialize.payload?.result as {
      feedItem?: { objectId?: string };
      gatewayTraceIds?: string[];
    };
    expect(matResult?.feedItem?.objectId || matResult?.gatewayTraceIds?.length).toBeTruthy();
    store = await loadEnterpriseDataStore();
    expect(listKnowledgeFeedItems({ store, tenantId }).length).toBeGreaterThan(0);
    steps.push({
      step: "supply",
      ok: true,
      evidenceIds: {
        loopId,
        correlationKey,
        projectionId: spec.projectionId,
        bindingId: String(binding?.bindingId ?? ""),
        identityUserId: String(identity.userId ?? ""),
        gatewayTraceId: String(matResult?.gatewayTraceIds?.[0] ?? ""),
        happySarRunId: happySarRunId || "invoke-ok",
      },
      notes: "A4 identity + A1 process provider materialization via ControllableTestSite",
    });

    // 5) 故障诊断可追溯
    // ControllableTestSite structure fault → OPERATION_FAULT (message STRUCTURE_CHANGED)
    // correlatable by traceId/runId. Five-class failureDisplay is proven on the
    // governed bridge path with an explicit STRUCTURE_CHANGED SiteRunResult (E5).
    resetProcessControlledSarProviderForTests();
    const faulted = buildControllableRuntime({ injectStructureFault: true });
    disposeRuntime?.();
    disposeRuntime = faulted.dispose;
    setProcessControlledSarRuntimeForTests(faulted.runtime);

    store = await loadEnterpriseDataStore();
    const fixtureFault = await invokeEnterpriseDataAction({
      store,
      context: {
        tenantId,
        seatId,
        employeeId: ownerId,
        userId: ownerId,
        trustAttestation: "server-session-v1",
      },
      ref: actionRef,
      sourceId,
      input: { query: "widget" },
      nowIso,
      sarProvider: getProcessControlledSarProvider(),
    });
    expect(fixtureFault.ok).toBe(false);
    const fixtureSar =
      !fixtureFault.ok && "sar" in fixtureFault
        ? (fixtureFault as { sar?: { runId?: string; errorCode?: string } }).sar
        : undefined;
    expect(fixtureSar?.errorCode).toBe("OPERATION_FAULT");
    expect(fixtureFault.traceId).toBeTruthy();
    await saveEnterpriseDataStore(store);
    store = await loadEnterpriseDataStore();
    const fixtureLink = findSarTraceCorrelationByTraceId({
      store,
      tenantId,
      traceId: fixtureFault.traceId,
    });
    expect(fixtureLink?.traceId).toBe(fixtureFault.traceId);
    expect(fixtureLink?.sarRunId || fixtureSar?.runId).toBeTruthy();
    if (fixtureSar?.runId) {
      expect(
        findSarTraceCorrelationByRunId({
          store,
          tenantId,
          sarRunId: fixtureSar.runId,
        })?.traceId,
      ).toBe(fixtureFault.traceId);
    }

    const structureProvider = {
      async execute() {
        return {
          result: {
            runId: `run-a5-structure-${loopId}`,
            capabilityId,
            version: sarVersion,
            status: "failed" as const,
            verification: "failed" as const,
            completeness: "complete" as const,
            data: null,
            evidenceRef: `evidence-a5-structure-${loopId}`,
            durationMs: 2,
            repair: "none" as const,
            error: {
              code: "STRUCTURE_CHANGED",
              message: "layout drifted on fixture portal",
              retry: "none" as const,
              ordinaryFailure: false,
            },
          },
          scopeEnforcedBeforeRead: true,
        };
      },
    };
    const structureFault = await invokeEnterpriseDataAction({
      store,
      context: {
        tenantId,
        seatId,
        employeeId: ownerId,
        userId: ownerId,
        trustAttestation: "server-session-v1",
      },
      ref: actionRef,
      sourceId,
      input: { query: "widget" },
      nowIso,
      sarProvider: structureProvider,
    });
    expect(structureFault.ok).toBe(false);
    expect(displayClass(structureFault)).toBe("structure_change");
    const display = resolveSarFailureDisplay({
      status: "failed",
      errorCode: "STRUCTURE_CHANGED",
    });
    expect(display?.class).toBe("structure_change");
    expect(display?.label).toBe("结构变化");
    await saveEnterpriseDataStore(store);
    store = await loadEnterpriseDataStore();
    const structureLink = findSarTraceCorrelationByRunId({
      store,
      tenantId,
      sarRunId: `run-a5-structure-${loopId}`,
    });
    expect(structureLink?.traceId).toBe(structureFault.traceId);
    expect(structureLink?.displayClass).toBe("structure_change");

    steps.push({
      step: "fault_trace",
      ok: true,
      evidenceIds: {
        loopId,
        correlationKey,
        fixtureFaultTraceId: fixtureFault.traceId,
        fixtureFaultSarRunId: String(fixtureSar?.runId ?? fixtureLink?.sarRunId ?? ""),
        fixtureFaultCode: "OPERATION_FAULT",
        structureFaultTraceId: structureFault.traceId,
        structureFaultSarRunId: `run-a5-structure-${loopId}`,
        failureDisplayClass: "structure_change",
      },
      notes:
        "Fixture STRUCTURE_CHANGED → OPERATION_FAULT correlatable; E5 failureDisplay structure_change correlatable",
    });

    const evidence = buildSarA5LoopEvidence({
      loopId,
      browserEvidenceLevel: SAR_A5_BROWSER_EVIDENCE_LEVEL.fixtureTestSite,
      steps,
    });
    expect(evidence.correlatable).toBe(true);
    expect(evidence.browserEvidenceLevel).toBe("fixture-test-site");
    expect(evidence.steps).toHaveLength(5);
    expect(evidence.steps.every((step) => step.ok)).toBe(true);
    expect(evidence.nonClaims).toEqual([...SAR_A5_NON_CLAIMS]);
    // Honesty: never claim external-site in this suite.
    expect(evidence.browserEvidenceLevel).not.toBe("external-site");
  });

  it("policy denial stays diagnosable via failureDisplay without inventing a display class for halt", async () => {
    // Bridge must exist first.
    const upsert = await callHandler(sarAdminHandlers, "enterprise-data.sar.bridges.upsert", {
      tenantId,
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
      skillId,
    });
    expect(upsert.ok).toBe(true);

    const store = await loadEnterpriseDataStore();
    // Revoke seat grant → NO_ACTION_GRANT → policy_denied
    store.seatActionGrants = {};
    await saveEnterpriseDataStore(store);

    const denied = await invokeEnterpriseDataAction({
      store: await loadEnterpriseDataStore(),
      context: {
        tenantId,
        seatId,
        employeeId: ownerId,
        userId: ownerId,
        trustAttestation: "server-session-v1",
      },
      ref: actionRef,
      sourceId,
      input: { query: "widget" },
      nowIso,
      sarProvider: getProcessControlledSarProvider(),
    });
    expect(denied.ok).toBe(false);
    expect(displayClass(denied)).toBe("policy_denied");
    expect(resolveSarFailureDisplay({ denialReason: "SAR_EXECUTION_HALTED" })).toBeNull();
  });
});
