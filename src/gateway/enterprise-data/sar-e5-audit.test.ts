import { describe, expect, it } from "vitest";
import type { SiteRunResult } from "../../site-capability/result.js";
import { priorWriteMayBeReplayed } from "../../site-capability/write-recheck-store.js";
import { upsertApprovalPolicy } from "./approval-policy-store.js";
import {
  buildApprovalContextSnapshot,
  createApprovalRequest,
  decideApprovalRequest,
} from "./approval-workflow.js";
import { upsertConnectorAction } from "./connector-action-store.js";
import { invokeEnterpriseDataAction } from "./data-gateway.js";
import { findDataSource, upsertDataSource } from "./data-source-store.js";
import { createTrustedExecutionContextForTest } from "./enterprise-data-seat-context.js";
import { lineageRecordsVerifiedSar } from "./knowledge-publication.js";
import { registerRuntimeHandler } from "./runtime-registry.js";
import {
  findSarTraceCorrelationByRunId,
  findSarTraceCorrelationByTraceId,
  recordSarTraceCorrelation,
} from "./sar-audit-correlation.js";
import { clearSarExecutionHalt, setSarExecutionHalt } from "./sar-execution-halt.js";
import { resolveSarFailureDisplay } from "./sar-failure-display.js";
import { upsertSarExecutionBridge, type SarGovernanceProvider } from "./sar-governance-bridge.js";
import { correlateSarRun } from "./sar-governance-bridge.js";
import {
  invocationAuditRecordsVerifiedSar,
  legacyLineageVerifiedWebsite,
  readLegacyKnowledgeLineage,
} from "./sar-legacy-semantics.js";
import { upsertScopePolicy } from "./scope-policy-store.js";
import { revokeSeatActionGrant, upsertSeatActionGrant } from "./seat-action-grant-store.js";
import { seedEnterpriseDataCatalog } from "./seeds.js";
import { normalizeEnterpriseDataStore } from "./store.js";
import type { DataGatewayResponse, EnterpriseDataStore } from "./types.js";

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
const SECRET = "SECRETCOOKIEVALUE";
const SECRET_PASSWORD = "SECRET-PASSWORD";
const SECRET_TRACE = "FULL-TRACE-BODY";

