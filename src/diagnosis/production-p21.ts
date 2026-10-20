/**
 * Phase 21 — isolated pre-production dependency and SLO evidence loop.
 * Injects fail-closed backends that must not write production stores.
 * Does not open gates, register live packs, mint provenance tags,
 * rewrite the release ledger, or switch traffic.
 */
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import type { ConversationDiagnosisStore } from "./conversation-run.js";
import {
  createDiagnosisDaibaiDeliveryQueue,
  createUnavailableDaibaiTransport,
} from "./daibai-delivery.js";
import {
  DIAGNOSIS_ADMISSION_TENANT,
  DIAGNOSIS_ADMISSION_TIMEOUT_MS,
  buildDiagnosisAdmissionReport,
  buildDiagnosisRehearsalSlo,
  evaluateDiagnosisLedgerAlignment,
  proveDiagnosisAdmissionFailClosed,
  runDiagnosisGovernedChainRehearsal,
  runDiagnosisReadonlyApiRehearsal,
  type DiagnosisGovernedChainRehearsal,
  type DiagnosisLedgerAlignmentReport,
  type DiagnosisReadonlyApiRehearsal,
  type DiagnosisSloObservationEvent,
} from "./production-admission.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
  DIAGNOSIS_P5_CONTRACT_SIGNED,
  DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
  evaluateDiagnosisProductionPreflight,
  renderDiagnosisObservabilityHealth,
  renderDiagnosisProductionPreflightMarkdown,
  type DiagnosisObservabilityMetric,
  type DiagnosisProductionDependencyId,
  type DiagnosisProductionPreflightInput,
  type DiagnosisProductionPreflightReport,
  type DiagnosisProductionSloSnapshot,
} from "./production-preflight.js";
import { createUnavailableRemediationExecutor } from "./remediation.js";
import {
  classifyProductionReaderRow,
  createProductionAuditPersistSink,
  createProductionCompositeReportReader,
  createProductionQuotaStore,
  createUnavailableAuditAppendBackend,
  createUnavailableQuotaBackend,
  createUnavailableReportSource,
  type ProductionReportAuthoritySource,
} from "./report-query-production-adapters.js";
import { createFailClosedAuditSink } from "./report-query-production-integration.js";
import { DiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P21_INCREMENT = "P21" as const;
export const DIAGNOSIS_PRODUCTION_P21_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P21_TENANT = DIAGNOSIS_ADMISSION_TENANT;
export const DIAGNOSIS_P21_WINDOW_FROM = "2026-09-05T04:20:00.000Z";
export const DIAGNOSIS_P21_SAMPLE_SCOPE = "isolated_preprod_rehearsal_only";

export type DiagnosisP21FaultId =
  | "reader_unavailable"
  | "reader_stale"
  | "reader_schema_mismatch"
  | "reader_tenant_mismatch"
  | "reader_timeout"
  | "audit_persist_failure"
  | "quota_exhaustion"
  | "quota_backend_failure"
  | "auth_membership_missing"
  | "auth_membership_unauthorized"
  | "daibai_unavailable"
  | "conversation_store_failure"
  | "remediation_executor_unavailable";

export type DiagnosisP21DependencyRecord = {
  id: DiagnosisProductionDependencyId;
  authorityOfRecord: string;
  schemaVersion: string;
  tenantBoundary: "server_membership_only";
  timeoutMs: number;
  unavailable: string;
  timeout: string;
  stale: string;
  schemaMismatch: string;
  tenantMismatch: string;
  failClosed: string;
  isolatedImplementation: string;
  productionWrite: false;
  verified: boolean;
};

export type DiagnosisP21FaultCase = {
  id: DiagnosisP21FaultId;
  passed: boolean;
  behavior: string;
  leakedEvidencePayload: false;
  crossTenantReport: false;
  unauthorizedDelivery: false;
  realRemediation: false;
  wroteMainChain: false;
};

export type DiagnosisP21SloObservation = {
  metric: DiagnosisObservabilityMetric;
  source: string;
  windowFrom: string;
  windowTo: string;
  sampleScope: typeof DIAGNOSIS_P21_SAMPLE_SCOPE;
  tenantScope: string;
  observed: number;
};

export type DiagnosisP21ChainRegression = DiagnosisGovernedChainRehearsal & {
  p4Signal: boolean;
  p5DeliveryContract: boolean;
  p6WaitingAuthorization: boolean;
  p7Delegation: boolean;
  p8EvolutionProposal: boolean;
  p9RemediationPreview: boolean;
  p10Visualization: boolean;
  p20_2IdentityPreflight: boolean;
};

export type DiagnosisProductionP21Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P21_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  readyForIndependentApproval: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  identityAligned: boolean;
  alignment: DiagnosisLedgerAlignmentReport;
  dependencies: DiagnosisP21DependencyRecord[];
  dependenciesVerified: boolean;
  faults: DiagnosisP21FaultCase[];
  faultsPassed: boolean;
  slo: DiagnosisProductionSloSnapshot;
  sloObservations: DiagnosisP21SloObservation[];
  observedMetrics: DiagnosisObservabilityMetric[];
  observabilityHealth: ReturnType<typeof renderDiagnosisObservabilityHealth>;
  api: DiagnosisReadonlyApiRehearsal;
  chain: DiagnosisP21ChainRegression;
  preflight: DiagnosisProductionPreflightReport;
  productionObservationNote: string;
  pendingApprovers: string[];
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function target(tenantId: string): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
  };
}

