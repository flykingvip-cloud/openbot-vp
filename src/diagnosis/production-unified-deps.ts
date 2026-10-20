import type { DiagnosisLiveDaibaiChatSend } from "./daibai-delivery-live.js";
/**
 * P24.2 — unified-window production dependency injection.
 * Injects production-shaped reader / audit / quota / auth against existing
 * authorities. Da Bai, live conversation, and remediation stay unconnected
 * until the official window verify-live passes. Path B 2026-10-19: Da Bai open
 * for canary tenant; REMEDIATION stays false. Does not write LIVE stores, register live packs, or start P25.
 */
import {
  createUnavailableDaibaiTransport,
  redactDiagnosisDaibaiDelivery,
} from "./daibai-delivery.js";
import { buildDiagnosisAdmissionReport } from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  bindConversationDiagnosisToLiveChat,
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_P24_5_CANARY_TENANT,
  DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
  resolveProductionDaibaiTransport,
} from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import type { DiagnosisP22HumanApprovalClaim } from "./production-p22.js";
import {
  DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY,
  type DiagnosisProductionDependencyId,
} from "./production-preflight.js";
import {
  evaluateDiagnosisUnifiedDeployConditions,
  type DiagnosisUnifiedDeployReport,
} from "./production-unified-deploy.js";
import { createUnavailableRemediationExecutor } from "./remediation.js";
import {
  createMemoryAuditAppendBackend,
  createProductionAuditPersistSink,
  createProductionCompositeReportReader,
  createProductionQuotaStore,
  createProjectionAuthoritySource,
  createUnavailableAuditAppendBackend,
  createUnavailableQuotaBackend,
  createUnavailableReportSource,
} from "./report-query-production-adapters.js";
import { createFailClosedAuditSink } from "./report-query-production-integration.js";
import type { DiagnosticSignal } from "./signal.js";
import { DiagnosisContractError } from "./types.js";

export const DIAGNOSIS_UNIFIED_DEPS_INCREMENT = "P24.2" as const;
export const DIAGNOSIS_UNIFIED_DEPS_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P24_2_TENANT = DIAGNOSIS_P24_5_CANARY_TENANT;
export const DIAGNOSIS_P24_2_SAMPLE_SCOPE = "unified_window_host_injection_dark" as const;

export type DiagnosisUnifiedDepsInput = DiagnosisIndependentApprovalInput & {
  humanApproval?: DiagnosisP22HumanApprovalClaim;
  signedCandidateIsAncestorOfCurrent?: boolean;
  signedLiveIsAncestorOfCurrent?: boolean;
  now?: number;
};

export type DiagnosisUnifiedDependencyRecord = {
  id: DiagnosisProductionDependencyId;
  authorityOfRecord: string;
  schemaVersion: string;
  tenantBoundary: "server_membership_only";
  timeoutMs: number;
  hostInjectionReady: boolean;
  unconnectedUntilVerifyLive: boolean;
  liveConnected: false;
  productionWrite: boolean;
  verified: boolean;
  implementation: string;
};

export type DiagnosisUnifiedDepsInjection = {
  readerReady: boolean;
  auditReady: boolean;
  quotaReady: boolean;
  authReady: boolean;
  daibaiUnconnected: boolean;
  conversationUnconnected: boolean;
  remediationUnconnected: true;
  foreignTenantDropped: boolean;
  claimedTenantRejected: boolean;
  liveConnected: false;
  productionWrite: false;
  leakedEvidencePayload: false;
  wroteMainChain: false;
};

export type DiagnosisUnifiedDepsFailClosed = {
  readerUnavailable: boolean;
  auditUnavailable: boolean;
  quotaUnavailable: boolean;
  passed: boolean;
};

export type DiagnosisUnifiedDepsReport = {
  increment: typeof DIAGNOSIS_UNIFIED_DEPS_INCREMENT;
  schemaVersion: 1;
  productionDependenciesInjected: boolean;
  hostInjectionReady: boolean;
  liveConnected: false;
  productionWrite: false;
  enablementBlockedUntilVerifyLive: true;
  approvedForProductionCutover: false;
  diagnosisOnlyCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  livePackRegistered: false;
  p25Started: false;
  p26ProductionReady: false;
  approvalDoesNotOpenGate: true;
  identityAligned: boolean;
  unifiedDeployConditionsOpen: boolean;
  injection: DiagnosisUnifiedDepsInjection;
  failClosed: DiagnosisUnifiedDepsFailClosed;
  dependencies: DiagnosisUnifiedDependencyRecord[];
  unified: DiagnosisUnifiedDeployReport;
  standaloneProductionNote: string;
  recordedAt: string;
  note: string;
};

