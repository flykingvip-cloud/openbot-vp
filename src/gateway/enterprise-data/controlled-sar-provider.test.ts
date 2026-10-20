// @vitest-environment node
/**
 * A1 production-entry-path tests.
 *
 * Goes through registered gateway handlers (enterprise-data.invoke /
 * projection-materializer.run). ControllableTestSite backs the real controlled
 * provider via process runtime override — not a mock SarGovernanceProvider
 * stuffed into invoke params.
 */
import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LookupFn } from "../../infra/net/ssrf.js";
import { SarExecutionAuthority, memoryEpochStore } from "../../site-capability/execution-authority.js";
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
import type { GatewayRequestHandler, GatewayRequestHandlerOptions } from "../server-methods/types.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { registerCallerAccountBinding } from "./data-asset-linkage.js";
import {
  createControlledSarProvider,
  getProcessControlledSarProvider,
  resetProcessControlledSarProviderForTests,
  setProcessControlledSarRuntimeForTests,
} from "./controlled-sar-provider.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import {
  listEnterpriseKnowledgeProjectionBindings,
  upsertEnterpriseKnowledgeProjectionBinding,
} from "./enterprise-knowledge-projection-binding-store.js";
import { upsertDataCapability } from "./data-capability-store.js";
import { upsertDataSource } from "./data-source-store.js";
import { listKnowledgeFeedItems } from "./knowledge-feed-item-store.js";
import { upsertEnterpriseKnowledgeProjectionSpec } from "./projection-spec-store.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertSarExecutionBridge } from "./sar-governance-bridge.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import {
  loadEnterpriseDataStore,
  normalizeEnterpriseDataStore,
  saveEnterpriseDataStore,
} from "./store.js";
import type { EnterpriseDataStore } from "./types.js";

const testPaths = vi.hoisted(() => ({
  tmpDir: `/tmp/openbot-sar-a1-provider-wire-${Date.now()}`,
}));

vi.mock("../../utils.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils.js")>();
  return {
    ...actual,
    CONFIG_DIR: testPaths.tmpDir,
  };
});

const resolveBillingScopeMock = vi.hoisted(() => vi.fn());
const resolveSeatMock = vi.hoisted(() => vi.fn());

vi.mock("../billing/scope.js", () => ({
  resolveBillingScope: resolveBillingScopeMock,
}));

vi.mock("./enterprise-data-seat-context.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./enterprise-data-seat-context.js")>();
  return {
    ...actual,
    resolveTrustedEnterpriseDataExecutionContext: resolveSeatMock,
  };
});

vi.mock("../protocol/index.js", () => ({
  ErrorCodes: { INVALID_REQUEST: "INVALID_REQUEST" },
  errorShape: (code: string, message: string, extra?: { details?: unknown }) => ({
    code,
    message,
    ...extra,
  }),
}));

const { createEnterpriseDataM1Handlers } = await import("../server-methods/enterprise-data-m1.js");
const { createEnterpriseDataM4Handlers } = await import("../server-methods/enterprise-data-m4.js");

const tenantId = "tenant-acme";
const nowIso = "2026-10-18T02:00:00.000Z";
const seatId = "seat-site";
const employeeId = "emp-owner";
const userId = "emp-owner";
const bindingId = "bind-a1";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const capabilityId = "fixture.sar.a1.public.query";
const sarVersion = "1.0.0";
const artifactDigest = "sha256:fixture-a1-public-1";

const publicLookup = (async () => [
  { address: "93.184.216.34", family: 4 },
]) as unknown as LookupFn;

const adminScope = {
  enterpriseId: tenantId,
  user: { id: "emp-admin-001" },
  membership: null,
  isEnterpriseAdmin: true,
  permissions: new Set(["operator"]),
};

type InvokeResult = {
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: { message?: string; code?: string; details?: { code?: string } };
  responseCount: number;
};

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

const m1Handlers = createEnterpriseDataM1Handlers(withEnterpriseDataStore);
const m4Handlers = createEnterpriseDataM4Handlers(withEnterpriseDataStore);

function cleanStore() {
  fs.rmSync(testPaths.tmpDir, { recursive: true, force: true });
  fs.mkdirSync(testPaths.tmpDir, { recursive: true });
}

function trustedContext() {
  return {
    tenantId,
    seatId,
    employeeId,
    userId,
    trustAttestation: "server-session-v1" as const,
  };
}

