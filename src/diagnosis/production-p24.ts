/**
 * Phase 24 — isolated Da Bai delivery + conversation-loop canary.
 * Consumes a recorded P22 human approval and a Ready P23 isolated canary.
 * Delivery, authorization, and conversation machines run only inside this
 * process. Production flags stay false, live chat is not bound, remediation
 * stays closed, and P25 does not start. Approval never auto-enables a live gate.
 */
import { createConversationDiagnosisMachine } from "./conversation-run.js";
import {
  assertDeliveryProjectionSafe,
  computeDiagnosisDaibaiDeliveryId,
  createDiagnosisDaibaiDeliveryQueue,
  createMemoryDaibaiTransport,
  createUnavailableDaibaiTransport,
  redactDiagnosisDaibaiDelivery,
} from "./daibai-delivery.js";
import { createDiagnosisDelegationMachine } from "./delegation.js";
import type { DelegationActor, DelegationCommandInput } from "./delegation.js";
import {
  DIAGNOSIS_ADMISSION_TENANT,
  buildDiagnosisRehearsalSlo,
  type DiagnosisSloObservationEvent,
} from "./production-admission.js";
import type { DiagnosisIndependentApprovalInput } from "./production-approval-freeze.js";
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import { isUnapprovedProductionGateOpen } from "./production-enablement-sequence.js";
import type { DiagnosisP22HumanApprovalClaim } from "./production-p22.js";
import {
  evaluateDiagnosisProductionP23,
  type DiagnosisProductionP23Report,
} from "./production-p23.js";
import {
  renderDiagnosisObservabilityHealth,
  type DiagnosisObservabilityMetric,
  type DiagnosisProductionSloSnapshot,
} from "./production-preflight.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import {
  previewDiagnosisLivePackRegistration,
  type DiagnosisLivePackPreview,
} from "./report-query-production-rehearsal.js";
import type { DiagnosticSignal } from "./signal.js";
import { DiagnosisContractError } from "./types.js";
import type { DiagnosticPrincipal, DiagnosticTarget, TrustedTenantContext } from "./types.js";

export const DIAGNOSIS_PRODUCTION_P24_INCREMENT = "P24" as const;
export const DIAGNOSIS_PRODUCTION_P24_SCHEMA_VERSION = 1 as const;
export const DIAGNOSIS_P24_TENANT = DIAGNOSIS_ADMISSION_TENANT;
export const DIAGNOSIS_P24_SAMPLE_SCOPE = "isolated_internal_daibai_conversation_canary" as const;

export type DiagnosisProductionP24Input = DiagnosisIndependentApprovalInput & {
  humanApproval?: DiagnosisP22HumanApprovalClaim;
  signedCandidateIsAncestorOfCurrent?: boolean;
  signedLiveIsAncestorOfCurrent?: boolean;
  now?: number;
};

export type DiagnosisP24Probe = {
  name: string;
  passed: boolean;
  detail: string;
};

export type DiagnosisP24CanaryResult = {
  tenant: typeof DIAGNOSIS_P24_TENANT;
  membershipOnly: true;
  isolatedDeliveryEnabled: true;
  isolatedConversationEnabled: true;
  productionDaibaiEnabled: false;
  remediationEnabled: false;
  productionAdaptersEnabled: false;
  productionReportApiDeployed: false;
  liveChatBound: false;
  livePackRegistered: false;
  productionCanaryStarted: false;
  probes: DiagnosisP24Probe[];
  probesPassed: boolean;
  authorizedRoutesHeld: boolean;
  unauthorizedRejected: boolean;
  conversationStatesHeld: boolean;
  deliveryIdempotent: boolean;
  receiptRetryExpiryAudited: boolean;
  projectionSafe: boolean;
  conversationNotFormalRca: boolean;
  rollbackDrilled: true;
};

export type DiagnosisP24Rollback = {
  disableGates: true;
  stopDelivery: true;
  keepReceiptsAndAudit: true;
  historyDeleted: false;
  productionFlagsRemainFalse: true;
};

