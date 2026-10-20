import fs from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { findDataConnectorDefinition } from "./connector-catalog.js";
import { upsertDataConnectorCredential } from "./connector-credential-store.js";
import { executeConnectorHandlerAsync } from "./connector-handler-runtime.js";
import { ensureConnectorPackage } from "./connector-packages.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { findDataSourceByKey, upsertDataSource } from "./data-source-store.js";
import { createTrustedExecutionContextForTest } from "./enterprise-data-seat-context.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import { upsertSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { probeDataSourceConnection } from "./source-connection-probe.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { EnterpriseDataStore, EnterpriseSarExecutionBridge } from "./types.js";

const captured = vi.hoisted(() => ({
  secrets: new Map<string, { apiKey?: string; oauthAccessToken?: string; instanceUrl?: string }>(),
  salesforceKeys: [] as string[],
}));

vi.mock("./connector-credential-vault.js", () => ({
  loadCredentialSecret: async (id: string) => captured.secrets.get(id) ?? null,
  saveCredentialSecret: async () => undefined,
  deleteCredentialSecret: async () => undefined,
}));

vi.mock("./adapters/salesforce.js", () => ({
  executeSalesforceHandler: async (
    _handlerRef: string,
    _input: unknown,
    secret: { apiKey?: string; oauthAccessToken?: string },
  ) => {
    captured.salesforceKeys.push(secret.oauthAccessToken ?? secret.apiKey ?? "");
    return { payload: { customer: { id: "cust-1", name: "Acme" } } };
  },
  probeSalesforceConnection: async () => ({ ok: false, message: "unused" }),
}));

const tenantId = "tenant-acme";
const nowIso = "2026-10-17T12:00:00.000Z";
const seatId = "seat-site";
const employeeId = "emp-owner";
const actionRef = {
  connectorId: "site-session",
  actionKey: "site.session.read",
  version: "v1",
};
const capabilityId = "fixture.site.session.read";
const sarVersion = "2026.10.17";
const artifactDigest = "digest-verified-1";

function trusted(userId = employeeId) {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId,
    employeeId,
    userId,
  });
}

function readResult(overrides: Partial<SiteRunResult> = {}): SiteRunResult {
  return {
    runId: "run-1",
    capabilityId,
    version: sarVersion,
    status: "succeeded",
    verification: "passed",
    completeness: "complete",
    data: [{ id: "row-1" }],
    evidenceRef: "evidence-1",
    durationMs: 4,
    repair: "none",
    ...overrides,
  };
}

type RecordedCall = {
  bindingId: string;
  capabilityId: string;
  version: string;
  artifactDigest: string;
};

function providerFor(
  calls: RecordedCall[],
  result: SiteRunResult,
  scopeEnforcedBeforeRead = true,
): SarGovernanceProvider {
  return {
    async execute(input) {
      calls.push({
        bindingId: input.bindingId,
        capabilityId: input.capabilityId,
        version: input.version,
        artifactDigest: input.artifactDigest,
      });
      return { result, scopeEnforcedBeforeRead };
    },
  };
}

function installWebsiteAction(store: EnterpriseDataStore, scopePolicyId = "scope-self") {
  upsertScopePolicy({
    store,
    tenantId,
    nowIso,
    policy: {
      scopePolicyId,
      displayName: scopePolicyId,
      scopeType: scopePolicyId === "scope-team" ? "TEAM" : "SELF",
      filterClauses:
        scopePolicyId === "scope-filtered"
          ? [{ field: "customer.owner_id", operator: "eq", valueRef: "current_user.id" }]
          : undefined,
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
    scopePolicyId,
    nowIso,
  });
}

function addSource(
  store: EnterpriseDataStore,
  source: {
    sourceId: string;
    sourceKey: string;
    bindingId: string;
    category?: "crm" | "erp" | "external";
  },
) {
  return upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId: source.sourceId,
      sourceKey: source.sourceKey,
      displayName: source.sourceKey,
      category: source.category ?? "external",
      status: "connected",
      connectorId: "site-session",
      bindingId: source.bindingId,
    },
  });
}