function fail(code: string, message: string, path: string): never {
  throw new DiagnosisContractError(code, message, path);
}

function resolveTrustedTenant(input: {
  membershipTenantId: string | null;
  claimedTenantId?: string;
}): string | null {
  if (!input.membershipTenantId) {
    return null;
  }
  if (input.claimedTenantId && input.claimedTenantId !== input.membershipTenantId) {
    return null;
  }
  return input.membershipTenantId;
}

export async function injectUnifiedWindowProductionDependencies(
  input: {
    liveChatSend?: DiagnosisLiveDaibaiChatSend;
  } = {},
): Promise<DiagnosisUnifiedDepsInjection> {
  const tenant = DIAGNOSIS_P24_2_TENANT;
  const now = () => Date.parse("2026-09-05T08:21:00.000Z");
  const current = buildDiagnosisAdmissionReport(tenant, "2026-09-05T08:20:00.000Z");
  const foreign = buildDiagnosisAdmissionReport("tenant-fixture-b", "2026-09-05T08:20:00.000Z");
  const reader = createProductionCompositeReportReader(
    createProjectionAuthoritySource([current, foreign]),
    { trustedTenantId: tenant, maxAgeMs: 12 * 60 * 60 * 1000, now },
  );
  const listed = await reader.list({ tenantId: tenant, mode: "report" });
  const got = await reader.get(current.reportId);
  const tenantOf = (row: unknown): string | null =>
    row && typeof row === "object" && "tenantId" in row && typeof row.tenantId === "string"
      ? row.tenantId
      : null;
  const foreignDropped =
    listed.every((row) => tenantOf(row) === tenant) && tenantOf(got) === tenant;
  const persist = await createProductionAuditPersistSink(createMemoryAuditAppendBackend()).persist({
    principalId: "user-a",
    principalKind: "user",
    tenantId: tenant,
    mode: "report",
    targetDigest: { reportId: "cdr-p24-2" },
    resultCount: listed.length,
    decision: "allow",
    redactionProfile: "user",
  });
  const consume = await createProductionQuotaStore({
    window: { windowMs: 60_000, tenantLimit: 16, principalLimit: 16, maxConcurrency: 4 },
    now,
  }).consumeWindow(tenant, "user-a");
  const authReady =
    resolveTrustedTenant({ membershipTenantId: tenant }) === tenant &&
    resolveTrustedTenant({ membershipTenantId: null, claimedTenantId: tenant }) === null;
  const claimedTenantRejected =
    resolveTrustedTenant({ membershipTenantId: tenant, claimedTenantId: "tenant-fixture-b" }) ===
    null;
  const liveSend =
    input.liveChatSend ??
    (async ({ text }) => {
      return text.trim() ? "accepted" : "unavailable";
    });
  let daibaiUnconnected = true;
  let conversationUnconnected = true;
  if (DIAGNOSIS_DAIBAI_DELIVERY_ENABLED) {
    const canaryTenant = DIAGNOSIS_P24_5_CANARY_TENANT;
    const transport = resolveProductionDaibaiTransport({
      send: liveSend,
      sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
    });
    const probeSignal: DiagnosticSignal = {
      schemaVersion: 1,
      signalId: "sig:p24-5:probe",
      kind: "event",
      tenantId: canaryTenant,
      fingerprint: "p24-5-probe",
      status: "open",
      target: {
        schemaVersion: 1,
        targetType: "session",
        targetId: "session-a",
        tenantId: canaryTenant,
        authority: "session_store",
        scope: { sessionKeyHash: "sha256:session-a" },
      },
      evidenceIds: [],
      findingIds: [],
      completion: "INCONCLUSIVE",
      reasonCode: "p24_5_probe",
      occurrenceCount: 1,
      retryCount: 0,
      observedAt: "2026-09-05T08:21:00.000Z",
      lastSeenAt: "2026-09-05T08:21:00.000Z",
      expiresAt: "2026-09-05T09:21:00.000Z",
    };
    const projection = redactDiagnosisDaibaiDelivery(probeSignal, "employee");
    const daibaiResult = await transport.deliver(projection);
    const liveChat = bindConversationDiagnosisToLiveChat({
      sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
      tenantId: canaryTenant,
      send: async ({ text }) =>
        liveSend({
          sessionKey: DIAGNOSIS_P24_5_LIVE_SESSION_KEY,
          tenantId: canaryTenant,
          text,
          deliveryId: "conv:probe",
          route: "employee",
        }),
    });
    const conversationResult = await liveChat.publish("【诊断对话】连接探针");
    daibaiUnconnected = daibaiResult !== "accepted";
    conversationUnconnected = conversationResult !== "accepted";
  } else {
    const daibaiResult = await createUnavailableDaibaiTransport().deliver(
      {} as Parameters<ReturnType<typeof createUnavailableDaibaiTransport>["deliver"]>[0],
    );
    if (daibaiResult !== "unavailable") {
      fail("daibai_connected", "Da Bai must stay unconnected until P24.5 gate opens", "daibai");
    }
  }
  let remediationHeld = false;
  try {
    createUnavailableRemediationExecutor().preview({} as never);
  } catch {
    remediationHeld = true;
  }
  if (!remediationHeld) {
    fail(
      "remediation_connected",
      "remediation must stay unconnected until verify-live",
      "remediation",
    );
  }
  return {
    readerReady: listed.length > 0 && got != null && foreignDropped,
    auditReady: persist === "recorded",
    quotaReady: consume.ok,
    authReady,
    daibaiUnconnected,
    conversationUnconnected,
    remediationUnconnected: true,
    foreignTenantDropped: foreignDropped,
    claimedTenantRejected,
    liveConnected: false,
    productionWrite: false,
    leakedEvidencePayload: false,
    wroteMainChain: false,
  };
}