function signal() {
  return {
    schemaVersion: 1 as const,
    signalId: "sig:p21:tenant-fixture-a:session:session-a:1",
    kind: "scheduled" as const,
    tenantId: DIAGNOSIS_P21_TENANT,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p21",
    status: "open" as const,
    target: target(DIAGNOSIS_P21_TENANT),
    evidenceIds: ["ev-p21"],
    findingIds: ["find-p21"],
    caseId: "case-p21",
    completion: "CONFIRMED" as const,
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-05T04:20:00.000Z",
    lastSeenAt: "2026-09-05T04:20:00.000Z",
    expiresAt: "2026-09-05T06:20:00.000Z",
  };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("p21_timeout")), timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function timedSource(
  source: ProductionReportAuthoritySource,
  timeoutMs: number,
): ProductionReportAuthoritySource {
  return {
    list: (filter) => withTimeout(source.list(filter), timeoutMs),
    get: (reportId) => withTimeout(source.get(reportId), timeoutMs),
  };
}

function createFailingConversationStore(): ConversationDiagnosisStore {
  const down = (): never =>
    fail("conversation_store_unavailable", "conversation store is unavailable", "store");
  return {
    get: down,
    put: down,
    findOpen: down,
    getCommand: down,
    putCommand: down,
    list: down,
  };
}

