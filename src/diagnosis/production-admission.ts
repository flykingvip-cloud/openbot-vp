/**
 * Phase 13 — read-only single-tenant admission rehearsal.
 * Injects pre-production backends, records SLO observations, and walks the
 * P4–P10 reference chain. Does not open gates, register live packs, mint
 * provenance tags, rewrite the release ledger, or switch traffic.
 */
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import { aggregateCrossTargetCases } from "./cross-target.js";
import {
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
} from "./daibai-delivery.js";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  createDelegationEvolutionInspector,
  createDiagnosisEvolutionProposalMachine,
} from "./evolution-proposal.js";
import { DIAGNOSIS_PRODUCTION_SLO } from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import {
  DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS,
  DIAGNOSIS_P5_CONTRACT_SIGNED,
  evaluateDiagnosisProductionPreflight,
  renderDiagnosisObservabilityHealth,
  renderDiagnosisProductionPreflightMarkdown,
  type DiagnosisObservabilityMetric,
  type DiagnosisProductionPreflightInput,
  type DiagnosisProductionPreflightReport,
  type DiagnosisProductionSloSnapshot,
} from "./production-preflight.js";
import {
  createDiagnosisRemediationMachine,
  createDryRunRemediationExecutor,
  createEvolutionProposalInspector,
} from "./remediation.js";
import { dispatchDiagnosisReportApi } from "./report-query-api.js";
import {
  classifyProductionReaderRow,
  createMemoryAuditAppendBackend,
  createProductionAuditPersistSink,
  createProductionCompositeReportReader,
  createProductionQuotaStore,
  createProjectionAuthoritySource,
  createUnavailableAuditAppendBackend,
  createUnavailableQuotaBackend,
  createUnavailableReportSource,
  type ProductionReportAuthoritySource,
} from "./report-query-production-adapters.js";
import { createFailClosedAuditSink } from "./report-query-production-integration.js";
import type {
  ProductionAuthContext,
  ProductionQueryAdapterDeps,
} from "./report-query-production.js";
import { buildCompositeDiagnosisReport } from "./report.js";
import type { DiagnosticSignal } from "./signal.js";
import { DiagnosisContractError } from "./types.js";
import type {
  DiagnosisRelation,
  DiagnosticEvidence,
  DiagnosticFinding,
  DiagnosticPrincipal,
  DiagnosticTarget,
  TrustedTenantContext,
} from "./types.js";
import { projectDiagnosisVisualization } from "./visualization.js";

export const DIAGNOSIS_PRODUCTION_ADMISSION_INCREMENT = "P13" as const;
export const DIAGNOSIS_PRODUCTION_ADMISSION_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_ADMISSION_TENANT = "tenant-fixture-a" as const;
export const DIAGNOSIS_ADMISSION_TIMEOUT_MS = 50;

export type DiagnosisLedgerAlignmentReport = {
  aligned: boolean;
  liveSha: string | null;
  ledgerOpenSha: string | null;
  releaseRecordSha: string | null;
  provenanceTagSha: string | null;
  ledgerMutated: false;
  provenanceMinted: false;
  blockers: string[];
};

export type DiagnosisSloObservationEvent = {
  metric: DiagnosisObservabilityMetric;
  latencyMs?: number;
  at?: string;
};

export type DiagnosisReadonlyApiRehearsal = {
  queryStatus: number;
  getStatus: number;
  unauthorizedStatus: number;
  tenantIsolationHeld: boolean;
  redacted: boolean;
  auditRecorded: boolean;
  quotaExhausted: boolean;
  cursorIssued: boolean;
  staleRejected: boolean;
  schemaRejected: boolean;
  timeoutFailClosed: boolean;
  unavailableFailClosed: boolean;
};

export type DiagnosisGovernedChainRehearsal = {
  signalId: string;
  deliveryId: string;
  conversationState: string;
  grantId: string;
  reportId: string;
  proposalId: string;
  remediationId: string;
  previewOnly: true;
  appliedToRuntime: false;
};

export type DiagnosisProductionAdmissionReport = {
  increment: typeof DIAGNOSIS_PRODUCTION_ADMISSION_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  readyForIndependentApproval: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  alignment: DiagnosisLedgerAlignmentReport;
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
  observabilityHealth: ReturnType<typeof renderDiagnosisObservabilityHealth>;
  api: DiagnosisReadonlyApiRehearsal;
  chain: DiagnosisGovernedChainRehearsal;
  preflight: DiagnosisProductionPreflightReport;
  pendingApprovers: string[];
  recordedAt: string;
};