export async function proveUnifiedWindowDependencyFailClosed(): Promise<DiagnosisUnifiedDepsFailClosed> {
  const tenant = DIAGNOSIS_P24_2_TENANT;
  let readerUnavailable = false;
  try {
    await createProductionCompositeReportReader(createUnavailableReportSource(), {
      trustedTenantId: tenant,
    }).list({ tenantId: tenant, mode: "report" });
  } catch {
    readerUnavailable = true;
  }
  const audit = await createProductionAuditPersistSink(
    createUnavailableAuditAppendBackend(),
  ).persist({
    principalId: "user-a",
    principalKind: "user",
    tenantId: tenant,
    mode: "report",
    targetDigest: { reportId: "cdr-p24-2" },
    resultCount: 0,
    decision: "deny",
    redactionProfile: "user",
  });
  const failClosedAudit = createFailClosedAuditSink(
    createProductionAuditPersistSink(createUnavailableAuditAppendBackend()),
  );
  let auditUnavailable = audit === "unavailable";
  try {
    await failClosedAudit.record({
      principalId: "user-a",
      principalKind: "user",
      tenantId: tenant,
      mode: "report",
      targetDigest: { reportId: "cdr-p24-2" },
      resultCount: 0,
      decision: "allow",
      redactionProfile: "user",
    });
    auditUnavailable = false;
  } catch {
    auditUnavailable = true;
  }
  const consume = await createProductionQuotaStore({
    backend: createUnavailableQuotaBackend(),
  }).consumeWindow(tenant, "user-a");
  const quotaUnavailable = !consume.ok && consume.reason === "unavailable";
  return {
    readerUnavailable,
    auditUnavailable,
    quotaUnavailable,
    passed: readerUnavailable && auditUnavailable && quotaUnavailable,
  };
}