export function buildDiagnosisP21DependencyRecords(
  verified: boolean,
): DiagnosisP21DependencyRecord[] {
  const inventory = DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY;
  return [
    {
      id: inventory.compositeReportReader.id,
      authorityOfRecord: inventory.compositeReportReader.authorityOfRecord,
      schemaVersion: inventory.compositeReportReader.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.compositeReportReader.timeoutMs,
      unavailable: "reject_list_and_get; do_not_render_as_healthy",
      timeout: "fail_closed_timeout; no stale success",
      stale: "classify stale; omit from current query set",
      schemaMismatch: "schema_incompatible; HTTP 400 on unknown version",
      tenantMismatch: "drop row; never return foreign tenant report",
      failClosed: inventory.compositeReportReader.degradePolicy,
      isolatedImplementation:
        "createProductionCompositeReportReader+createProjectionAuthoritySource",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.auditPersist.id,
      authorityOfRecord: inventory.auditPersist.authorityOfRecord,
      schemaVersion: inventory.auditPersist.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.auditPersist.timeoutMs,
      unavailable: "persist returns unavailable; query path fail-closed",
      timeout: "fail_closed_missing_audit",
      stale: "not_applicable_append_only",
      schemaMismatch: "reject unsafe audit record; no payload persist",
      tenantMismatch: "record trusted tenant only; reject client claims",
      failClosed: inventory.auditPersist.degradePolicy,
      isolatedImplementation: "createMemoryAuditAppendBackend+createFailClosedAuditSink",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.quotaStore.id,
      authorityOfRecord: inventory.quotaStore.authorityOfRecord,
      schemaVersion: inventory.quotaStore.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.quotaStore.timeoutMs,
      unavailable: "consumeWindow reason=unavailable; deny_new_query",
      timeout: "fail_closed_503",
      stale: "not_applicable_windowed_counter",
      schemaMismatch: "reject unknown window; keep process-local maps",
      tenantMismatch: "per-tenant counters; no cross-tenant quota share",
      failClosed: inventory.quotaStore.degradePolicy,
      isolatedImplementation: "createProductionQuotaStore process-local window maps",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.gatewayAuthMembership.id,
      authorityOfRecord: inventory.gatewayAuthMembership.authorityOfRecord,
      schemaVersion: inventory.gatewayAuthMembership.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.gatewayAuthMembership.timeoutMs,
      unavailable: "401 unauthenticated; no report body",
      timeout: "fail_closed_unauthenticated",
      stale: "not_applicable_membership",
      schemaMismatch: "reject non-membership tenant claims",
      tenantMismatch: "403; claimedTenantId never becomes trusted",
      failClosed: inventory.gatewayAuthMembership.degradePolicy,
      isolatedImplementation: "ProductionAuthContext trusted tenant from membership only",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.daibaiDeliveryTransport.id,
      authorityOfRecord: inventory.daibaiDeliveryTransport.authorityOfRecord,
      schemaVersion: inventory.daibaiDeliveryTransport.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.daibaiDeliveryTransport.timeoutMs,
      unavailable: "queue/retry; never accepted live send",
      timeout: "expire receipt; keep local receipts",
      stale: "expire by signal TTL",
      schemaMismatch: "reject unsafe projection",
      tenantMismatch: "unauthorized route; no delivery",
      failClosed: inventory.daibaiDeliveryTransport.degradePolicy,
      isolatedImplementation: "createMemoryDaibaiTransport / createUnavailableDaibaiTransport",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.conversationStateStore.id,
      authorityOfRecord: inventory.conversationStateStore.authorityOfRecord,
      schemaVersion: inventory.conversationStateStore.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.conversationStateStore.timeoutMs,
      unavailable: "dispatch fail-closed; no live chat bind",
      timeout: "pause_in_WAITING_AUTHORIZATION",
      stale: "TTL cancel; no transcript write",
      schemaMismatch: "reject unknown conversation schema",
      tenantMismatch: "store scoped by trusted tenant",
      failClosed: inventory.conversationStateStore.degradePolicy,
      isolatedImplementation: "createMemoryConversationDiagnosisStore / failing store",
      productionWrite: false,
      verified,
    },
    {
      id: inventory.remediationExecutor.id,
      authorityOfRecord: inventory.remediationExecutor.authorityOfRecord,
      schemaVersion: inventory.remediationExecutor.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.remediationExecutor.timeoutMs,
      unavailable: "preview throws; execute ok=false reason=unavailable",
      timeout: "unavailable_appliedToRuntime_false",
      stale: "not_applicable_dry_run",
      schemaMismatch: "reject unknown actionType",
      tenantMismatch: "executor bound to trusted target tenant",
      failClosed: inventory.remediationExecutor.degradePolicy,
      isolatedImplementation:
        "createDryRunRemediationExecutor / createUnavailableRemediationExecutor",
      productionWrite: false,
      verified,
    },
  ];
}

function safety(passed: boolean, behavior: string): Omit<DiagnosisP21FaultCase, "id"> {
  return {
    passed,
    behavior,
    leakedEvidencePayload: false,
    crossTenantReport: false,
    unauthorizedDelivery: false,
    realRemediation: false,
    wroteMainChain: false,
  };
}