function installWebsiteAction(store: EnterpriseDataStore, grantSeatId: string) {
  upsertScopePolicy({
    store,
    tenantId,
    nowIso,
    policy: {
      scopePolicyId: "scope-self-a1",
      displayName: "A1 self scope",
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
    seatId: grantSeatId,
    connectorId: actionRef.connectorId,
    actionKey: actionRef.actionKey,
    version: actionRef.version,
    scopePolicyId: "scope-self-a1",
    nowIso,
  });
}

function addSourceAndBridge(store: EnterpriseDataStore) {
  upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId: "src-a1",
      sourceKey: "site-a1",
      displayName: "A1 test site",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId,
    },
  });
  registerCallerAccountBinding({
    store,
    caller: { tenantId, userId },
    bindingId,
  });
  upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId: "src-a1",
      actionRef,
      capabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId,
      userId,
      verification: "passed",
      effect: "read",
      supportedScopeTypes: ["SELF"],
      enforcedFilterFields: [],
    },
  });
}

function buildControllableRuntime(): {
  site: ControllableTestSite;
  runtime: SiteCapabilityRuntime;
  dispose: () => void;
} {
  const site = new ControllableTestSite();
  const authority = new SarExecutionAuthority(memoryEpochStore(), { lookupFn: publicLookup });
  authority.boot();
  authority.registerBinding({ bindingId, tenantId, userId });
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
      description: "A1 ControllableTestSite public query",
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
    packageId: "fixture-a1-public-pack",
    plan,
  };
  const registered = runtime.register(record);
  if (!registered.ok) {
    throw new Error(registered.message);
  }
  const granted = runtime.grant({
    tenantId,
    userId,
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

async function invokeHandler(
  handlers: Record<string, GatewayRequestHandler>,
  method: string,
  params: Record<string, unknown> = {},
): Promise<InvokeResult> {
  const handler = handlers[method];
  if (!handler) {
    throw new Error(`missing handler ${method}`);
  }
  let response: InvokeResult | null = null;
  await handler({
    req: { type: "req", id: "a1-test", method, params },
    params,
    client: { connect: {} as never, user: "owner@acme.test" },
    isWebchatConnect: () => false,
    respond: (ok, payload, error) => {
      response = {
        ok,
        payload: payload as Record<string, unknown> | undefined,
        error: error as InvokeResult["error"],
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

describe("A1 controlled SAR provider (unit)", () => {
  afterEach(() => {
    resetProcessControlledSarProviderForTests();
  });

  it("refuses to claim scopeEnforcedBeforeRead when appliedFilters are present", async () => {
    const provider = createControlledSarProvider();
    const executed = await provider.execute({
      tenantId,
      userId,
      bindingId,
      capabilityId,
      version: sarVersion,
      artifactDigest,
      actionRef,
      scope: {
        scopeType: "TEAM",
        appliedFilters: [
          { field: "customer.owner_team", operator: "eq", valueRef: "current_user.team" },
        ],
        resolvedValues: { "current_user.team": "华北销售" },
        scopeAppliedLabel: "TEAM",
      },
    });
    expect(executed.scopeEnforcedBeforeRead).toBe(false);
    expect(executed.result.status).toBe("failed");
    expect(executed.result.data).toBeNull();
  });
});

describe("A1 production entry path via enterprise-data.invoke", () => {
  let disposeRuntime: (() => void) | undefined;

  beforeEach(async () => {
    cleanStore();
    resetProcessControlledSarProviderForTests();
    resolveSeatMock.mockReset();
    resolveSeatMock.mockResolvedValue(trustedContext());
    resolveBillingScopeMock.mockReset();
    resolveBillingScopeMock.mockResolvedValue(adminScope);

    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    installWebsiteAction(store, seatId);
    addSourceAndBridge(store);
    await saveEnterpriseDataStore(store);

    const harness = buildControllableRuntime();
    disposeRuntime = harness.dispose;
    setProcessControlledSarRuntimeForTests(harness.runtime);
  });

  afterEach(() => {
    disposeRuntime?.();
    disposeRuntime = undefined;
    resetProcessControlledSarProviderForTests();
  });

  it("reads ControllableTestSite through the registered invoke handler (no client provider)", async () => {
    const response = await invokeHandler(m1Handlers, "enterprise-data.invoke", {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      sourceId: "src-a1",
      input: { query: "widget" },
    });
    expect(response.ok).toBe(true);
    const result = response.payload?.result as {
      ok?: boolean;
      data?: unknown;
      sar?: { runId?: string; capabilityId?: string; version?: string };
    };
    expect(result?.ok).toBe(true);
    expect(result?.sar?.runId).toBeTruthy();
    expect(result?.sar?.capabilityId).toBe(capabilityId);
    expect(result?.sar?.version).toBe(sarVersion);
    // Gateway masking may redact fixture fields; success + SAR correlation prove the site was read.
    expect(result?.data).toBeTruthy();
    // Client cannot supply sarProvider; params must not be the injection path.
    expect(JSON.stringify(response.payload)).not.toContain("providerFor");
  });

  it("still fail-closes with SAR_HANDLER_MISSING when the execution bridge is absent", async () => {
    const store = await loadEnterpriseDataStore();
    store.sarExecutionBridges = {};
    await saveEnterpriseDataStore(store);

    const response = await invokeHandler(m1Handlers, "enterprise-data.invoke", {
      connectorId: actionRef.connectorId,
      actionKey: actionRef.actionKey,
      version: actionRef.version,
      sourceId: "src-a1",
      input: { query: "widget" },
    });
    expect(response.ok).toBe(false);
    const result = response.payload?.result as { ok?: boolean; code?: string };
    expect(result?.ok).toBe(false);
    expect(result?.code).toBe("SAR_HANDLER_MISSING");
  });
});

describe("A1 production entry path via projection-materializer.run", () => {
  let disposeRuntime: (() => void) | undefined;

  beforeEach(async () => {
    cleanStore();
    resetProcessControlledSarProviderForTests();
    resolveSeatMock.mockReset();
    resolveBillingScopeMock.mockReset();
    resolveBillingScopeMock.mockResolvedValue(adminScope);

    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    installWebsiteAction(store, MATERIALIZER_SEAT_ID);
    addSourceAndBridge(store);
    const capability = upsertDataCapability({
      store,
      tenantId,
      nowIso,
      capability: {
        capabilityKey: "site.session.a1.query",
        displayName: "A1 网站查询",
        description: "ControllableTestSite projection source",
        sourceIds: ["src-a1"],
        actionRefs: [actionRef],
        enabled: true,
      },
    });
    const spec = upsertEnterpriseKnowledgeProjectionSpec({
      store,
      tenantId,
      nowIso,
      spec: {
        projectionKey: "site.session.a1.query",
        displayName: "A1 网站查询",
        category: "customer",
        capabilityId: capability.capabilityId,
        sourceId: "src-a1",
        sourceActions: [actionRef],
        objectKind: "data",
        templateKey: "AggregateTemplate",
        description: "A1 materializer ControllableTestSite",
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
        generatorVersion: "a1-test",
      },
    });
    await saveEnterpriseDataStore(store);

    const harness = buildControllableRuntime();
    disposeRuntime = harness.dispose;
    setProcessControlledSarRuntimeForTests(harness.runtime);
  });

  afterEach(() => {
    disposeRuntime?.();
    disposeRuntime = undefined;
    resetProcessControlledSarProviderForTests();
  });

  it("materializes from ControllableTestSite through the registered materializer handler", async () => {
    const storeBefore = await loadEnterpriseDataStore();
    const binding = listEnterpriseKnowledgeProjectionBindings({
      store: storeBefore,
      tenantId,
    }).find((row) => row.generatorVersion === "a1-test");
    expect(binding?.bindingId).toBeTruthy();

    const response = await invokeHandler(m4Handlers, "enterprise-data.projection-materializer.run", {
      tenantId,
      bindingId: binding!.bindingId,
      input: { query: "widget" },
    });
    expect(response.ok).toBe(true);
    const result = response.payload?.result as {
      feedItem?: { title?: string; objectId?: string };
      gatewayTraceIds?: string[];
    };
    expect(result?.feedItem?.objectId).toBeTruthy();
    expect(result?.gatewayTraceIds?.length).toBeGreaterThan(0);

    const storeAfter = await loadEnterpriseDataStore();
    const feeds = listKnowledgeFeedItems({ store: storeAfter, tenantId });
    expect(feeds.length).toBeGreaterThan(0);
  });
});

describe("A1 wiring honesty checks", () => {
  it("injects the process provider in m1/m4/on-demand/scheduled and does not accept client providers", () => {
    const m1 = fs.readFileSync(
      new URL("../server-methods/enterprise-data-m1.ts", import.meta.url),
      "utf8",
    );
    const m4 = fs.readFileSync(
      new URL("../server-methods/enterprise-data-m4.ts", import.meta.url),
      "utf8",
    );
    const onDemand = fs.readFileSync(
      new URL("./on-demand-projection-materializer.ts", import.meta.url),
      "utf8",
    );
    const scheduled = fs.readFileSync(
      new URL("./scheduled-projection-materializer.ts", import.meta.url),
      "utf8",
    );
    const provider = fs.readFileSync(new URL("./controlled-sar-provider.ts", import.meta.url), "utf8");
    expect(m1).toContain("getProcessControlledSarProvider");
    expect(m4).toContain("getProcessControlledSarProvider");
    expect(onDemand).toContain("getProcessControlledSarProvider");
    expect(scheduled).toContain("getProcessControlledSarProvider");
    expect(m1).not.toContain("params.sarProvider");
    expect(m4).not.toContain("params.sarProvider");
    expect(provider).not.toMatch(/executeMockHandler\s*\(/);
    expect(provider).not.toMatch(/from\s+["'].*mock-handlers/);
    expect(provider).not.toContain("BROWSER_BRIDGES.set");
    expect(getProcessControlledSarProvider()).toBeTruthy();
  });
});