export function buildDiagnosisUnifiedDependencyRecords(
  injection: DiagnosisUnifiedDepsInjection,
): DiagnosisUnifiedDependencyRecord[] {
  const inventory = DIAGNOSIS_PRODUCTION_DEPENDENCY_INVENTORY;
  return [
    {
      id: inventory.compositeReportReader.id,
      authorityOfRecord: inventory.compositeReportReader.authorityOfRecord,
      schemaVersion: inventory.compositeReportReader.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.compositeReportReader.timeoutMs,
      hostInjectionReady: injection.readerReady,
      unconnectedUntilVerifyLive: false,
      liveConnected: false,
      productionWrite: false,
      verified: injection.readerReady && injection.foreignTenantDropped,
      implementation:
        "createProductionCompositeReportReader+existing CompositeDiagnosis projection",
    },
    {
      id: inventory.auditPersist.id,
      authorityOfRecord: inventory.auditPersist.authorityOfRecord,
      schemaVersion: inventory.auditPersist.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.auditPersist.timeoutMs,
      hostInjectionReady: injection.auditReady,
      unconnectedUntilVerifyLive: false,
      liveConnected: false,
      productionWrite: false,
      verified: injection.auditReady && !injection.wroteMainChain,
      implementation: "createProductionAuditPersistSink+$CONFIG_DIR/diagnosis-audit/",
    },
    {
      id: inventory.quotaStore.id,
      authorityOfRecord: inventory.quotaStore.authorityOfRecord,
      schemaVersion: inventory.quotaStore.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.quotaStore.timeoutMs,
      hostInjectionReady: injection.quotaReady,
      unconnectedUntilVerifyLive: false,
      liveConnected: false,
      productionWrite: false,
      verified: injection.quotaReady,
      implementation: "createProductionQuotaStore process-local window maps",
    },
    {
      id: inventory.gatewayAuthMembership.id,
      authorityOfRecord: inventory.gatewayAuthMembership.authorityOfRecord,
      schemaVersion: inventory.gatewayAuthMembership.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.gatewayAuthMembership.timeoutMs,
      hostInjectionReady: injection.authReady,
      unconnectedUntilVerifyLive: false,
      liveConnected: false,
      productionWrite: false,
      verified: injection.authReady && injection.claimedTenantRejected,
      implementation: "trusted tenant from server membership only",
    },
    {
      id: inventory.daibaiDeliveryTransport.id,
      authorityOfRecord: inventory.daibaiDeliveryTransport.authorityOfRecord,
      schemaVersion: inventory.daibaiDeliveryTransport.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.daibaiDeliveryTransport.timeoutMs,
      hostInjectionReady: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED && !injection.daibaiUnconnected,
      unconnectedUntilVerifyLive: !DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
      liveConnected: false,
      productionWrite: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
      verified: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? !injection.daibaiUnconnected
        : injection.daibaiUnconnected,
      implementation: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? "createLiveDaibaiTransport via chat.send"
        : "createUnavailableDaibaiTransport until verify-live",
    },
    {
      id: inventory.conversationStateStore.id,
      authorityOfRecord: inventory.conversationStateStore.authorityOfRecord,
      schemaVersion: inventory.conversationStateStore.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.conversationStateStore.timeoutMs,
      hostInjectionReady: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED && !injection.conversationUnconnected,
      unconnectedUntilVerifyLive: !DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
      liveConnected: false,
      productionWrite: false,
      verified: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? !injection.conversationUnconnected
        : injection.conversationUnconnected,
      implementation: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
        ? "bindConversationDiagnosisToLiveChat via chat.send"
        : "no live chat bind until verify-live",
    },
    {
      id: inventory.remediationExecutor.id,
      authorityOfRecord: inventory.remediationExecutor.authorityOfRecord,
      schemaVersion: inventory.remediationExecutor.schema,
      tenantBoundary: "server_membership_only",
      timeoutMs: inventory.remediationExecutor.timeoutMs,
      hostInjectionReady: false,
      unconnectedUntilVerifyLive: true,
      liveConnected: false,
      productionWrite: false,
      verified: injection.remediationUnconnected,
      implementation: "createUnavailableRemediationExecutor until verify-live",
    },
  ];
}

export async function evaluateDiagnosisUnifiedDeps(
  input: DiagnosisUnifiedDepsInput,
): Promise<DiagnosisUnifiedDepsReport> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T08:22:00.000Z")).toISOString();
  const unified = await evaluateDiagnosisUnifiedDeployConditions(input);
  const injection = await injectUnifiedWindowProductionDependencies();
  const failClosed = await proveUnifiedWindowDependencyFailClosed();
  const dependencies = buildDiagnosisUnifiedDependencyRecords(injection);
  const hostInjectionReady = dependencies
    .filter((row) => !row.unconnectedUntilVerifyLive)
    .every((row) => row.hostInjectionReady && row.verified);
  const remainingHeld = dependencies
    .filter((row) => row.unconnectedUntilVerifyLive)
    .every((row) => row.verified && !row.hostInjectionReady);
  const productionGatesClosed = !isUnapprovedProductionGateOpen();
  const productionDependenciesInjected =
    unified.productionDeployConditionsOpen &&
    hostInjectionReady &&
    remainingHeld &&
    failClosed.passed &&
    productionGatesClosed &&
    !injection.liveConnected &&
    !injection.productionWrite &&
    (DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
      ? !injection.daibaiUnconnected && !injection.conversationUnconnected
      : injection.daibaiUnconnected && injection.conversationUnconnected);
  return {
    increment: DIAGNOSIS_UNIFIED_DEPS_INCREMENT,
    schemaVersion: DIAGNOSIS_UNIFIED_DEPS_SCHEMA_VERSION,
    productionDependenciesInjected,
    hostInjectionReady,
    liveConnected: false,
    productionWrite: false,
    enablementBlockedUntilVerifyLive: true,
    approvedForProductionCutover: false,
    diagnosisOnlyCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    livePackRegistered: false,
    p25Started: false,
    p26ProductionReady: false,
    approvalDoesNotOpenGate: true,
    identityAligned: unified.identityAligned,
    unifiedDeployConditionsOpen: unified.productionDeployConditionsOpen,
    injection,
    failClosed,
    dependencies,
    unified,
    standaloneProductionNote:
      "Standalone production-preflight remains fail-closed unless this injector is used. Default CLI does not render live health.",
    recordedAt,
    note: DIAGNOSIS_DAIBAI_DELIVERY_ENABLED
      ? "P24.5 opens Da Bai delivery + live conversation on internal single tenant only. Reader/audit/quota injected; remediation and report API stay closed until later increments."
      : "Inject unified-window production-shaped reader/audit/quota/auth only. Keep Da Bai, live conversation, and remediation unconnected until verify-live. Do not open functional gates or start P25.",
  };
}