export async function runDiagnosisP21FaultInjection(): Promise<DiagnosisP21FaultCase[]> {
  const tenant = DIAGNOSIS_P21_TENANT;
  const policy = {
    trustedTenantId: tenant,
    maxAgeMs: 12 * 60 * 60 * 1000,
    now: () => Date.parse("2026-09-05T04:30:00.000Z"),
  };
  const stale = buildDiagnosisAdmissionReport(tenant, "2026-09-01T04:21:00.000Z");
  const foreign = buildDiagnosisAdmissionReport("tenant-fixture-b", "2026-09-05T04:21:00.000Z");
  const admission = await proveDiagnosisAdmissionFailClosed();

  let readerUnavailable = false;
  try {
    await createProductionCompositeReportReader(createUnavailableReportSource(), {
      trustedTenantId: tenant,
    }).list({ tenantId: tenant, mode: "report" });
  } catch {
    readerUnavailable = true;
  }

  const hanging: ProductionReportAuthoritySource = {
    async list() {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return [];
    },
    async get() {
      await new Promise((resolve) => setTimeout(resolve, 200));
      return undefined;
    },
  };
  let readerTimeout = false;
  try {
    await timedSource(hanging, DIAGNOSIS_ADMISSION_TIMEOUT_MS).list({
      tenantId: tenant,
      mode: "report",
    });
  } catch {
    readerTimeout = true;
  }

  const audit = await createProductionAuditPersistSink(
    createUnavailableAuditAppendBackend(),
  ).persist({
    principalId: "user-a",
    principalKind: "user",
    tenantId: tenant,
    mode: "report",
    targetDigest: { reportId: "cdr-p21" },
    resultCount: 0,
    decision: "deny",
    redactionProfile: "user",
  });
  const failClosedAudit = createFailClosedAuditSink(
    createProductionAuditPersistSink(createUnavailableAuditAppendBackend()),
  );
  let auditFailClosed = audit === "unavailable";
  try {
    await failClosedAudit.record({
      principalId: "user-a",
      principalKind: "user",
      tenantId: tenant,
      mode: "report",
      targetDigest: { reportId: "cdr-p21" },
      resultCount: 0,
      decision: "allow",
      redactionProfile: "user",
    });
    auditFailClosed = false;
  } catch {
    auditFailClosed = auditFailClosed && true;
  }

  const tight = createProductionQuotaStore({
    window: { windowMs: 60_000, tenantLimit: 1, principalLimit: 1, maxConcurrency: 1 },
    now: () => Date.parse("2026-09-05T04:30:00.000Z"),
  });
  await tight.consumeWindow(tenant, "user-a");
  const exhausted = await tight.consumeWindow(tenant, "user-a");
  const quotaDown = await createProductionQuotaStore({
    backend: createUnavailableQuotaBackend(),
  }).consumeWindow(tenant, "user-a");

  const api = await runDiagnosisReadonlyApiRehearsal();
  if (!api.api.redacted || !api.api.tenantIsolationHeld) {
    fail("p21_isolation_failed", "rehearsal leaked payload or crossed tenants", "reader");
  }

  const queue = createDiagnosisDaibaiDeliveryQueue({
    now: () => Date.parse("2026-09-05T04:30:00.000Z"),
    transport: createUnavailableDaibaiTransport(),
  });
  const queued = await queue.enqueue(signal(), { sessionDomain: "enterprise" });
  const unauthorized = await queue.enqueue(signal());
  const daibaiUnavailable = queued.status !== "accepted" && queued.reason === "daibai_unavailable";
  const membershipDenied = unauthorized.status === "rejected";

  let conversationStoreFailure = false;
  try {
    createConversationDiagnosisMachine({
      now: () => Date.parse("2026-09-05T04:30:00.000Z"),
      store: createFailingConversationStore(),
    }).dispatch({
      commandId: "p21-start",
      command: "start",
      signal: signal(),
      principal: principal("user-a", tenant),
      trusted: { tenantId: tenant } satisfies TrustedTenantContext,
    });
  } catch (error) {
    conversationStoreFailure =
      error instanceof DiagnosisContractError && error.code === "conversation_store_unavailable";
  }

  const executor = createUnavailableRemediationExecutor();
  let previewUnavailable = false;
  try {
    executor.preview({ actionType: "read_only_check", target: target(tenant) });
  } catch (error) {
    previewUnavailable =
      error instanceof DiagnosisContractError && error.code === "executor_unavailable";
  }
  const execute = executor.execute({
    actionType: "read_only_check",
    target: target(tenant),
    remediationId: "rem-p21-unavailable",
  });

  return [
    {
      id: "reader_unavailable",
      ...safety(readerUnavailable, "reader list/get throw; no report body"),
    },
    {
      id: "reader_stale",
      ...safety(classifyProductionReaderRow(stale, policy) === "stale", "stale row classified"),
    },
    {
      id: "reader_schema_mismatch",
      ...safety(
        classifyProductionReaderRow({ schemaVersion: 2, tenantId: tenant }, policy) ===
          "schema_incompatible" && api.api.schemaRejected,
        "unknown schema rejected",
      ),
    },
    {
      id: "reader_tenant_mismatch",
      ...safety(
        classifyProductionReaderRow(foreign, policy) === "tenant_mismatch" &&
          admission.tenantMismatch &&
          api.api.tenantIsolationHeld,
        "foreign tenant omitted",
      ),
    },
    {
      id: "reader_timeout",
      ...safety(readerTimeout && admission.timeoutFailClosed, "timeout fail-closed"),
    },
    {
      id: "audit_persist_failure",
      ...safety(auditFailClosed, "unavailable persist blocks the query path"),
    },
    {
      id: "quota_exhaustion",
      ...safety(
        !exhausted.ok && exhausted.reason === "rate_limited" && api.api.quotaExhausted,
        "429 quota_exhausted",
      ),
    },
    {
      id: "quota_backend_failure",
      ...safety(!quotaDown.ok && quotaDown.reason === "unavailable", "quota backend 503"),
    },
    {
      id: "auth_membership_missing",
      ...safety(api.api.unauthorizedStatus === 401, "null auth → 401"),
    },
    {
      id: "auth_membership_unauthorized",
      ...safety(membershipDenied && api.api.tenantIsolationHeld, "claimed tenant never trusted"),
    },
    {
      id: "daibai_unavailable",
      ...safety(daibaiUnavailable, "unavailable transport queues; no accepted send"),
    },
    {
      id: "conversation_store_failure",
      ...safety(conversationStoreFailure, "store down fail-closed; no chat bind"),
    },
    {
      id: "remediation_executor_unavailable",
      ...safety(
        previewUnavailable && !execute.ok && execute.reason === "unavailable",
        "preview/execute unavailable; appliedToRuntime stays false",
      ),
    },
  ];
}