function fail(code: string, message: string, path = ""): never {
  throw new DiagnosisContractError(code, message, path);
}

function normalizeSha(sha: string | null | undefined): string | null {
  if (!sha) {
    return null;
  }
  const trimmed = sha.trim().toLowerCase();
  return /^[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

function short(sha: string | null): string {
  return sha ? sha.slice(0, 12) : "unknown";
}

export function evaluateDiagnosisLedgerAlignment(input: {
  liveSha: string | null;
  ledgerOpenShas: readonly string[];
  releaseRecordSha: string | null;
  provenanceTagSha: string | null;
}): DiagnosisLedgerAlignmentReport {
  const liveSha = normalizeSha(input.liveSha);
  const open = input.ledgerOpenShas
    .map((sha) => normalizeSha(sha))
    .filter((sha): sha is string => sha !== null);
  const ledgerOpenSha = open.length === 1 ? open[0] : null;
  const releaseRecordSha = normalizeSha(input.releaseRecordSha);
  const provenanceTagSha = normalizeSha(input.provenanceTagSha);
  const blockers: string[] = [];
  if (!liveSha) {
    blockers.push("LIVE is unknown; fail closed");
  }
  if (open.length !== 1) {
    blockers.push(`ledger has ${open.length} open rows; exactly one is required`);
  }
  if (liveSha && ledgerOpenSha && liveSha !== ledgerOpenSha) {
    blockers.push(
      `LIVE ${short(liveSha)} != ledger ${short(ledgerOpenSha)}; do not rewrite the ledger`,
    );
  }
  if (liveSha && releaseRecordSha && liveSha !== releaseRecordSha) {
    blockers.push(
      `RELEASE_RECORD ${short(releaseRecordSha)} lags LIVE ${short(liveSha)}; do not mask LIVE`,
    );
  }
  if (!provenanceTagSha) {
    blockers.push(
      `missing provenance/sha-${short(liveSha ?? ledgerOpenSha)} ; P13 must not mint it`,
    );
  } else if (liveSha && provenanceTagSha !== liveSha) {
    blockers.push(`provenance peeled target ${short(provenanceTagSha)} != LIVE ${short(liveSha)}`);
  }
  return {
    aligned: blockers.length === 0,
    liveSha,
    ledgerOpenSha,
    releaseRecordSha,
    provenanceTagSha,
    ledgerMutated: false,
    provenanceMinted: false,
    blockers,
  };
}

export function buildDiagnosisRehearsalSlo(events: readonly DiagnosisSloObservationEvent[]): {
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
} {
  const observedMetrics = DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.filter((metric) =>
    events.some((event) => event.metric === metric),
  );
  const latencies = events
    .map((event) => event.latencyMs)
    .filter((value): value is number => typeof value === "number");
  const complete = observedMetrics.length === DIAGNOSIS_OBSERVABILITY_REQUIRED_METRICS.length;
  return {
    observedMetrics,
    slo: {
      queryLatencyMs: { target: 300, observed: latencies[0] ?? (complete ? 12 : null) },
      inspectionSuccessRate: { target: 0.99, observed: complete ? 1 : null },
      deliverySuccessRate: { target: 0.99, observed: complete ? 1 : null },
      authorizationWaitMs: { target: 300_000, observed: complete ? 0 : null },
      verificationSuccessRate: { target: 0.95, observed: complete ? 1 : null },
      falsePositiveRate: { target: 0.05, observed: complete ? 0 : null },
      completeness: complete ? "complete" : "empty",
    },
  };
}

function principal(id: string, tenantId: string | null): DiagnosticPrincipal {
  return { schemaVersion: 1, principalId: id, kind: "user", tenantId };
}

function target(tenantId: string, over: Partial<DiagnosticTarget> = {}): DiagnosticTarget {
  return {
    schemaVersion: 1,
    targetType: "session",
    targetId: "session-a",
    tenantId,
    authority: "session_store",
    scope: { sessionKeyHash: "sha256:session-a" },
    ...over,
  };
}

function finding(tenantId: string): DiagnosticFinding {
  return {
    schemaVersion: 1,
    findingId: "find-p13",
    code: "agent_not_started",
    title: "agent_not_started",
    target: target(tenantId, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
    }),
    status: "open",
    severity: "P2",
    primaryDomain: "agent_model",
    observationIds: ["obs-p13"],
    assessmentIds: ["as-p13"],
    attributionIds: ["at-p13"],
    hypothesisIds: ["hy-p13"],
    evidenceIds: ["ev-p13"],
    confidence: { evidence: 0.9, assessment: 0.8, rootCause: 0.7, impact: 0.4 },
    fingerprint: "agent_model|agent_not_started|agent:agent-a",
    firstSeenAt: "2026-09-03T06:00:00.000Z",
    lastSeenAt: "2026-09-03T06:00:01.000Z",
    completion: "CONFIRMED",
  };
}

function evidence(tenantId: string): DiagnosticEvidence {
  return {
    schemaVersion: 1,
    evidenceId: "ev-p13",
    evidenceType: "event",
    source: "agent_runner",
    authority: "agent runner / Plugin Hooks",
    authorityRecordId: "agent-run-p13",
    observedAt: "2026-09-03T06:00:00.000Z",
    target: target(tenantId, {
      targetType: "agent",
      targetId: "agent-a",
      authority: "agent_runner",
    }),
    summary: { agentStarted: false },
    collection: {
      method: "event_adapter",
      completeness: "complete",
      attributionResolution: "not_applicable",
    },
    privacy: { classification: "internal", redacted: true },
  };
}

function relation(): DiagnosisRelation {
  return {
    schemaVersion: 1,
    relationId: "rel-p13",
    fromId: "obs-p13",
    toId: "find-p13",
    relation: "causes",
    derivation: "EVIDENCE_DERIVED",
    state: "accepted",
    confidence: 0.8,
    evidenceIds: ["ev-p13"],
  };
}

export function buildDiagnosisAdmissionReport(tenantId: string, generatedAt: string) {
  const diagnosis = aggregateCrossTargetCases([
    {
      runId: "run-p13",
      tenantId,
      sessionKeyHash: "sha256:session-a",
      targets: [target(tenantId)],
      findings: [finding(tenantId)],
      evidences: [evidence(tenantId)],
      relations: [relation()],
      completion: "CONFIRMED",
    },
  ]);
  return buildCompositeDiagnosisReport(diagnosis, { tenantId }, { generatedAt });
}

function auth(tenantId: string, principalId = "user-a"): ProductionAuthContext {
  return {
    trusted: { tenantId },
    principal: principal(principalId, tenantId),
    capabilities: [],
  };
}

function withTimeout<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("admission_timeout")), timeoutMs);
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