function trusted() {
  return createTrustedExecutionContextForTest({
    tenantId,
    seatId,
    employeeId,
    userId: employeeId,
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
    data: [{ id: "row-1", cookie: SECRET, password: SECRET_PASSWORD, note: SECRET_TRACE }],
    evidenceRef: "evidence-1",
    durationMs: 4,
    repair: "none",
    ...overrides,
  };
}

function providerFor(
  calls: string[],
  result: SiteRunResult | (() => SiteRunResult),
): SarGovernanceProvider {
  return {
    async execute() {
      calls.push("called");
      return {
        result: typeof result === "function" ? result() : result,
        scopeEnforcedBeforeRead: true,
      };
    },
  };
}

function installWebsiteAction(
  store: EnterpriseDataStore,
  options?: { requiresApproval?: boolean; approvalPolicyId?: string },
) {
  upsertScopePolicy({
    store,
    tenantId,
    nowIso,
    policy: {
      scopePolicyId: "scope-self",
      displayName: "scope-self",
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
      requiresApproval: options?.requiresApproval ?? false,
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
    approvalPolicyId: options?.approvalPolicyId,
    nowIso,
  });
}

function addSource(store: EnterpriseDataStore) {
  return upsertDataSource({
    store,
    tenantId,
    nowIso,
    source: {
      sourceId: "src-a",
      sourceKey: "site-a",
      displayName: "site-a",
      category: "external",
      status: "connected",
      connectorId: "site-session",
      bindingId: "bind-a",
    },
  });
}

function addBridge(store: EnterpriseDataStore, version = sarVersion) {
  return upsertSarExecutionBridge({
    store,
    tenantId,
    nowIso,
    bridge: {
      sourceId: "src-a",
      actionRef,
      capabilityId,
      version,
      artifactDigest,
      bindingId: "bind-a",
      userId: employeeId,
      verification: "passed",
      validator: "reviewer-1",
      effect: "read",
      supportedScopeTypes: ["SELF"],
      enforcedFilterFields: [],
    },
  });
}

function websiteStore() {
  const store = normalizeEnterpriseDataStore(null);
  installWebsiteAction(store);
  addSource(store);
  addBridge(store);
  return store;
}

async function invoke(
  store: EnterpriseDataStore,
  provider: SarGovernanceProvider,
  approvalContextId?: string,
) {
  return invokeEnterpriseDataAction({
    store,
    context: trusted(),
    ref: actionRef,
    sourceId: "src-a",
    nowIso,
    sarProvider: provider,
    approvalContextId,
  });
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

function dumped(store: EnterpriseDataStore, traceId: string): string {
  const correlation = findSarTraceCorrelationByTraceId({ store, tenantId, traceId });
  const audit = Object.values(store.invocationAuditEvents).filter(
    (event) => event.traceId === traceId,
  );
  const dataAudit = Object.values(store.dataAuditEvents).filter(
    (event) => event.traceId === traceId,
  );
  return JSON.stringify({ correlation, audit, dataAudit });
}

describe("E5 trace correlation", () => {
  it("links traceId to runId and drops the sensitive trace body", async () => {
    const store = websiteStore();
    const calls: string[] = [];
    const result = await invoke(store, providerFor(calls, readResult()));
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.traceId).not.toBe(result.sar?.runId);
    const byTrace = findSarTraceCorrelationByTraceId({
      store,
      tenantId,
      traceId: result.traceId,
    });
    const byRun = findSarTraceCorrelationByRunId({
      store,
      tenantId,
      sarRunId: "run-1",
    });
    expect(byTrace?.correlationId).toBe(byRun?.correlationId);
    expect(byTrace?.sarRunId).toBe("run-1");
    expect(byTrace?.evidenceRef).toBe("evidence-1");
    expect(byTrace?.displayClass).toBeUndefined();
    expect(dumped(store, result.traceId)).not.toContain(SECRET);
    expect(dumped(store, result.traceId)).not.toContain(SECRET_PASSWORD);
    expect(dumped(store, result.traceId)).not.toContain(SECRET_TRACE);
    expect(
      findSarTraceCorrelationByRunId({ store, tenantId: "other", sarRunId: "run-1" }),
    ).toBeNull();
    const again = recordSarTraceCorrelation({
      store,
      tenantId,
      traceId: result.traceId,
      sar: result.sar!,
      recordedAt: nowIso,
      trace: { cookie: SECRET, html: SECRET_TRACE },
    });
    expect(again?.correlationId).toBe(byTrace?.correlationId);
    expect(Object.keys(store.sarTraceCorrelations ?? {})).toHaveLength(1);
  });

  it("hashes an evidence ref that is not a short id", () => {
    const store = normalizeEnterpriseDataStore(null);
    const sar = correlateSarRun(
      readResult({ evidenceRef: `cookie=${SECRET}\n${SECRET_TRACE}` }),
      artifactDigest,
    );
    const record = recordSarTraceCorrelation({
      store,
      tenantId,
      traceId: "trace-long",
      sar,
      recordedAt: nowIso,
      trace: { messages: [SECRET_TRACE], cookie: SECRET },
    });
    expect(record?.evidenceRef.startsWith("sha256:")).toBe(true);
    expect(JSON.stringify(record)).not.toContain(SECRET);
    expect(JSON.stringify(record)).not.toContain(SECRET_TRACE);
  });
});

describe("E5 seat grant, approval, and revoke", () => {
  it("allows a granted seat and blocks after the grant is revoked", async () => {
    const store = websiteStore();
    const calls: string[] = [];
    const provider = providerFor(calls, readResult());
    const allowed = await invoke(store, provider);
    expect(allowed.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const grantId = Object.keys(store.seatActionGrants)[0] ?? "";
    revokeSeatActionGrant({ store, tenantId, grantId, nowIso });
    const blocked = await invoke(store, provider);
    expect(blocked.ok).toBe(false);
    if (blocked.ok) {
      return;
    }
    expect(blocked.code).toBe("NO_ACTION_GRANT");
    expect(displayClass(blocked)).toBe("policy_denied");
    expect(calls).toHaveLength(1);
    if (allowed.ok) {
      expect(
        findSarTraceCorrelationByTraceId({ store, tenantId, traceId: allowed.traceId })?.sarRunId,
      ).toBe("run-1");
    }
  });

  it("blocks until approval, then blocks a rejected or revoked approval", async () => {
    const store = normalizeEnterpriseDataStore(null);
    const policy = upsertApprovalPolicy({
      store,
      tenantId,
      nowIso,
      policy: {
        approvalPolicyId: "approve-site",
        displayName: "网站读取审批",
        mode: "PER_REQUEST",
        approverRole: "enterprise-admin",
      },
    });
    installWebsiteAction(store, {
      requiresApproval: true,
      approvalPolicyId: policy.approvalPolicyId,
    });
    addSource(store);
    addBridge(store);
    const calls: string[] = [];
    const provider = providerFor(calls, readResult());
    const missing = await invoke(store, provider);
    expect(missing.ok).toBe(false);
    if (missing.ok) {
      return;
    }
    expect(missing.code).toBe("APPROVAL_REQUIRED");
    expect(displayClass(missing)).toBe("policy_denied");
    expect(calls).toHaveLength(0);

    const rejected = await invoke(store, provider, "ctx-rejected");
    expect(rejected.ok).toBe(false);
    const grant = Object.values(store.seatActionGrants)[0];
    expect(grant).toBeTruthy();
    const request = createApprovalRequest({
      store,
      tenantId,
      seatId,
      employeeId,
      ref: actionRef,
      approvalPolicyId: policy.approvalPolicyId,
      approvalContextId: "ctx-rejected",
      nowIso,
    });
    decideApprovalRequest({
      store,
      tenantId,
      approvalId: request.approvalId,
      decision: "rejected",
      decidedBy: "emp-admin",
      nowIso,
    });
    const afterReject = await invoke(store, provider, "ctx-rejected");
    expect(afterReject.ok).toBe(false);
    if (!afterReject.ok) {
      expect(afterReject.code).toBe("APPROVAL_REQUIRED");
    }
    expect(calls).toHaveLength(0);

    const pending = createApprovalRequest({
      store,
      tenantId,
      seatId,
      employeeId,
      ref: actionRef,
      approvalPolicyId: policy.approvalPolicyId,
      approvalContextId: "ctx-ok",
      nowIso,
    });
    decideApprovalRequest({
      store,
      tenantId,
      approvalId: pending.approvalId,
      decision: "approved",
      decidedBy: "emp-admin",
      contextSnapshot: buildApprovalContextSnapshot({
        store,
        tenantId,
        grant,
        ref: actionRef,
      }),
      nowIso,
    });
    const allowed = await invoke(store, provider, "ctx-ok");
    expect(allowed.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const spent = await invoke(store, provider, "ctx-ok");
    expect(spent.ok).toBe(false);
    if (!spent.ok) {
      expect(spent.code).toBe("APPROVAL_REQUIRED");
    }
    expect(calls).toHaveLength(1);
  });
});

describe("E5 failure classes", () => {
  it("distinguishes login, infrastructure, policy, structure change, and business validation", async () => {
    const cases: Array<{
      name: string;
      result?: Partial<SiteRunResult>;
      dropGrant?: boolean;
      expected: string;
    }> = [
      {
        name: "login",
        result: {
          status: "failed",
          verification: "passed",
          error: {
            code: "AUTH_REQUIRED",
            message: `token=${SECRET}`,
            retry: "after_reauth",
            ordinaryFailure: true,
          },
        },
        expected: "login",
      },
      {
        name: "infrastructure",
        result: {
          status: "failed",
          verification: "passed",
          error: {
            code: "BROWSER_UNAVAILABLE",
            message: SECRET_TRACE,
            retry: "none",
            ordinaryFailure: true,
          },
        },
        expected: "infrastructure",
      },
      {
        name: "policy",
        result: {
          status: "failed",
          verification: "passed",
          error: {
            code: "POLICY_DENIED",
            message: SECRET,
            retry: "none",
            ordinaryFailure: true,
          },
        },
        expected: "policy_denied",
      },
      {
        name: "structure",
        result: {
          status: "failed",
          verification: "failed",
          error: {
            code: "STRUCTURE_CHANGED",
            message: SECRET_TRACE,
            retry: "none",
            ordinaryFailure: false,
          },
        },
        expected: "structure_change",
      },
      {
        name: "validation",
        result: {
          status: "failed",
          verification: "failed",
          error: {
            code: "VALIDATION_FAILED",
            message: SECRET,
            retry: "none",
            ordinaryFailure: false,
          },
        },
        expected: "business_validation",
      },
    ];
    const seen = new Set<string>();
    for (const item of cases) {
      const store = websiteStore();
      const calls: string[] = [];
      const result = await invoke(
        store,
        providerFor(calls, readResult({ runId: `run-${item.name}`, ...item.result })),
      );
      expect(result.ok, item.name).toBe(false);
      if (result.ok) {
        continue;
      }
      expect(displayClass(result), item.name).toBe(item.expected);
      expect(calls, item.name).toHaveLength(1);
      expect(dumped(store, result.traceId), item.name).not.toContain(SECRET);
      expect(result.message, item.name).not.toContain(SECRET);
      const link = findSarTraceCorrelationByRunId({
        store,
        tenantId,
        sarRunId: `run-${item.name}`,
      });
      expect(link?.displayClass, item.name).toBe(item.expected);
      expect(link?.traceId).toBe(result.traceId);
      seen.add(item.expected);
    }
    expect(seen).toEqual(
      new Set([
        "login",
        "infrastructure",
        "policy_denied",
        "structure_change",
        "business_validation",
      ]),
    );

    const unlabeled = resolveSarFailureDisplay({ status: "unknown", errorCode: "RESULT_UNKNOWN" });
    expect(unlabeled).toBeNull();
    expect(resolveSarFailureDisplay({ status: "failed", errorCode: "CAPTCHA" })).toBeNull();
    expect(
      resolveSarFailureDisplay({ status: "failed", errorCode: "SAR_OP_NOT_IN_SET" }),
    ).toBeNull();
    expect(resolveSarFailureDisplay({ denialReason: "SAR_EXECUTION_HALTED" })).toBeNull();
    expect(resolveSarFailureDisplay({ denialReason: "HANDLER_TIMEOUT" })?.class).toBe(
      "infrastructure",
    );
    expect(resolveSarFailureDisplay({ denialReason: "CREDENTIAL_REAUTH_REQUIRED" })?.label).toBe(
      "登录",
    );
  });

  it("keeps the source connected when the page structure changes", async () => {
    const store = websiteStore();
    const calls: string[] = [];
    const result = await invoke(
      store,
      providerFor(
        calls,
        readResult({
          status: "failed",
          verification: "failed",
          error: {
            code: "STRUCTURE_CHANGED",
            message: "layout",
            retry: "none",
            ordinaryFailure: false,
          },
        }),
      ),
    );
    expect(result.ok).toBe(false);
    const source = findDataSource(store, tenantId, "src-a");
    expect(source?.status).toBe("connected");
    expect(source?.lastSucceededAt).toBeUndefined();
    expect(displayClass(result)).toBe("structure_change");
  });

  it("does not copy a provider exception into the denial", async () => {
    const store = websiteStore();
    const result = await invoke(store, {
      async execute() {
        throw new Error(`cookie=${SECRET}`);
      },
    });
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.code).toBe("HANDLER_ERROR");
    expect(result.message).toBe("SAR provider failed.");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("E5 halt switches", () => {
  it("blocks new runs for tenant, capability, and version without withdrawing side effects", async () => {
    const store = websiteStore();
    const calls: string[] = [];
    const provider = providerFor(calls, readResult());
    const first = await invoke(store, provider);
    expect(first.ok).toBe(true);
    const tenantHalt = setSarExecutionHalt({
      store,
      tenantId,
      scope: "tenant",
      reason: "tenant off",
      haltedBy: "emp-admin",
      nowIso,
    });
    const halted = await invoke(store, provider);
    expect(halted.ok).toBe(false);
    if (halted.ok || !first.ok) {
      return;
    }
    expect(halted.code).toBe("SAR_EXECUTION_HALTED");
    expect(halted.details?.inFlightSideEffectsWithdrawn).toBe(false);
    expect(halted.details?.priorWriteMayBeReplayed).toBe(false);
    expect(halted.details?.blocksNewRun).toBe(true);
    expect(displayClass(halted)).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(
      findSarTraceCorrelationByTraceId({ store, tenantId, traceId: first.traceId })?.status,
    ).toBe("succeeded");
    const audit = Object.values(store.invocationAuditEvents).find(
      (event) => event.traceId === first.traceId,
    );
    expect(audit?.status).toBe("SUCCESS");
    expect(
      priorWriteMayBeReplayed(
        readResult({
          status: "unknown",
          verification: "not_performed",
          completeness: "partial",
          error: {
            code: "RESULT_UNKNOWN",
            message: "unknown",
            retry: "not_ordinary",
            ordinaryFailure: false,
          },
        }),
      ),
    ).toBe(false);

    clearSarExecutionHalt({ store, tenantId, haltId: tenantHalt.haltId });
    setSarExecutionHalt({
      store,
      tenantId,
      scope: "version",
      capabilityId,
      version: sarVersion,
      reason: "version off",
      haltedBy: "emp-admin",
      nowIso,
    });
    const versionBlocked = await invoke(store, provider);
    expect(versionBlocked.ok).toBe(false);
    addBridge(store, "2026.10.18");
    const newer = providerFor(calls, readResult({ version: "2026.10.18", runId: "run-new" }));
    const versionAllowed = await invoke(store, newer);
    expect(versionAllowed.ok).toBe(true);

    setSarExecutionHalt({
      store,
      tenantId,
      scope: "capability",
      capabilityId,
      reason: "capability off",
      haltedBy: "emp-admin",
      nowIso,
    });
    const capabilityBlocked = await invoke(store, newer);
    expect(capabilityBlocked.ok).toBe(false);
    if (!capabilityBlocked.ok) {
      expect(capabilityBlocked.code).toBe("SAR_EXECUTION_HALTED");
      expect(capabilityBlocked.details?.inFlightSideEffectsWithdrawn).toBe(false);
    }
  });

  it("does not halt an API connector read", async () => {
    const store = normalizeEnterpriseDataStore(null);
    seedEnterpriseDataCatalog({ store, tenantId, nowIso });
    setSarExecutionHalt({
      store,
      tenantId,
      scope: "tenant",
      reason: "website off",
      haltedBy: "emp-admin",
      nowIso,
    });
    const result = await invokeEnterpriseDataAction({
      store,
      context: createTrustedExecutionContextForTest({
        tenantId,
        seatId: "seat-sales-mgr-east",
        employeeId: "emp-mgr-001",
        userId: "emp-mgr-001",
      }),
      ref: {
        connectorId: "crm-salesforce",
        actionKey: "crm.customer.read_summary",
        version: "v1",
      },
      nowIso,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(
        findSarTraceCorrelationByTraceId({ store, tenantId, traceId: result.traceId }),
      ).toBeNull();
    }
  });
});

describe("E5 legacy records", () => {
  it("does not treat missing SAR fields as a verified website capability", () => {
    const rawLineage = {
      lineageId: "old-lineage",
      tenantId,
      objectId: "obj-1",
      projectionId: "proj-1",
      sourceActions: ["crm.customer.read_summary@v1"],
      sourceTraceIds: ["trace-old"],
      generatedAt: nowIso,
      generatorVersion: "v0",
      verifiedInProduction: true,
    };
    const read = readLegacyKnowledgeLineage(rawLineage);
    expect(read?.sarVerification).toBeUndefined();
    expect(read?.sarCompleteness).toBeUndefined();
    expect(read?.sarRunId).toBeUndefined();
    expect(read && "verifiedInProduction" in read).toBe(false);
    expect(legacyLineageVerifiedWebsite(rawLineage)).toBe(false);
    expect(lineageRecordsVerifiedSar(read!)).toBe(false);

    const store = normalizeEnterpriseDataStore({
      version: 5,
      knowledgeLineageRecords: { "old-lineage": rawLineage as never },
      invocationAuditEvents: {
        "audit-old": {
          invocationAuditId: "audit-old",
          traceId: "trace-old",
          tenantId,
          seatId,
          connectorId: "crm-salesforce",
          actionKey: "crm.customer.read_summary",
          version: "v1",
          riskLevel: "LOW",
          scopeType: "SELF",
          status: "SUCCESS",
          timestamp: nowIso,
        },
      },
    });
    expect(store.sarTraceCorrelations).toEqual({});
    expect(store.knowledgeLineageRecords["old-lineage"]?.sarVerification).toBeUndefined();
    expect(invocationAuditRecordsVerifiedSar(store.invocationAuditEvents["audit-old"])).toBe(false);
    expect(legacyLineageVerifiedWebsite(store.knowledgeLineageRecords["old-lineage"])).toBe(false);

    const verified = readLegacyKnowledgeLineage({
      ...rawLineage,
      sourceId: "src-a",
      sarCapabilityId: capabilityId,
      sarVersion,
      sarRunId: "run-old",
      validator: "reviewer-1",
      sarVerification: "passed",
      sarCompleteness: "complete",
    });
    expect(legacyLineageVerifiedWebsite(verified)).toBe(true);
    expect(
      invocationAuditRecordsVerifiedSar({
        status: "SUCCESS",
        sarRunId: "run-old",
        sarVerification: "passed",
        sarCompleteness: "complete",
        artifactDigest,
      }),
    ).toBe(true);
    expect(
      invocationAuditRecordsVerifiedSar({
        status: "SUCCESS",
        sarRunId: "run-old",
        artifactDigest,
      }),
    ).toBe(false);
  });
});