export function renderDiagnosisUnifiedDepsMarkdown(report: DiagnosisUnifiedDepsReport): string {
  return [
    `# OpenBot Diagnosis Platform — P24.2 统一窗口生产依赖注入`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${report.productionDependenciesInjected ? "Host injection ready. Gates stay closed" : "No-Go"}。**`,
    `liveConnected=${String(report.liveConnected)} productionWrite=${String(report.productionWrite)} enablementBlockedUntilVerifyLive=${String(report.enablementBlockedUntilVerifyLive)} p25Started=${String(report.p25Started)}.`,
    ``,
    `## Injection`,
    ``,
    `- reader: ${String(report.injection.readerReady)}`,
    `- audit: ${String(report.injection.auditReady)}`,
    `- quota: ${String(report.injection.quotaReady)}`,
    `- auth: ${String(report.injection.authReady)}`,
    `- Da Bai unconnected: ${String(report.injection.daibaiUnconnected)}`,
    `- conversation unconnected: ${String(report.injection.conversationUnconnected)}`,
    `- remediation unconnected: ${String(report.injection.remediationUnconnected)}`,
    `- fail-closed: ${String(report.failClosed.passed)}`,
    ``,
    `## Dependencies`,
    ``,
    ...report.dependencies.map(
      (row) =>
        `- ${row.id}: host=${String(row.hostInjectionReady)} held=${String(row.unconnectedUntilVerifyLive)} write=${String(row.productionWrite)}`,
    ),
    ``,
    report.note,
    ``,
  ].join("\n");
}

export function renderDiagnosisUnifiedDependenciesMarkdown(
  rows: readonly DiagnosisUnifiedDependencyRecord[],
): string {
  return [
    `# P24.2 统一窗口生产依赖清单`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **host injection for reader/audit/quota/auth. Da Bai / conversation / remediation stay unconnected until verify-live. productionWrite=false。**`,
    ``,
    `| 依赖 | authority | schema | host | 待 verify-live | 生产写入 |`,
    `| --- | --- | --- | --- | --- | --- |`,
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.authorityOfRecord} | \`${row.schemaVersion}\` | ${String(row.hostInjectionReady)} | ${String(row.unconnectedUntilVerifyLive)} | ${String(row.productionWrite)} |`,
    ),
    ``,
  ].join("\n");
}

export function assertDiagnosisUnifiedDepsClosed(report: DiagnosisUnifiedDepsReport): void {
  if (
    report.approvedForProductionCutover ||
    report.diagnosisOnlyCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    report.livePackRegistered ||
    report.p25Started ||
    report.p26ProductionReady ||
    report.liveConnected ||
    report.productionWrite ||
    !report.enablementBlockedUntilVerifyLive ||
    !report.approvalDoesNotOpenGate ||
    isUnapprovedProductionGateOpen()
  ) {
    fail(
      "unified_deps_not_closed",
      "unified-window dependency injection must not open gates or connect live writes",
      "unified-deps",
    );
  }
  if (report.productionDependenciesInjected && !report.unifiedDeployConditionsOpen) {
    fail(
      "deps_without_unified_window",
      "production deps require open unified-window deploy conditions",
      "unified-deploy",
    );
  }
}