function addBridge(
  store: EnterpriseDataStore,
  overrides: Partial<EnterpriseSarExecutionBridge> & { sourceId: string; bindingId: string },
) {
  return upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId: overrides.sourceId,
      actionRef,
      capabilityId,
      version: sarVersion,
      artifactDigest,
      bindingId: overrides.bindingId,
      userId: overrides.userId ?? employeeId,
      verification: overrides.verification ?? "passed",
      effect: "read",
      supportedScopeTypes: overrides.supportedScopeTypes ?? ["SELF"],
      enforcedFilterFields: overrides.enforcedFilterFields ?? [],
      skillId: overrides.skillId,
    },
  });
}

describe("E1 SAR governance bridge", () => {
  it("keeps website session metadata outside api_key credentials", () => {
    const site = findDataConnectorDefinition("site-session");
    expect(site?.accessMethod).toBe("website_session");
    expect(site?.credentialKind).toBe("none");
    expect(site?.category).toBe("external");
    expect(findDataConnectorDefinition("crm-salesforce")?.category).toBe("crm");
    expect(findDataConnectorDefinition("crm-salesforce")?.accessMethod).toBe("credential");
    expect(findDataConnectorDefinition("erp-sap")?.category).toBe("erp");
    const store = normalizeEnterpriseDataStore(null);
    expect(() =>
      upsertDataConnectorCredential({
        store,
        tenantId,
        connectorId: "site-session",
        label: "disguised",
        kind: "api_key",
        nowIso,
      }),
    ).toThrow(EnterpriseDataStoreError);
    expect(() =>
      ensureConnectorPackage({ store, tenantId, connectorId: "site-session", nowIso }),
    ).toThrow(/does not support package installation/);
  });

  it("does not execute when the seat has no grant", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    delete store.seatActionGrants[Object.keys(store.seatActionGrants)[0] ?? ""];
    addSource(store, {
      sourceId: "src-a",
      sourceKey: "site-a",
      bindingId: "bind-a",
      category: "crm",
    });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a" });
    const calls: RecordedCall[] = [];
    const result = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(calls, readResult()),
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("NO_ACTION_GRANT");
    expect(calls).toHaveLength(0);
  });

  it("resolves two website instances by sourceId and does not cross bindings", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    addSource(store, {
      sourceId: "src-a",
      sourceKey: "site-a",
      bindingId: "bind-a",
      category: "crm",
    });
    addSource(store, {
      sourceId: "src-b",
      sourceKey: "site-b",
      bindingId: "bind-b",
      category: "erp",
    });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a" });
    addBridge(store, { sourceId: "src-b", bindingId: "bind-b" });
    expect(() =>
      addSource(store, { sourceId: "src-c", sourceKey: "site-c", bindingId: "bind-a" }),
    ).toThrow(/already used/);
    const calls: RecordedCall[] = [];
    const provider = providerFor(calls, readResult());
    const first = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: provider,
    });
    const second = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-b",
      nowIso,
      sarProvider: provider,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(calls.map((call) => call.bindingId)).toEqual(["bind-a", "bind-b"]);
    expect(calls[0]?.artifactDigest).toBe(artifactDigest);
    if (first.ok) {
      expect(first.sar?.runId).toBe("run-1");
      expect(first.traceId).not.toBe(first.sar?.runId);
      expect(first.sar?.completeness).toBe("complete");
      expect(first.sar?.verification).toBe("passed");
    }
    const audit = Object.values(store.invocationAuditEvents).find(
      (event) => event.traceId === (first.ok ? first.traceId : ""),
    );
    expect(audit?.status).toBe("SUCCESS");
    expect(audit?.sarRunId).toBe("run-1");
    expect(audit?.traceId).not.toBe(audit?.sarRunId);
    expect(store.enterpriseKnowledgeProjectionSpecs).toEqual({});
    expect(store.knowledgeFeedItems).toEqual({});
  });

  it("preserves partial, unknown, and not_performed instead of a complete success", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    addSource(store, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a" });
    const cases: Array<Partial<SiteRunResult>> = [
      {
        status: "succeeded",
        verification: "passed",
        completeness: "partial",
        data: [{ id: "partial-row-secret" }],
      },
      {
        status: "unknown",
        verification: "not_performed",
        completeness: "partial",
        error: {
          code: "RESULT_UNKNOWN",
          message: "unknown",
          retry: "not_ordinary",
          ordinaryFailure: false,
        },
      },
      { status: "succeeded", verification: "not_performed", completeness: "complete" },
    ];
    for (const item of cases) {
      const calls: RecordedCall[] = [];
      const result = await invokeEnterpriseDataAction({
        store,
        context: trusted(),
        ref: actionRef,
        sourceId: "src-a",
        nowIso,
        sarProvider: providerFor(calls, readResult(item)),
      });
      expect(result.ok).toBe(false);
      if (result.ok) {
        return;
      }
      expect(result.code).toBe("SAR_OUTCOME_PRESERVED");
      expect(result.sar?.status).toBe(item.status);
      expect(result.sar?.verification).toBe(item.verification);
      expect(result.sar?.completeness).toBe(item.completeness);
      expect(JSON.stringify(result)).not.toContain("row-1");
      expect(JSON.stringify(result)).not.toContain("partial-row-secret");
      expect(result.sar?.runId).toBe("run-1");
      expect(result.traceId).not.toBe(result.sar?.runId);
      if (item.status === "unknown") {
        expect(result.sar?.retry).toBe("not_ordinary");
        expect(result.sar?.ordinaryFailure).toBe(false);
      }
      const audit = Object.values(store.invocationAuditEvents).find(
        (event) => event.traceId === result.traceId,
      );
      expect(audit?.status).toBe("PRESERVED");
      expect(audit?.status).not.toBe("SUCCESS");
      expect(calls).toHaveLength(1);
    }
  });

  it("fails closed without a binding, handler, or verification and does not mock", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    addSource(store, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    const calls: RecordedCall[] = [];
    const provider = providerFor(calls, readResult());
    const missingBridge = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: provider,
    });
    expect(missingBridge.ok).toBe(false);
    if (!missingBridge.ok) {
      expect(missingBridge.code).toBe("SAR_HANDLER_MISSING");
    }
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a", verification: "unverified" });
    const unverified = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: provider,
    });
    expect(unverified.ok).toBe(false);
    if (!unverified.ok) {
      expect(unverified.code).toBe("SAR_VERIFICATION_MISSING");
    }
    const bridge = Object.values(store.sarExecutionBridges ?? [])[0];
    if (bridge) {
      bridge.verification = "passed";
    }
    const noProvider = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
    });
    expect(noProvider.ok).toBe(false);
    if (!noProvider.ok) {
      expect(noProvider.code).toBe("SAR_HANDLER_MISSING");
      expect(noProvider.message).not.toMatch(/mock_smoke_ok/);
    }
    const source = store.dataSources["src-a"];
    expect(source).toBeTruthy();
    if (source) {
      source.bindingId = undefined;
    }
    const missingBinding = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: provider,
    });
    expect(missingBinding.ok).toBe(false);
    if (!missingBinding.ok) {
      expect(missingBinding.code).toBe("SAR_BINDING_MISSING");
    }
    expect(calls).toHaveLength(0);
    await expect(
      executeConnectorHandlerAsync(
        "enterprise-data/sar-bridge/read",
        {
          input: {},
          scope: {
            scopeType: "SELF",
            appliedFilters: [],
            resolvedValues: {},
            scopeAppliedLabel: "本人数据",
          },
          employeeId,
        },
        { connectorId: "site-session", accessMethod: "website_session" },
      ),
    ).rejects.toThrow(/cannot fall back to mock/);
    const probe = await probeDataSourceConnection({
      store,
      tenantId,
      connectorId: "site-session",
    });
    expect(probe.ok).toBe(false);
    expect(probe.mode).toBe("website_session_not_verified");
    expect(probe.mode).not.toBe("mock_smoke_ok");
  });

  it("rejects unsupported scope before read and drops an unenforced read", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store, "scope-team");
    addSource(store, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a", supportedScopeTypes: ["SELF"] });
    const calls: RecordedCall[] = [];
    const unsupported = await invokeEnterpriseDataAction({
      store,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId,
        employeeId,
        userId: employeeId,
        teamLabel: "华东",
      }),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(calls, readResult()),
    });
    expect(unsupported.ok).toBe(false);
    if (!unsupported.ok) {
      expect(unsupported.code).toBe("SAR_SCOPE_UNSUPPORTED");
    }
    expect(calls).toHaveLength(0);

    const filtered = normalizeEnterpriseDataStore(null);
    installWebsiteAction(filtered, "scope-filtered");
    addSource(filtered, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(filtered, {
      sourceId: "src-a",
      bindingId: "bind-a",
      enforcedFilterFields: [],
    });
    const filterCalls: RecordedCall[] = [];
    const filterDenied = await invokeEnterpriseDataAction({
      store: filtered,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(filterCalls, readResult()),
    });
    expect(filterDenied.ok).toBe(false);
    if (!filterDenied.ok) {
      expect(filterDenied.code).toBe("SAR_SCOPE_UNSUPPORTED");
    }
    expect(filterCalls).toHaveLength(0);

    const overread = normalizeEnterpriseDataStore(null);
    installWebsiteAction(overread);
    addSource(overread, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(overread, { sourceId: "src-a", bindingId: "bind-a" });
    const overCalls: RecordedCall[] = [];
    const dropped = await invokeEnterpriseDataAction({
      store: overread,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(overCalls, readResult({ data: [{ secret: "row" }] }), false),
    });
    expect(dropped.ok).toBe(false);
    if (!dropped.ok) {
      expect(dropped.code).toBe("SAR_SCOPE_UNSUPPORTED");
      expect(JSON.stringify(dropped)).not.toContain("secret");
    }
    expect(overCalls).toHaveLength(1);
  });

  it("does not share a private binding with another user and refuses write effects", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    addSource(store, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a", userId: employeeId });
    const calls: RecordedCall[] = [];
    const result = await invokeEnterpriseDataAction({
      store,
      context: trusted("enterprise-admin"),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(calls, readResult()),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("SAR_BINDING_PRIVATE");
    }
    expect(calls).toHaveLength(0);
    const smuggled = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      input: { bindingId: "bind-other" },
      nowIso,
      sarProvider: providerFor(calls, readResult()),
    });
    expect(smuggled.ok).toBe(false);
    if (!smuggled.ok) {
      expect(smuggled.code).toBe("UNTRUSTED_CLIENT_CONTEXT");
    }
    expect(calls).toHaveLength(0);
    expect(() =>
      upsertSarExecutionBridge({
        store,
        tenantId,
        nowIso,
        bridge: {
          sourceId: "src-a",
          actionRef,
          capabilityId,
          version: sarVersion,
          artifactDigest,
          bindingId: "bind-a",
          userId: employeeId,
          verification: "passed",
          effect: "update",
          supportedScopeTypes: ["SELF"],
          enforcedFilterFields: [],
        },
      }),
    ).toThrow(/Write effects/);
  });

  it("keeps an ordinary SAR failure distinct from success and from the gateway code", async () => {
    const store = normalizeEnterpriseDataStore(null);
    installWebsiteAction(store);
    addSource(store, { sourceId: "src-a", sourceKey: "site-a", bindingId: "bind-a" });
    addBridge(store, { sourceId: "src-a", bindingId: "bind-a" });
    const result = await invokeEnterpriseDataAction({
      store,
      context: trusted(),
      ref: actionRef,
      sourceId: "src-a",
      nowIso,
      sarProvider: providerFor(
        [],
        readResult({
          status: "failed",
          verification: "passed",
          completeness: "complete",
          error: {
            code: "STRUCTURE_CHANGE",
            message: "page changed",
            retry: "none",
            ordinaryFailure: true,
          },
        }),
      ),
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("HANDLER_ERROR");
    expect(result.sar?.status).toBe("failed");
    expect(result.sar?.errorCode).toBe("STRUCTURE_CHANGE");
    expect(result.sar?.errorCode).not.toBe(result.code);
    const audit = Object.values(store.invocationAuditEvents).find(
      (event) => event.traceId === result.traceId,
    );
    expect(audit?.status).toBe("FAILED");
  });

  it("does not give one credential connector source another source's active secret", async () => {
    captured.salesforceKeys.length = 0;
    captured.secrets.clear();
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    const first = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      label: "account-a",
      kind: "oauth2",
      nowIso,
    });
    const second = upsertDataConnectorCredential({
      store,
      tenantId,
      connectorId: "crm-salesforce",
      label: "account-b",
      kind: "oauth2",
      nowIso,
    });
    captured.secrets.set(first.credentialId, {
      oauthAccessToken: "token-a",
      instanceUrl: "https://a.example",
    });
    captured.secrets.set(second.credentialId, {
      oauthAccessToken: "token-b",
      instanceUrl: "https://b.example",
    });
    const seeded = findDataSourceByKey(store, tenantId, "crm-salesforce");
    expect(seeded).toBeTruthy();
    upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceId: seeded?.sourceId,
        sourceKey: "crm-salesforce",
        displayName: "Salesforce A",
        category: "crm",
        status: "connected",
        connectorId: "crm-salesforce",
        credentialId: first.credentialId,
      },
    });
    const other = upsertDataSource({
      store,
      tenantId,
      nowIso,
      source: {
        sourceKey: "crm-salesforce-b",
        displayName: "Salesforce B",
        category: "crm",
        status: "connected",
        connectorId: "crm-salesforce",
        credentialId: second.credentialId,
      },
    });
    const ref = {
      connectorId: "crm-salesforce",
      actionKey: "crm.customer.read_summary",
      version: "v1",
    };
    const context = createTrustedExecutionContextForTest({
      tenantId,
      seatId: "seat-sales-mgr-east",
      employeeId: "emp-mgr-001",
      userId: "emp-mgr-001",
    });
    const ambiguous = await invokeEnterpriseDataAction({ store, context, ref, nowIso });
    expect(ambiguous.ok).toBe(false);
    if (!ambiguous.ok) {
      expect(ambiguous.code).toBe("SOURCE_ACCOUNT_AMBIGUOUS");
    }
    expect(captured.salesforceKeys).toEqual([]);
    const fromA = await invokeEnterpriseDataAction({
      store,
      context,
      ref,
      sourceId: seeded?.sourceId,
      nowIso,
    });
    const fromB = await invokeEnterpriseDataAction({
      store,
      context,
      ref,
      sourceId: other.sourceId,
      nowIso,
    });
    expect(fromA.ok).toBe(true);
    expect(fromB.ok).toBe(true);
    expect(captured.salesforceKeys).toEqual(["token-a", "token-b"]);
  });

  it("does not open an agent raw-row bypass or a projection write path", () => {
    const agent = fs.readFileSync(
      new URL("./capability-agent-invoke-runtime.ts", import.meta.url),
      "utf8",
    );
    expect(agent).not.toContain("sar-governance-bridge");
    expect(agent).not.toContain("invokeEnterpriseDataAction");
    const bridge = fs.readFileSync(new URL("./sar-governance-bridge.ts", import.meta.url), "utf8");
    expect(bridge).not.toContain("site-capability-tools");
    expect(bridge).not.toContain("getDefaultSiteCapabilityRuntime");
    expect(bridge).not.toContain("projection-materializer");
    expect(bridge).not.toContain("executeMockHandler");
  });
});