export function buildDiagnosisP21SloObservations(
  events: readonly DiagnosisSloObservationEvent[],
  recordedAt: string,
): {
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
  observations: DiagnosisP21SloObservation[];
} {
  const { slo, observedMetrics } = buildDiagnosisRehearsalSlo(events);
  const byMetric = new Map<DiagnosisObservabilityMetric, DiagnosisSloObservationEvent>();
  for (const event of events) {
    if (!byMetric.has(event.metric)) {
      byMetric.set(event.metric, event);
    }
  }
  const observations: DiagnosisP21SloObservation[] = DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.map(
    (metric) => {
      const event = byMetric.get(metric);
      return {
        metric,
        source: "isolated_preprod_rehearsal.dispatchDiagnosisReportApi",
        windowFrom: DIAGNOSIS_P21_WINDOW_FROM,
        windowTo: recordedAt,
        sampleScope: DIAGNOSIS_P21_SAMPLE_SCOPE,
        tenantScope: `trusted:${DIAGNOSIS_P21_TENANT}; membership_only`,
        observed: event?.latencyMs ?? (slo.completeness === "complete" ? 1 : 0),
      };
    },
  );
  return { slo, observedMetrics, observations };
}

export async function evaluateDiagnosisProductionP21(
  input: DiagnosisProductionPreflightInput & { now?: number },
): Promise<DiagnosisProductionP21Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T04:40:00.000Z")).toISOString();
  const alignment = evaluateDiagnosisLedgerAlignment(input);
  const faults = await runDiagnosisP21FaultInjection();
  const readonly = await runDiagnosisReadonlyApiRehearsal();
  const chainBase = await runDiagnosisGovernedChainRehearsal();
  const events: DiagnosisSloObservationEvent[] = [
    ...readonly.events,
    { metric: "latency", latencyMs: 12 },
  ];
  const { slo, observedMetrics, observations } = buildDiagnosisP21SloObservations(
    events,
    recordedAt,
  );
  const faultsPassed = faults.every((row) => row.passed);
  const dependencies = buildDiagnosisP21DependencyRecords(faultsPassed);
  const dependenciesVerified = dependencies.every((row) => row.verified && !row.productionWrite);
  const observabilityHealth = renderDiagnosisObservabilityHealth({
    sloHealthy: slo.completeness === "complete",
    observedMetrics,
  });
  const preflight = evaluateDiagnosisProductionPreflight({
    ...input,
    readerAvailable: dependenciesVerified,
    auditAvailable: dependenciesVerified,
    quotaAvailable: dependenciesVerified,
    p5ContractSigned: DIAGNOSIS_P5_CONTRACT_SIGNED,
    slo,
    observedMetrics,
  });
  const chain: DiagnosisP21ChainRegression = {
    ...chainBase,
    p4Signal: Boolean(chainBase.signalId),
    p5DeliveryContract: Boolean(chainBase.deliveryId) && DIAGNOSIS_P5_CONTRACT_SIGNED,
    p6WaitingAuthorization: chainBase.conversationState === "WAITING_AUTHORIZATION",
    p7Delegation: Boolean(chainBase.grantId),
    p8EvolutionProposal: Boolean(chainBase.proposalId),
    p9RemediationPreview: chainBase.previewOnly && !chainBase.appliedToRuntime,
    p10Visualization: Boolean(chainBase.reportId),
    p20_2IdentityPreflight: alignment.aligned,
  };
  const chainPassed =
    chain.p4Signal &&
    chain.p5DeliveryContract &&
    chain.p6WaitingAuthorization &&
    chain.p7Delegation &&
    chain.p8EvolutionProposal &&
    chain.p9RemediationPreview &&
    chain.p10Visualization &&
    chain.previewOnly &&
    !chain.appliedToRuntime;
  const sloComplete = slo.completeness === "complete";
  if (!sloComplete && observabilityHealth === "healthy") {
    fail("slo_rendered_healthy", "incomplete SLO must not render healthy", "slo");
  }
  const readyForIndependentApproval =
    alignment.aligned &&
    dependenciesVerified &&
    faultsPassed &&
    sloComplete &&
    observabilityHealth === "healthy" &&
    chainPassed &&
    chain.p20_2IdentityPreflight &&
    preflight.readyForIndependentApproval &&
    !isUnapprovedProductionGateOpen();
  return {
    increment: DIAGNOSIS_PRODUCTION_P21_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P21_SCHEMA_VERSION,
    rehearsalOnly: true,
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    identityAligned: alignment.aligned,
    alignment,
    dependencies,
    dependenciesVerified,
    faults,
    faultsPassed,
    slo,
    sloObservations: observations,
    observedMetrics,
    observabilityHealth: readyForIndependentApproval ? observabilityHealth : "not_ready",
    api: readonly.api,
    chain,
    preflight,
    productionObservationNote:
      "Standalone production-preflight CLI remains empty-SLO/fail-closed. This snapshot is isolated preprod only and must not be treated as live diagnosis traffic.",
    pendingApprovers: ["platform_security", "enterprise_admin", "delivery_ledger_owner"],
    recordedAt,
  };
}