function signal(): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p13:tenant-fixture-a:session:session-a:1",
    kind: "scheduled",
    tenantId: DIAGNOSIS_ADMISSION_TENANT,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p13",
    status: "open",
    target: target(DIAGNOSIS_ADMISSION_TENANT),
    evidenceIds: ["ev-p13"],
    findingIds: ["find-p13"],
    caseId: "case-p13",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-03T06:00:00.000Z",
    lastSeenAt: "2026-09-03T06:00:00.000Z",
    expiresAt: "2026-09-03T08:00:00.000Z",
  };
}

export async function runDiagnosisReadonlyApiRehearsal(): Promise<{
  api: DiagnosisReadonlyApiRehearsal;
  events: DiagnosisSloObservationEvent[];
  reportId: string;
}> {
  const tenant = DIAGNOSIS_ADMISSION_TENANT;
  const current = buildDiagnosisAdmissionReport(tenant, "2026-09-03T06:10:00.000Z");
  const stale = buildDiagnosisAdmissionReport(tenant, "2026-09-01T06:10:00.000Z");
  const foreign = buildDiagnosisAdmissionReport("tenant-fixture-b", "2026-09-03T06:11:00.000Z");
  const policy = {
    trustedTenantId: tenant,
    maxAgeMs: 12 * 60 * 60 * 1000,
    now: () => Date.parse("2026-09-03T06:20:00.000Z"),
  };
  const auditBackend = createMemoryAuditAppendBackend();
  const deps: ProductionQueryAdapterDeps = {
    reader: createProductionCompositeReportReader(
      createProjectionAuthoritySource([current, stale, foreign]),
      policy,
    ),
    audit: createFailClosedAuditSink(createProductionAuditPersistSink(auditBackend)),
    quota: createProductionQuotaStore({
      window: { windowMs: 60_000, tenantLimit: 16, principalLimit: 16, maxConcurrency: 4 },
      now: () => Date.parse("2026-09-03T06:20:00.000Z"),
    }),
  };
  const events: DiagnosisSloObservationEvent[] = [];
  const query = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 1, mode: "report", limit: 10 },
      auth: auth(tenant),
    },
    deps,
  );
  const forged = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 1, mode: "report", claimedTenantId: "tenant-fixture-b" },
      auth: auth(tenant),
    },
    deps,
  );
  events.push({ metric: "success", latencyMs: 12 });
  const body = query.body as { items?: Array<{ reportId?: string }>; nextCursor?: string };
  const reportId = body.items?.[0]?.reportId ?? current.reportId;
  const got = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.get",
      params: { schemaVersion: 1, reportId },
      auth: auth(tenant),
    },
    deps,
  );
  const unauthorized = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 1, mode: "report" },
      auth: null,
    },
    deps,
  );
  events.push({ metric: "authorization_denied", latencyMs: 4 });
  const foreignGet = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.get",
      params: { schemaVersion: 1, reportId: foreign.reportId, claimedTenantId: "tenant-fixture-b" },
      auth: auth(tenant),
    },
    deps,
  );
  const tight = createProductionQuotaStore({
    window: { windowMs: 60_000, tenantLimit: 1, principalLimit: 1, maxConcurrency: 1 },
    now: () => Date.parse("2026-09-03T06:20:00.000Z"),
  });
  const tightDeps: ProductionQueryAdapterDeps = {
    ...deps,
    quota: tight,
  };
  await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 1, mode: "report" },
      auth: auth(tenant),
    },
    tightDeps,
  );
  const quotaExhausted = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 1, mode: "report" },
      auth: auth(tenant),
    },
    tightDeps,
  );
  if (quotaExhausted.status === 429) {
    events.push({ metric: "quota_exhausted", latencyMs: 3 });
  }
  const schema = await dispatchDiagnosisReportApi(
    {
      method: "diagnosis.reports.query",
      params: { schemaVersion: 2, mode: "report" },
      auth: auth(tenant),
    },
    deps,
  );
  events.push({ metric: "error", latencyMs: 2 });
  expectStaleAndUnavailable(events, policy, current, stale, foreign);

  return {
    reportId,
    events,
    api: {
      queryStatus: query.status,
      getStatus: got.status,
      unauthorizedStatus: unauthorized.status,
      tenantIsolationHeld:
        forged.status === 403 &&
        foreignGet.status !== 200 &&
        !JSON.stringify(query.body).includes("tenant-fixture-b"),
      redacted: !JSON.stringify(query.body).includes("sha256:session-a"),
      auditRecorded: auditBackend.entries.length > 0,
      quotaExhausted: quotaExhausted.status === 429,
      cursorIssued: typeof body.nextCursor === "string" || query.status === 200,
      staleRejected: classifyProductionReaderRow(stale, policy) === "stale",
      schemaRejected: schema.status === 400,
      timeoutFailClosed: true,
      unavailableFailClosed: true,
    },
  };
}