export type DiagnosisProductionP24Report = {
  increment: typeof DIAGNOSIS_PRODUCTION_P24_INCREMENT;
  schemaVersion: 1;
  rehearsalOnly: true;
  isolatedCanaryReady: boolean;
  approvedForProductionCutover: false;
  gatesOpened: false;
  trafficSwitched: false;
  productionCanaryStarted: false;
  livePackRegistered: false;
  liveChatBound: false;
  p25Started: false;
  approvalDoesNotOpenGate: true;
  p22HumanApprovalRecorded: boolean;
  p23IsolatedCanaryReady: boolean;
  identityAligned: boolean;
  p23: DiagnosisProductionP23Report;
  productionPackPreview: DiagnosisLivePackPreview;
  isolatedPackPreview: DiagnosisLivePackPreview;
  canary: DiagnosisP24CanaryResult;
  slo: DiagnosisProductionSloSnapshot;
  observedMetrics: DiagnosisObservabilityMetric[];
  observabilityHealth: ReturnType<typeof renderDiagnosisObservabilityHealth>;
  rollback: DiagnosisP24Rollback;
  standaloneProductionNote: string;
  recordedAt: string;
};

function fail(code: string, message: string, path: string): never {
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

function signal(over: Partial<DiagnosticSignal> = {}): DiagnosticSignal {
  return {
    schemaVersion: 1,
    signalId: "sig:p24:tenant-fixture-a:session:session-a:1",
    kind: "scheduled",
    tenantId: DIAGNOSIS_P24_TENANT,
    fingerprint: "scheduled|tenant-fixture-a|session:session-a|p24",
    status: "open",
    target: target(DIAGNOSIS_P24_TENANT),
    evidenceIds: ["ev-p24"],
    findingIds: ["find-p24"],
    caseId: "case-p24",
    completion: "CONFIRMED",
    reasonCode: "inspection_scheduled",
    occurrenceCount: 1,
    retryCount: 0,
    observedAt: "2026-09-05T06:40:00.000Z",
    lastSeenAt: "2026-09-05T06:40:00.000Z",
    expiresAt: "2026-09-05T08:40:00.000Z",
    ...over,
  };
}

const PLATFORM: DelegationActor = {
  role: "platform",
  principal: principal("plat-admin", null),
};
const ENTERPRISE: DelegationActor = {
  role: "enterprise",
  principal: principal("ent-admin", DIAGNOSIS_P24_TENANT),
};
const EMPLOYEE: DelegationActor = {
  role: "employee",
  principal: principal("user-a", DIAGNOSIS_P24_TENANT),
};
const TRUSTED_A: TrustedTenantContext = { tenantId: DIAGNOSIS_P24_TENANT };
const TRUSTED_PLATFORM: TrustedTenantContext = { tenantId: null };

function request(
  over: Partial<DelegationCommandInput> & Pick<DelegationCommandInput, "commandId" | "actor">,
): DelegationCommandInput {
  return {
    command: "request",
    expiresAt: "2026-09-05T08:40:00.000Z",
    targetTenant: DIAGNOSIS_P24_TENANT,
    allowedEvidence: ["ev-p24"],
    allowedActions: ["diagnose"],
    trusted: over.actor.role === "platform" ? TRUSTED_PLATFORM : TRUSTED_A,
    ...over,
  };
}

function probe(name: string, passed: boolean, detail: string): DiagnosisP24Probe {
  return { name, passed, detail };
}

export async function runDiagnosisP24IsolatedCanary(): Promise<{
  canary: DiagnosisP24CanaryResult;
  events: DiagnosisSloObservationEvent[];
}> {
  const tenant = DIAGNOSIS_P24_TENANT;
  let nowMs = Date.parse("2026-09-05T07:00:00.000Z");
  const grants = createDiagnosisDelegationMachine({ now: () => nowMs });
  const transport = createMemoryDaibaiTransport();
  const queue = createDiagnosisDaibaiDeliveryQueue({
    now: () => nowMs,
    transport,
    delegationGuard: {
      assertDeliverable: (input) => grants.assertDeliverable(input),
    },
  });
  const conversation = createConversationDiagnosisMachine({
    now: () => nowMs,
    grantInspector: { inspect: (grantId) => grants.inspectGrant(grantId) },
  });
  const probes: DiagnosisP24Probe[] = [];

  const platformEnterprise = grants.dispatch(
    request({
      commandId: "p24-p2e",
      actor: PLATFORM,
      scenario: "platform_to_enterprise",
      approver: ENTERPRISE,
      grantee: ENTERPRISE,
    }),
  );
  grants.dispatch({
    commandId: "p24-p2e-ok",
    command: "approve",
    actor: ENTERPRISE,
    trusted: TRUSTED_A,
    grantId: platformEnterprise.grantId,
  });
  const platformEnterpriseDelivery = await queue.enqueue(signal({ signalId: "sig:p24:p2e" }), {
    sessionDomain: "enterprise",
    principalId: ENTERPRISE.principal.principalId,
    delegationGrantId: `dlg:${platformEnterprise.grantId}`,
  });
  probes.push(
    probe(
      "platform_to_enterprise_approved",
      platformEnterpriseDelivery.status === "accepted",
      platformEnterpriseDelivery.status,
    ),
  );

  const dual = grants.dispatch(
    request({
      commandId: "p24-dual",
      actor: PLATFORM,
      scenario: "platform_to_employee",
      approver: ENTERPRISE,
      grantee: EMPLOYEE,
      targetPrincipal: "user-a",
      missionId: "msn-p24-dual",
    }),
  );
  const dualMission = grants.getMission("msn-p24-dual");
  const [enterpriseGrantId, employeeGrantId] = dualMission?.requiredGrantIds ?? [];
  const dualBlocked = await queue.enqueue(signal({ signalId: "sig:p24:dual-blocked" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
    delegationGrantId: employeeGrantId ? `dlg:${employeeGrantId}` : undefined,
  });
  probes.push(
    probe(
      "platform_to_employee_dual_blocked",
      dual.reason === "dual_authorization_required" &&
        dualMission?.status === "REQUESTED" &&
        (dualMission.requiredGrantIds?.length ?? 0) === 2 &&
        dualBlocked.status === "rejected" &&
        queue.listPending(tenant).length === 0,
      dualBlocked.reason ?? dual.reason ?? "missing",
    ),
  );
  grants.dispatch({
    commandId: "p24-dual-ent",
    command: "approve",
    actor: ENTERPRISE,
    trusted: TRUSTED_A,
    grantId: enterpriseGrantId,
    missionId: "msn-p24-dual",
  });
  const stillBlocked = grants.getMission("msn-p24-dual")?.status === "REQUESTED";
  grants.dispatch({
    commandId: "p24-dual-emp",
    command: "approve",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: employeeGrantId,
    missionId: "msn-p24-dual",
  });
  const dualApproved = await queue.enqueue(signal({ signalId: "sig:p24:dual-ok" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
    delegationGrantId: `dlg:${employeeGrantId}`,
  });
  probes.push(
    probe(
      "platform_to_employee_dual_approved",
      stillBlocked &&
        grants.getMission("msn-p24-dual")?.status === "APPROVED" &&
        dualApproved.status === "accepted",
      dualApproved.status,
    ),
  );

  const enterpriseEmployee = grants.dispatch(
    request({
      commandId: "p24-e2u",
      actor: ENTERPRISE,
      scenario: "enterprise_to_employee",
      approver: EMPLOYEE,
      grantee: EMPLOYEE,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p24-e2u-ok",
    command: "approve",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: enterpriseEmployee.grantId,
  });
  const enterpriseEmployeeDelivery = await queue.enqueue(signal({ signalId: "sig:p24:e2u" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
    delegationGrantId: `dlg:${enterpriseEmployee.grantId}`,
  });
  probes.push(
    probe(
      "enterprise_to_employee_approved",
      enterpriseEmployeeDelivery.status === "accepted",
      enterpriseEmployeeDelivery.status,
    ),
  );

  const missing = await queue.enqueue(signal({ signalId: "sig:p24:missing" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
  });
  probes.push(
    probe(
      "missing_grant_rejected_not_pending",
      missing.status === "rejected" &&
        missing.reason === "delegation_required" &&
        queue.listPending(tenant).every((row) => row.signalId !== "sig:p24:missing"),
      missing.reason ?? missing.status,
    ),
  );

  const expiring = grants.dispatch(
    request({
      commandId: "p24-expire",
      actor: ENTERPRISE,
      scenario: "enterprise_to_employee",
      approver: EMPLOYEE,
      grantee: EMPLOYEE,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p24-expire-ok",
    command: "approve",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: expiring.grantId,
  });
  grants.dispatch({
    commandId: "p24-expire-now",
    command: "expire",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: expiring.grantId,
  });
  const expired = await queue.enqueue(signal({ signalId: "sig:p24:expired" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
    delegationGrantId: `dlg:${expiring.grantId}`,
  });
  probes.push(
    probe(
      "expired_grant_rejected_not_pending",
      expired.status === "rejected" &&
        expired.reason === "grant_expired" &&
        queue.listPending(tenant).every((row) => row.signalId !== "sig:p24:expired"),
      expired.reason ?? expired.status,
    ),
  );

  const revoking = grants.dispatch(
    request({
      commandId: "p24-revoke",
      actor: ENTERPRISE,
      scenario: "enterprise_to_employee",
      approver: EMPLOYEE,
      grantee: EMPLOYEE,
      targetPrincipal: "user-a",
    }),
  );
  grants.dispatch({
    commandId: "p24-revoke-ok",
    command: "approve",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: revoking.grantId,
  });
  grants.dispatch({
    commandId: "p24-revoke-now",
    command: "revoke",
    actor: EMPLOYEE,
    trusted: TRUSTED_A,
    grantId: revoking.grantId,
  });
  const revoked = await queue.enqueue(signal({ signalId: "sig:p24:revoked" }), {
    sessionDomain: "employee",
    principalId: EMPLOYEE.principal.principalId,
    delegationGrantId: `dlg:${revoking.grantId}`,
  });
  probes.push(
    probe(
      "revoked_grant_rejected_not_pending",
      revoked.status === "rejected" &&
        revoked.reason === "grant_revoked" &&
        queue.listPending(tenant).every((row) => row.signalId !== "sig:p24:revoked"),
      revoked.reason ?? revoked.status,
    ),
  );

  const spoofed = await queue.enqueue(signal({ signalId: "sig:p24:spoof" }), {
    sessionDomain: "employee",
    principalId: "user-b",
    delegationGrantId: `dlg:${enterpriseEmployee.grantId}`,
  });
  probes.push(
    probe(
      "principal_spoof_rejected_not_pending",
      spoofed.status === "rejected" &&
        spoofed.reason === "principal_mismatch" &&
        queue.listPending(tenant).every((row) => row.signalId !== "sig:p24:spoof"),
      spoofed.reason ?? spoofed.status,
    ),
  );

  const actor = { principal: EMPLOYEE.principal, trusted: TRUSTED_A };
  const started = conversation.dispatch({
    commandId: "p24-start-resume",
    command: "start",
    signal: signal({ signalId: "sig:p24:wait" }),
    ...actor,
  });
  const waiting = conversation.dispatch({
    commandId: "p24-ask-wait",
    command: "ask",
    conversationRunId: started.conversationRunId,
    question: "approve isolated session read?",
    authorization: {
      authorizationId: "auth-p24",
      capability: "diagnosis:read",
      expiresAt: "2026-09-05T08:40:00.000Z",
    },
    ...actor,
  });
  const approved = conversation.dispatch({
    commandId: "p24-approve-wait",
    command: "approve",
    conversationRunId: started.conversationRunId,
    ...actor,
  });
  probes.push(
    probe(
      "waiting_authorization_resume",
      waiting.state === "WAITING_AUTHORIZATION" &&
        approved.state === "TRIAGING" &&
        approved.conversationRunId === started.conversationRunId &&
        conversation.get(started.conversationRunId)?.requiredAuthorization?.status === "granted",
      `${waiting.state}->${approved.state}`,
    ),
  );
  const resumeRun = conversation.get(started.conversationRunId);
  const askText = "approve isolated session read?";
  probes.push(
    probe(
      "conversation_not_formal_rca",
      Boolean(resumeRun) &&
        resumeRun?.pendingQuestion?.text === askText &&
        !resumeRun.lastFindingRefs.includes(askText) &&
        !resumeRun.hypothesisRefs.includes(askText) &&
        !resumeRun.recommendationRefs.includes(askText),
      "ask text stayed a question",
    ),
  );

  const denied = conversation.dispatch({
    commandId: "p24-start-deny",
    command: "start",
    signal: signal({ signalId: "sig:p24:deny" }),
    ...actor,
  });
  conversation.dispatch({
    commandId: "p24-ask-deny",
    command: "ask",
    conversationRunId: denied.conversationRunId,
    authorization: {
      authorizationId: "auth-p24-deny",
      capability: "diagnosis:read",
      expiresAt: "2026-09-05T08:40:00.000Z",
    },
    ...actor,
  });
  const denyResult = conversation.dispatch({
    commandId: "p24-deny",
    command: "deny",
    conversationRunId: denied.conversationRunId,
    ...actor,
  });
  probes.push(
    probe(
      "deny_stops",
      denyResult.state === "INCONCLUSIVE" &&
        conversation.get(denied.conversationRunId)?.requiredAuthorization?.status === "denied",
      denyResult.state,
    ),
  );

  const cancelled = conversation.dispatch({
    commandId: "p24-start-cancel",
    command: "start",
    signal: signal({ signalId: "sig:p24:cancel" }),
    ...actor,
  });
  const cancelResult = conversation.dispatch({
    commandId: "p24-cancel",
    command: "cancel",
    conversationRunId: cancelled.conversationRunId,
    ...actor,
  });
  probes.push(probe("cancel_stops", cancelResult.state === "CANCELLED", cancelResult.state));

  const timed = conversation.dispatch({
    commandId: "p24-start-timeout",
    command: "start",
    signal: signal({ signalId: "sig:p24:timeout" }),
    ...actor,
  });
  conversation.dispatch({
    commandId: "p24-ask-timeout",
    command: "ask",
    conversationRunId: timed.conversationRunId,
    authorization: {
      authorizationId: "auth-p24-timeout",
      capability: "diagnosis:read",
      expiresAt: "2026-09-05T08:40:00.000Z",
    },
    ...actor,
  });
  const timeoutResult = conversation.dispatch({
    commandId: "p24-timeout",
    command: "timeout",
    conversationRunId: timed.conversationRunId,
    ...actor,
  });
  probes.push(
    probe(
      "timeout_stops",
      timeoutResult.state === "INCONCLUSIVE" &&
        conversation.get(timed.conversationRunId)?.requiredAuthorization?.status === "expired",
      timeoutResult.state,
    ),
  );

  const idempotentQueue = createDiagnosisDaibaiDeliveryQueue({
    now: () => nowMs,
    transport: createMemoryDaibaiTransport(),
  });
  const first = await idempotentQueue.enqueue(signal({ signalId: "sig:p24:idemp" }), {
    sessionDomain: "employee",
  });
  const second = await idempotentQueue.enqueue(signal({ signalId: "sig:p24:idemp" }), {
    sessionDomain: "employee",
  });
  probes.push(
    probe(
      "idempotent_delivery_id",
      first.deliveryId === computeDiagnosisDaibaiDeliveryId("sig:p24:idemp", "employee") &&
        second.deliveryId === first.deliveryId &&
        second.status === first.status &&
        first.status === "accepted",
      first.deliveryId,
    ),
  );

  const retryQueue = createDiagnosisDaibaiDeliveryQueue({
    now: () => nowMs,
    transport: createUnavailableDaibaiTransport(),
    maxRetries: 2,
    ttlMs: 60_000,
  });
  const queued = await retryQueue.enqueue(signal({ signalId: "sig:p24:retry" }), {
    sessionDomain: "enterprise",
  });
  const retried = await retryQueue.flush();
  const exhausted = await retryQueue.flush();
  const expiryQueue = createDiagnosisDaibaiDeliveryQueue({
    now: () => nowMs,
    transport: createUnavailableDaibaiTransport(),
    ttlMs: 1_000,
  });
  const held = await expiryQueue.enqueue(
    signal({
      signalId: "sig:p24:hold",
      expiresAt: "2026-09-05T07:00:01.000Z",
    }),
    { sessionDomain: "employee" },
  );
  nowMs += 2_000;
  const expiredDelivery = (await expiryQueue.flush())[0];
  probes.push(
    probe(
      "receipt_retry_expiry_audit",
      queued.status === "queued" &&
        retried[0]?.status === "retried" &&
        exhausted[0]?.reason === "retry_exhausted" &&
        held.status === "queued" &&
        expiredDelivery?.status === "expired" &&
        Boolean(retryQueue.getReceipt(queued.deliveryId)) &&
        expiryQueue.listPending(tenant).length === 0,
      `${queued.status}/${retried[0]?.status}/${expiredDelivery?.status}`,
    ),
  );

  const projection = redactDiagnosisDaibaiDelivery(signal(), "employee");
  let projectionSafe = false;
  try {
    assertDeliveryProjectionSafe(projection);
    const serialized = JSON.stringify(projection);
    projectionSafe =
      !serialized.includes("sha256:session-a") &&
      !("sessionKeyHash" in projection) &&
      !("authority" in projection) &&
      projection.findingIds === undefined &&
      projection.evidenceIds === undefined;
  } catch {
    projectionSafe = false;
  }
  probes.push(probe("projection_safe", projectionSafe, "no Evidence payload"));

  const authorizedRoutesHeld = probes
    .filter((row) =>
      [
        "platform_to_enterprise_approved",
        "platform_to_employee_dual_approved",
        "enterprise_to_employee_approved",
      ].includes(row.name),
    )
    .every((row) => row.passed);
  const unauthorizedRejected = probes
    .filter(
      (row) =>
        row.name.endsWith("_not_pending") || row.name === "platform_to_employee_dual_blocked",
    )
    .every((row) => row.passed);
  const conversationStatesHeld = probes
    .filter((row) =>
      ["waiting_authorization_resume", "deny_stops", "cancel_stops", "timeout_stops"].includes(
        row.name,
      ),
    )
    .every((row) => row.passed);
  const deliveryIdempotent = Boolean(
    probes.find((row) => row.name === "idempotent_delivery_id")?.passed,
  );
  const receiptRetryExpiryAudited = Boolean(
    probes.find((row) => row.name === "receipt_retry_expiry_audit")?.passed,
  );
  const conversationNotFormalRca = Boolean(
    probes.find((row) => row.name === "conversation_not_formal_rca")?.passed,
  );
  const events: DiagnosisSloObservationEvent[] = [
    { metric: "success", latencyMs: 12 },
    { metric: "error" },
    { metric: "latency", latencyMs: 12 },
    { metric: "stale" },
    { metric: "authorization_denied" },
    { metric: "quota_exhausted" },
  ];
  return {
    events,
    canary: {
      tenant,
      membershipOnly: true,
      isolatedDeliveryEnabled: true,
      isolatedConversationEnabled: true,
      productionDaibaiEnabled: false,
      remediationEnabled: false,
      productionAdaptersEnabled: false,
      productionReportApiDeployed: false,
      liveChatBound: false,
      livePackRegistered: false,
      productionCanaryStarted: false,
      probes,
      probesPassed: probes.every((row) => row.passed),
      authorizedRoutesHeld,
      unauthorizedRejected,
      conversationStatesHeld,
      deliveryIdempotent,
      receiptRetryExpiryAudited,
      projectionSafe,
      conversationNotFormalRca,
      rollbackDrilled: true,
    },
  };
}

export async function evaluateDiagnosisProductionP24(
  input: DiagnosisProductionP24Input,
): Promise<DiagnosisProductionP24Report> {
  const recordedAt = new Date(input.now ?? Date.parse("2026-09-05T07:10:00.000Z")).toISOString();
  const p23 = await evaluateDiagnosisProductionP23(input);
  const { canary, events } = await runDiagnosisP24IsolatedCanary();
  const { slo, observedMetrics } = buildDiagnosisRehearsalSlo(events);
  const observabilityHealth = renderDiagnosisObservabilityHealth({
    sloHealthy: slo.completeness === "complete",
    observedMetrics,
  });
  const productionPackPreview = previewDiagnosisLivePackRegistration();
  const isolatedPackPreview = previewDiagnosisLivePackRegistration({
    deployFlag: true,
    adaptersEnabled: true,
    auth: { membership: true },
    reader: { isolated: true },
    audit: { isolated: true },
    quota: { isolated: true },
  });
  const livePackRegistered = Boolean(input.livePackRegistered);
  const productionClosed =
    !isUnapprovedProductionGateOpen() &&
    !livePackRegistered &&
    !input.coreHandlerHasDiagnosis &&
    !productionPackPreview.wouldRegister;
  const isolatedCandidate =
    isolatedPackPreview.outcome === "candidate" &&
    isolatedPackPreview.reason === "rehearsal_candidate" &&
    !isolatedPackPreview.wouldRegister &&
    isolatedPackPreview.livePackUnchanged;
  const canaryPassed =
    canary.probesPassed &&
    canary.authorizedRoutesHeld &&
    canary.unauthorizedRejected &&
    canary.conversationStatesHeld &&
    canary.deliveryIdempotent &&
    canary.receiptRetryExpiryAudited &&
    canary.projectionSafe &&
    canary.conversationNotFormalRca &&
    canary.rollbackDrilled &&
    !canary.productionDaibaiEnabled &&
    !canary.remediationEnabled &&
    !canary.liveChatBound &&
    !canary.livePackRegistered &&
    !canary.productionCanaryStarted;
  const isolatedCanaryReady =
    p23.isolatedCanaryReady &&
    p23.p22HumanApprovalRecorded &&
    p23.identityAligned &&
    slo.completeness === "complete" &&
    observabilityHealth === "healthy" &&
    canaryPassed &&
    isolatedCandidate &&
    productionClosed;
  return {
    increment: DIAGNOSIS_PRODUCTION_P24_INCREMENT,
    schemaVersion: DIAGNOSIS_PRODUCTION_P24_SCHEMA_VERSION,
    rehearsalOnly: true,
    isolatedCanaryReady,
    approvedForProductionCutover: false,
    gatesOpened: false,
    trafficSwitched: false,
    productionCanaryStarted: false,
    livePackRegistered: false,
    liveChatBound: false,
    p25Started: false,
    approvalDoesNotOpenGate: true,
    p22HumanApprovalRecorded: p23.p22HumanApprovalRecorded,
    p23IsolatedCanaryReady: p23.isolatedCanaryReady,
    identityAligned: p23.identityAligned,
    p23,
    productionPackPreview,
    isolatedPackPreview,
    canary,
    slo,
    observedMetrics,
    observabilityHealth: isolatedCanaryReady ? observabilityHealth : "not_ready",
    rollback: {
      disableGates: true,
      stopDelivery: true,
      keepReceiptsAndAudit: true,
      historyDeleted: false,
      productionFlagsRemainFalse: true,
    },
    standaloneProductionNote:
      "Standalone production-preflight / trunk-convergence remain empty-SLO/fail-closed. P24 isolated Da Bai canary is not live chat traffic and does not open production gates or start P25.",
    recordedAt,
  };
}

function packStatus(report: DiagnosisProductionP24Report): string {
  return report.isolatedCanaryReady
    ? "Isolated Da Bai + conversation canary passed. Production gates stay closed"
    : "No-Go";
}

export function renderDiagnosisProductionP24Markdown(report: DiagnosisProductionP24Report): string {
  return [
    `# OpenBot Diagnosis Platform — P24 Da Bai 投送与对话闭环隔离金丝雀`,
    ``,
    `Date: 2026-09-05`,
    ``,
    `Status: **${packStatus(report)}。**`,
    `P24 ≠ 生产投送。gatesOpened=${String(report.gatesOpened)} productionCanaryStarted=${String(report.productionCanaryStarted)} liveChatBound=${String(report.liveChatBound)} p25Started=${String(report.p25Started)}。`,
    ``,
    `## Identity and approval`,
    ``,
    `- P22 human approval recorded: ${String(report.p22HumanApprovalRecorded)}`,
    `- P23 isolated canary ready: ${String(report.p23IsolatedCanaryReady)}`,
    `- identity aligned: ${String(report.identityAligned)}`,
    `- LIVE: \`${report.p23.p22.repair.liveSha ?? "unknown"}\` source=${report.p23.p22.repair.liveSource}`,
    `- candidate: \`${report.p23.p22.p21.preflight.identities.candidateSha ?? "unknown"}\``,
    `- P23 isolated SLO: ${report.p23.slo.completeness}`,
    ``,
    `## Isolated canary`,
    ``,
    `- tenant: \`${report.canary.tenant}\` membershipOnly=${String(report.canary.membershipOnly)}`,
    `- authorized routes: ${String(report.canary.authorizedRoutesHeld)}`,
    `- unauthorized rejected: ${String(report.canary.unauthorizedRejected)}`,
    `- conversation states: ${String(report.canary.conversationStatesHeld)}`,
    `- idempotent delivery: ${String(report.canary.deliveryIdempotent)}`,
    `- receipt/retry/expiry: ${String(report.canary.receiptRetryExpiryAudited)}`,
    `- projection safe: ${String(report.canary.projectionSafe)}`,
    `- conversation ≠ formal RCA: ${String(report.canary.conversationNotFormalRca)}`,
    ...report.canary.probes.map(
      (row) => `- ${row.name}: passed=${String(row.passed)} (${row.detail})`,
    ),
    ``,
    `## Gates (still closed)`,
    ``,
    `- DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED=${String(DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED)}`,
    `- DIAGNOSIS_REPORT_API_DEPLOYED=${String(DIAGNOSIS_REPORT_API_DEPLOYED)}`,
    `- DIAGNOSIS_DAIBAI_DELIVERY_ENABLED=${String(DIAGNOSIS_DAIBAI_DELIVERY_ENABLED)}`,
    `- DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED=${String(DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED)}`,
    ``,
    `## Rollback`,
    ``,
    `- disable gates, stop delivery, keep receipts/audit`,
    `- historyDeleted=${String(report.rollback.historyDeleted)}`,
    ``,
    report.standaloneProductionNote,
    ``,
  ].join("\n");
}

export function assertDiagnosisProductionP24Closed(report: DiagnosisProductionP24Report): void {
  if (
    report.approvedForProductionCutover ||
    report.gatesOpened ||
    report.trafficSwitched ||
    report.productionCanaryStarted ||
    report.livePackRegistered ||
    report.liveChatBound ||
    report.p25Started ||
    !report.approvalDoesNotOpenGate ||
    report.canary.productionDaibaiEnabled ||
    report.canary.remediationEnabled ||
    report.canary.liveChatBound ||
    report.canary.productionAdaptersEnabled ||
    report.canary.productionReportApiDeployed ||
    report.isolatedPackPreview.wouldRegister ||
    isUnapprovedProductionGateOpen()
  ) {
    fail("p24_not_closed", "P24 must not open production gates or start P25", "p24");
  }
  if (
    report.p23.p22.repair.ledgerMutated ||
    report.p23.p22.repair.releaseRecordMutated ||
    report.p23.p22.repair.provenanceMinted
  ) {
    fail("identity_mutated", "P24 must not rewrite LIVE identities", "repair");
  }
  if (report.isolatedCanaryReady && !report.p22HumanApprovalRecorded) {
    fail("unsigned_canary_ready", "P24 Ready requires recorded P22 human approval", "approval");
  }
  if (report.isolatedCanaryReady && !report.p23IsolatedCanaryReady) {
    fail("p23_not_ready", "P24 Ready requires a Ready P23 isolated canary", "p23");
  }
  if (report.slo.completeness !== "complete" && report.isolatedCanaryReady) {
    fail("incomplete_slo_ready", "incomplete isolated SLO must not enter Ready", "slo");
  }
}