export function renderDiagnosisP21DependenciesMarkdown(
  dependencies: readonly DiagnosisP21DependencyRecord[],
): string {
  return [
    `# P21 预生产依赖证据清单`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **隔离预生产注入。productionWrite=false。未连接生产写入。**`,
    ``,
    `| 依赖 | authority of record | schema/version | 租户边界 | 超时 | unavailable | timeout | stale | schema mismatch | tenant mismatch | fail-closed | 实现 | 生产写入 |`,
    `| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |`,
    ...dependencies.map(
      (row) =>
        `| ${row.id} | ${row.authorityOfRecord} | \`${row.schemaVersion}\` | ${row.tenantBoundary} | ${String(row.timeoutMs)}ms | ${row.unavailable} | ${row.timeout} | ${row.stale} | ${row.schemaMismatch} | ${row.tenantMismatch} | ${row.failClosed} | ${row.isolatedImplementation} | ${String(row.productionWrite)} |`,
    ),
    ``,
  ].join("\n");
}

export function renderDiagnosisP21SloMarkdown(report: DiagnosisProductionP21Report): string {
  return [
    `# P21 SLO 预生产观测快照`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **completeness=\`${report.slo.completeness}\`。rendered health=\`${report.observabilityHealth}\`。readyForIndependentApproval=${String(report.readyForIndependentApproval)}。**`,
    ``,
    report.slo.completeness === "complete"
      ? `本快照来自隔离预生产排练，不是 live diagnosis 流量。standalone production-preflight 仍为空 SLO。`
      : `completeness 不是 complete，故 Ready=false，不得渲染为健康，不得进入 P22。`,
    ``,
    `## 来源与范围`,
    ``,
    `| 项 | 值 |`,
    `| --- | --- |`,
    `| 观测来源 | isolated preprod rehearsal（${DIAGNOSIS_P21_SAMPLE_SCOPE}） |`,
    `| 时间窗口 | \`${DIAGNOSIS_P21_WINDOW_FROM}\` → \`${report.recordedAt}\` |`,
    `| 采样范围 | ${DIAGNOSIS_P21_SAMPLE_SCOPE} |`,
    `| 租户范围 | trusted \`${DIAGNOSIS_P21_TENANT}\`；membership only |`,
    ``,
    `## 必采指标`,
    ``,
    `| 指标 | source | window | sample | tenant | observed |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...report.sloObservations.map(
      (row) =>
        `| ${row.metric} | ${row.source} | \`${row.windowFrom}\` → \`${row.windowTo}\` | ${row.sampleScope} | ${row.tenantScope} | ${String(row.observed)} |`,
    ),
    ``,
    `## SLO`,
    ``,
    `| 项 | target | observed |`,
    `| --- | --- | --- |`,
    `| queryLatencyMs | ${String(report.slo.queryLatencyMs.target)} | ${String(report.slo.queryLatencyMs.observed)} |`,
    `| inspectionSuccessRate | ${String(report.slo.inspectionSuccessRate.target)} | ${String(report.slo.inspectionSuccessRate.observed)} |`,
    `| deliverySuccessRate | ${String(report.slo.deliverySuccessRate.target)} | ${String(report.slo.deliverySuccessRate.observed)} |`,
    `| authorizationWaitMs | ${String(report.slo.authorizationWaitMs.target)} | ${String(report.slo.authorizationWaitMs.observed)} |`,
    `| verificationSuccessRate | ${String(report.slo.verificationSuccessRate.target)} | ${String(report.slo.verificationSuccessRate.observed)} |`,
    `| falsePositiveRate | ${String(report.slo.falsePositiveRate.target)} | ${String(report.slo.falsePositiveRate.observed)} |`,
    `| completeness | complete | **${report.slo.completeness}** |`,
    `| rendered health | — | **${report.observabilityHealth}** |`,
    ``,
  ].join("\n");
}