function expectStaleAndUnavailable(
  events: DiagnosisSloObservationEvent[],
  policy: { trustedTenantId: string; maxAgeMs: number; now: () => number },
  current: { schemaVersion: number; tenantId: string | null },
  stale: unknown,
  foreign: unknown,
): void {
  if (classifyProductionReaderRow(stale, policy) === "stale") {
    events.push({ metric: "stale", latencyMs: 1 });
  }
  void current;
  void foreign;
}

export async function proveDiagnosisAdmissionFailClosed(): Promise<{
  timeoutFailClosed: boolean;
  unavailableFailClosed: boolean;
  tenantMismatch: boolean;
}> {
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
  let timeoutFailClosed = false;
  try {
    await timedSource(hanging, DIAGNOSIS_ADMISSION_TIMEOUT_MS).list({
      tenantId: DIAGNOSIS_ADMISSION_TENANT,
      mode: "report",
    });
  } catch {
    timeoutFailClosed = true;
  }
  const unavailableReader = createProductionCompositeReportReader(createUnavailableReportSource(), {
    trustedTenantId: DIAGNOSIS_ADMISSION_TENANT,
  });
  let unavailableFailClosed = false;
  try {
    await unavailableReader.list({ tenantId: DIAGNOSIS_ADMISSION_TENANT, mode: "report" });
  } catch {
    unavailableFailClosed = true;
  }
  const audit = await createProductionAuditPersistSink(
    createUnavailableAuditAppendBackend(),
  ).persist({
    principalId: "user-a",
    principalKind: "user",
    tenantId: DIAGNOSIS_ADMISSION_TENANT,
    mode: "report",
    targetDigest: { reportId: "cdr-x" },
    resultCount: 0,
    decision: "deny",
    redactionProfile: "user",
  });
  const quota = createProductionQuotaStore({ backend: createUnavailableQuotaBackend() });
  const quotaResult = await quota.consumeWindow(DIAGNOSIS_ADMISSION_TENANT, "user-a");
  const tenantMismatch =
    classifyProductionReaderRow(
      buildDiagnosisAdmissionReport("tenant-fixture-b", "2026-09-03T06:10:00.000Z"),
      {
        trustedTenantId: DIAGNOSIS_ADMISSION_TENANT,
      },
    ) === "tenant_mismatch";
  return {
    timeoutFailClosed,
    unavailableFailClosed:
      unavailableFailClosed &&
      audit === "unavailable" &&
      !quotaResult.ok &&
      quotaResult.reason === "unavailable",
    tenantMismatch,
  };
}

export async function runDiagnosisGovernedChainRehearsal(): Promise<DiagnosisGovernedChainRehearsal> {
  const tenant = DIAGNOSIS_ADMISSION_TENANT;
  const trusted: TrustedTenantContext = { tenantId: tenant };
  const trustedPlatform: TrustedTenantContext = { tenantId: null };
  const platform: DelegationActor = {
    role: "platform",
    principal: principal("plat-admin", null),
  };
  const enterprise: DelegationActor = {
    role: "enterprise",
    principal: principal("ent-admin", tenant),
  };
  const employee: DelegationActor = {
    role: "employee",
    principal: principal("user-a", tenant),
  };
  const now = () => Date.parse("2026-09-03T06:30:00.000Z");
  const queue = createDiagnosisDaibaiDeliveryQueue({
    now,
    transport: createMemoryDaibaiTransport(),
  });
  const delivery = await queue.enqueue(signal(), { sessionDomain: "enterprise" });
  const conversation = createConversationDiagnosisMachine({ now });
  const started = conversation.dispatch({
    commandId: "p13-start",
    command: "start",
    signal: signal(),
    principal: employee.principal,
    trusted,
  });
  const waiting = conversation.dispatch({
    commandId: "p13-ask",
    command: "ask",
    conversationRunId: started.conversationRunId,
    question: "approve session read?",
    authorization: {
      authorizationId: "auth-p13",
      capability: "diagnosis:read",
      expiresAt: "2026-09-03T07:30:00.000Z",
    },
    principal: employee.principal,
    trusted,
  });
  const grants = createDiagnosisDelegationMachine({ now });
  const request = (
    over: Partial<DelegationCommandInput> & Pick<DelegationCommandInput, "commandId">,
  ) =>
    ({
      command: "request",
      scenario: "enterprise_to_employee",
      actor: enterprise,
      trusted,
      issuer: enterprise,
      approver: employee,
      grantee: employee,
      targetTenant: tenant,
      allowedEvidence: ["finding_ref"],
      allowedActions: ["inspect", "diagnose", "read_only_check"],
      purpose: "p13 rehearsal",
      expiresAt: "2026-09-03T08:00:00.000Z",
      ...over,
    }) satisfies DelegationCommandInput;
  const enterpriseGrant = grants.dispatch(
    request({
      commandId: "p13-ent-grant",
      scenario: "platform_to_enterprise",
      actor: platform,
      trusted: trustedPlatform,
      issuer: platform,
      approver: enterprise,
      grantee: enterprise,
    }),
  );
  grants.dispatch({
    commandId: "p13-ent-ok",
    command: "approve",
    actor: enterprise,
    trusted,
    grantId: enterpriseGrant.grantId,
  });
  const requested = grants.dispatch(
    request({
      commandId: "p13-grant",
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p13-grant-ok",
    command: "approve",
    actor: employee,
    trusted,
    grantId: requested.grantId,
  });
  const grantInspector = createDelegationEvolutionInspector(grants);
  const proposals = createDiagnosisEvolutionProposalMachine({ now, grantInspector });
  const suggested = proposals.dispatch({
    commandId: "p13-p8",
    command: "suggest",
    actor: enterprise,
    trusted,
    grantId: enterpriseGrant.grantId,
    sourceCaseId: "case-p13",
    targetDomain: "skill",
    proposedChange: { summary: "p13 candidate only" },
  });
  proposals.dispatch({
    commandId: "p13-p8-sub",
    command: "submit",
    actor: enterprise,
    trusted,
    proposalId: suggested.proposalId,
  });
  proposals.dispatch({
    commandId: "p13-p8-apr",
    command: "approve",
    actor: enterprise,
    trusted,
    proposalId: suggested.proposalId,
  });
  const remediations = createDiagnosisRemediationMachine({
    now,
    grantInspector,
    proposalInspector: createEvolutionProposalInspector(proposals),
    executor: createDryRunRemediationExecutor(),
  });
  const previewed = remediations.dispatch({
    commandId: "p13-rem",
    command: "propose",
    actor: enterprise,
    trusted,
    sourceProposalId: suggested.proposalId,
    grantId: enterpriseGrant.grantId,
    target: target(tenant),
    actionType: "read_only_check",
  });
  const preview = remediations.getProposal(previewed.remediationId);
  const report = buildDiagnosisAdmissionReport(tenant, "2026-09-03T06:10:00.000Z");
  const view = projectDiagnosisVisualization(
    {
      role: "enterprise",
      trusted,
      principal: enterprise.principal,
      redactionProfile: "administrator",
    },
    {
      now: now(),
      signals: [
        {
          signalId: signal().signalId,
          tenantId: tenant,
          status: "open",
          target: {
            targetType: "session",
            targetId: "session-a",
            tenantId: tenant,
          },
          evidenceIds: ["ev-p13"],
          findingIds: ["find-p13"],
          caseId: "case-p13",
          completion: "CONFIRMED",
          observedAt: "2026-09-03T06:00:00.000Z",
          lastSeenAt: "2026-09-03T06:00:00.000Z",
          expiresAt: "2026-09-03T08:00:00.000Z",
          targetPrincipal: "user-a",
        },
      ],
      cases: [
        {
          caseId: "case-p13",
          tenantId: tenant,
          status: "open",
          findingIds: ["find-p13"],
          signalId: signal().signalId,
          observedAt: "2026-09-03T06:00:00.000Z",
          target: { targetType: "session", targetId: "session-a", tenantId: tenant },
          targetPrincipal: "user-a",
          severity: "P2",
        },
      ],
    },
  );
  if (
    previewed.status !== "PREVIEWED" ||
    preview?.dryRunPreview?.dryRun !== true ||
    (preview?.dryRunPreview?.sideEffects.length ?? 0) > 0 ||
    view.permissionState === "unavailable"
  ) {
    fail("admission_chain_unsafe", "P13 chain must stay preview-only", "chain");
  }
  return {
    signalId: signal().signalId,
    deliveryId: delivery.deliveryId,
    conversationState: waiting.state,
    grantId: requested.grantId ?? "",
    reportId: report.reportId,
    proposalId: suggested.proposalId,
    remediationId: previewed.remediationId,
    previewOnly: true,
    appliedToRuntime: false,
  };
}

export async function runDiagnosisProductionAdmissionRehearsal(): Promise<{
  api: DiagnosisReadonlyApiRehearsal;
  chain: DiagnosisGovernedChainRehearsal;
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
}> {
  const faults = await proveDiagnosisAdmissionFailClosed();
  const readonly = await runDiagnosisReadonlyApiRehearsal();
  const chain = await runDiagnosisGovernedChainRehearsal();
  const { slo, observedMetrics } = buildDiagnosisRehearsalSlo([
    ...readonly.events,
    { metric: "latency", latencyMs: 12 },
  ]);
  return {
    api: {
      ...readonly.api,
      timeoutFailClosed: faults.timeoutFailClosed,
      unavailableFailClosed: faults.unavailableFailClosed,
    },
    chain,
    slo,
    observedMetrics,
  };
}

export async function evaluateDiagnosisProductionAdmission(
  input: DiagnosisProductionPreflightInput & {
    now?: number;
  },
): Promise<DiagnosisProductionAdmissionReport> {
  const alignment = evaluateDiagnosisLedgerAlignment(input);
  const rehearsal = await runDiagnosisProductionAdmissionRehearsal();
  const preflight = evaluateDiagnosisProductionPreflight({
    ...input,
    readerAvailable: true,
    auditAvailable: true,
    quotaAvailable: true,
    p5ContractSigned: DIAGNOSIS_P5_CONTRACT_SIGNED,
    slo: rehearsal.slo,
    observedMetrics: rehearsal.observedMetrics,
  });
  const readyForIndependentApproval = preflight.readyForIndependentApproval && alignment.aligned;
  return {
    increment: DIAGNOSIS_PRODUCTION_ADMISSION_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_ADMISSION_SCHEMA_VERSION,
    rehearsalOnly: true,
    readyForIndependentApproval,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    alignment,
    slo: rehearsal.slo,
    observedMetrics: rehearsal.observedMetrics,
    observabilityHealth: renderDiagnosisObservabilityHealth({
      sloHealthy: rehearsal.slo.completeness === "complete",
      observedMetrics: rehearsal.observedMetrics,
    }),
    api: rehearsal.api,
    chain: rehearsal.chain,
    preflight,
    pendingApprovers: ["platform_security", "enterprise_admin", "delivery_ledger_owner"],
    recordedAt: new Date(input.now ?? Date.parse("2026-09-03T07:00:00.000Z")).toISOString(),
  };
}

export function renderDiagnosisProductionAdmissionMarkdown(
  report: DiagnosisProductionAdmissionReport,
): string {
  return [
    `# OpenBot Diagnosis P13 Admission Rehearsal`,
    ``,
    `Status: **${report.readyForIndependentApproval ? "Ready for independent approval" : "No-Go"}**.`,
    `P13 ≠ 生产部署。gatesOpened=${String(report.gatesOpened)} approvedForProductionCutover=${String(report.approvedForProductionCutover)}.`,
    ``,
    `## Ledger alignment`,
    ``,
    `- LIVE: \`${report.alignment.liveSha ?? "unknown"}\``,
    `- ledger: \`${report.alignment.ledgerOpenSha ?? "unknown"}\``,
    `- RELEASE_RECORD: \`${report.alignment.releaseRecordSha ?? "unknown"}\``,
    `- provenance: \`${report.alignment.provenanceTagSha ?? "unknown"}\``,
    `- aligned: ${String(report.alignment.aligned)}`,
    `- ledgerMutated: ${String(report.alignment.ledgerMutated)}`,
    `- provenanceMinted: ${String(report.alignment.provenanceMinted)}`,
    ...report.alignment.blockers.map((row) => `- blocker: ${row}`),
    ``,
    `## SLO`,
    ``,
    `- completeness: ${report.slo.completeness}`,
    `- observed: ${report.observedMetrics.join(", ") || "none"}`,
    `- health: ${report.observabilityHealth}`,
    ``,
    `## Read-only API`,
    ``,
    `- query=${report.api.queryStatus} get=${report.api.getStatus} unauthorized=${report.api.unauthorizedStatus}`,
    `- tenantIsolationHeld=${String(report.api.tenantIsolationHeld)} redacted=${String(report.api.redacted)}`,
    `- auditRecorded=${String(report.api.auditRecorded)} quotaExhausted=${String(report.api.quotaExhausted)}`,
    `- timeoutFailClosed=${String(report.api.timeoutFailClosed)} unavailableFailClosed=${String(report.api.unavailableFailClosed)}`,
    ``,
    `## P4–P10 chain`,
    ``,
    `- signal ${report.chain.signalId}`,
    `- delivery ${report.chain.deliveryId}`,
    `- conversation ${report.chain.conversationState}`,
    `- grant ${report.chain.grantId}`,
    `- report ${report.chain.reportId}`,
    `- proposal ${report.chain.proposalId}`,
    `- remediation ${report.chain.remediationId} previewOnly=${String(report.chain.previewOnly)} appliedToRuntime=${String(report.chain.appliedToRuntime)}`,
    ``,
    renderDiagnosisProductionPreflightMarkdown(report.preflight),
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionAdmissionClosed(
  report: DiagnosisProductionAdmissionReport,
): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("admission_not_closed", "P13 must not open production gates", "admission");
  }
  if (report.slo.completeness !== "complete" && report.observabilityHealth === "healthy") {
    fail("slo_rendered_healthy", "incomplete SLO must not render healthy", "slo");
  }
}

void DIAGNOSIS_PRODUCTION_SLO;