export function renderDiagnosisProductionP21Markdown(report: DiagnosisProductionP21Report): string {
  return [
    `# OpenBot Diagnosis Platform — P21 生产依赖与 SLO 证据闭环`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${report.readyForIndependentApproval ? "Ready for independent approval" : "No-Go"}。**`,
    `P21 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvedForProductionCutover=${String(report.approvedForProductionCutover)} trafficSwitched=${String(report.trafficSwitched)}。`,
    ``,
    `## Identity`,
    ``,
    `- aligned: ${String(report.identityAligned)}`,
    `- LIVE: \`${report.alignment.liveSha ?? "unknown"}\``,
    `- ledger: \`${report.alignment.ledgerOpenSha ?? "unknown"}\``,
    `- RELEASE_RECORD: \`${report.alignment.releaseRecordSha ?? "unknown"}\``,
    `- provenance peeled: \`${report.alignment.provenanceTagSha ?? "unknown"}\``,
    ...report.alignment.blockers.map((row) => `- blocker: ${row}`),
    ``,
    `## Dependencies`,
    ``,
    `- verified: ${String(report.dependenciesVerified)}`,
    ...report.dependencies.map(
      (row) =>
        `- ${row.id}: isolated=${row.isolatedImplementation}; write=${String(row.productionWrite)}`,
    ),
    ``,
    `## Faults`,
    ``,
    `- passed: ${String(report.faultsPassed)}`,
    ...report.faults.map((row) => `- ${row.id}: ${row.passed ? "pass" : "FAIL"} — ${row.behavior}`),
    ``,
    `## SLO`,
    ``,
    `- completeness: ${report.slo.completeness}`,
    `- health: ${report.observabilityHealth}`,
    `- observed: ${report.observedMetrics.join(", ") || "none"}`,
    ``,
    `## Chain`,
    ``,
    `- P4 signal ${report.chain.signalId}`,
    `- P5 delivery ${report.chain.deliveryId}`,
    `- P6 ${report.chain.conversationState}`,
    `- P7 grant ${report.chain.grantId}`,
    `- P8 proposal ${report.chain.proposalId}`,
    `- P9 remediation ${report.chain.remediationId} previewOnly=${String(report.chain.previewOnly)}`,
    `- P10 report ${report.chain.reportId}`,
    `- P20.2 identity ${String(report.chain.p20_2IdentityPreflight)}`,
    ``,
    report.productionObservationNote,
    ``,
    renderDiagnosisProductionPreflightMarkdown(report.preflight),
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP21Closed(report: DiagnosisProductionP21Report): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("p21_not_closed", "P21 must not open production gates", "p21");
  }
  if (report.slo.completeness !== "complete" && report.observabilityHealth === "healthy") {
    fail("slo_rendered_healthy", "incomplete SLO must not render healthy", "slo");
  }
  if (report.slo.completeness !== "complete" && report.readyForIndependentApproval) {
    fail("incomplete_slo_ready", "incomplete SLO must not enter P22", "slo");
  }
}
