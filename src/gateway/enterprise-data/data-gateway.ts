import { randomUUID } from "node:crypto";
import { checkApproval, consumeApprovalRequest } from "./approval-workflow.js";
import {
  countRecords,
  findInvocationAuditForTrace,
  recordDataAudit,
  recordInvocationAudit,
  removeDataAuditForTrace,
  resolveAuditWritePolicy,
  type AuditWriteOptions,
} from "./audit-runtime.js";
import { EnterpriseDataStoreError, findConnectorAction } from "./connector-action-store.js";
import { loadCredentialSecret } from "./connector-credential-vault.js";
import { executeConnectorHandlerAsync } from "./connector-handler-runtime.js";
import { recordGovernedReadSuccess } from "./data-asset-linkage.js";
import {
  assertTrustedExecutionContext,
  MATERIALIZER_TRUST_ATTESTATION,
} from "./enterprise-data-seat-context.js";
import { applyClassificationMasking } from "./masking-engine.js";
import { resolvePolicyBackedSeatActionGrant } from "./policy-backed-grant-resolver.js";
import { resolveRuntimeHandler } from "./runtime-registry.js";
import { recordSarTraceCorrelation } from "./sar-audit-correlation.js";
import { resolveSarFailureDisplay } from "./sar-failure-display.js";
import {
  executeGovernedSarBridge,
  type GovernedSarBridgeDecision,
  type SarGovernanceProvider,
} from "./sar-governance-bridge.js";
import { evaluateScopePolicy, findScopePolicy } from "./scope-policy-store.js";
import { findSeatActionGrant } from "./seat-action-grant-store.js";
import { resolveConnectorAccessMethod, selectSourceCredential } from "./source-account.js";
import type {
  ConnectorActionRef,
  ConnectorActionRiskLevel,
  DataGatewayResponse,
  EnterpriseDataInvokeContext,
  EnterpriseDataStore,
  InvocationDenialReason,
  SarGatewayCorrelation,
} from "./types.js";

export type EnterpriseDataInvokeParams = {
  store: EnterpriseDataStore;
  context: EnterpriseDataInvokeContext;
  ref: ConnectorActionRef;
  input?: Record<string, unknown>;
  approvalContextId?: string;
  /** Selects one DataSource when several share a connectorId. */
  sourceId?: string;
  /**
   * In-process controlled SAR provider. Clients cannot supply this.
   * Absent on the website path means fail closed, not mock.
   */
  sarProvider?: SarGovernanceProvider;
  nowIso: string;
  auditOptions?: AuditWriteOptions;
};

function deny(params: {
  store: EnterpriseDataStore;
  traceId: string;
  context: EnterpriseDataInvokeContext;
  ref: ConnectorActionRef;
  code: InvocationDenialReason;
  message: string;
  details?: Record<string, unknown>;
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  scopeType?: string;
  approvalContextId?: string;
  nowIso: string;
  auditOptions?: AuditWriteOptions;
}): DataGatewayResponse {
  recordInvocationAudit({
    store: params.store,
    traceId: params.traceId,
    tenantId: params.context.tenantId,
    seatId: params.context.seatId,
    employeeId: params.context.employeeId,
    agentId: params.context.agentId,
    connectorId: params.ref.connectorId,
    actionKey: params.ref.actionKey,
    version: params.ref.version,
    riskLevel: params.riskLevel ?? "LOW",
    scopeType: params.scopeType ?? "UNKNOWN",
    approvalContextId: params.approvalContextId,
    status: "DENIED",
    denialReason: params.code,
    errorMessage: params.message,
    nowIso: params.nowIso,
    options: params.auditOptions,
  });
  return {
    ok: false,
    traceId: params.traceId,
    code: params.code,
    message: params.message,
    details: withFailureDisplay(params.details, { denialReason: params.code }),
  };
}

function withFailureDisplay(
  details: Record<string, unknown> | undefined,
  input: Parameters<typeof resolveSarFailureDisplay>[0],
): Record<string, unknown> | undefined {
  const display = resolveSarFailureDisplay(input);
  if (!display) {
    return details;
  }
  return {
    ...details,
    failureDisplay: display,
  };
}

function rememberSarLink(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  traceId: string;
  sar: SarGatewayCorrelation;
  denialReason?: InvocationDenialReason;
  nowIso: string;
  trace?: unknown;
}): void {
  recordSarTraceCorrelation({
    store: params.store,
    tenantId: params.tenantId,
    traceId: params.traceId,
    sar: params.sar,
    denialReason: params.denialReason,
    recordedAt: params.nowIso,
    trace: params.trace,
  });
}

function sarAuditFields(sar: SarGatewayCorrelation) {
  return {
    sarRunId: sar.runId,
    sarEvidenceRef: sar.evidenceRef,
    sarStatus: sar.status,
    sarVerification: sar.verification,
    sarCompleteness: sar.completeness,
    artifactDigest: sar.artifactDigest,
  };
}

/**
 * Partial rows stay off employee and agent denials.
 * The materializer may see a masked copy and still must pass the publication gate.
 */
function preservedPartialForMaterializer(params: {
  context: EnterpriseDataInvokeContext;
  decision: Extract<GovernedSarBridgeDecision, { kind: "preserved" }>;
  store: EnterpriseDataInvokeParams["store"];
  ref: ConnectorActionRef;
  scopeApplied: string;
}): { data: unknown; maskedFields: string[]; scopeApplied: string } | undefined {
  if (params.context.trustAttestation !== MATERIALIZER_TRUST_ATTESTATION) {
    return undefined;
  }
  if (params.decision.data === undefined) {
    return undefined;
  }
  const sar = params.decision.sar;
  if (
    sar.status !== "succeeded" ||
    sar.verification !== "passed" ||
    sar.completeness !== "partial"
  ) {
    return undefined;
  }
  const masking = applyClassificationMasking({
    store: params.store,
    tenantId: params.context.tenantId,
    ref: params.ref,
    payload: params.decision.data,
  });
  return {
    data: masking.data,
    maskedFields: masking.maskedFields,
    scopeApplied: params.scopeApplied,
  };
}

function failAuditClosed(params: {
  store: EnterpriseDataStore;
  traceId: string;
  context: EnterpriseDataInvokeContext;
  ref: ConnectorActionRef;
  riskLevel: ConnectorActionRiskLevel;
  scopeType: string;
  scopeAppliedLabel?: string;
  approvalContextId?: string;
  approvalId?: string;
  durationMs: number;
  nowIso: string;
  auditOptions?: AuditWriteOptions;
}): DataGatewayResponse {
  const existing = findInvocationAuditForTrace({
    store: params.store,
    tenantId: params.context.tenantId,
    traceId: params.traceId,
  });
  if (existing?.status === "SUCCESS") {
    delete params.store.invocationAuditEvents[existing.invocationAuditId];
  }
  recordInvocationAudit({
    store: params.store,
    traceId: params.traceId,
    tenantId: params.context.tenantId,
    seatId: params.context.seatId,
    employeeId: params.context.employeeId,
    agentId: params.context.agentId,
    connectorId: params.ref.connectorId,
    actionKey: params.ref.actionKey,
    version: params.ref.version,
    riskLevel: params.riskLevel,
    scopeType: params.scopeType,
    scopeAppliedLabel: params.scopeAppliedLabel,
    approvalContextId: params.approvalContextId,
    approvalId: params.approvalId,
    status: "FAILED",
    denialReason: "AUDIT_WRITE_FAILED",
    errorMessage: "Audit write failed for high-risk action.",
    durationMs: params.durationMs,
    nowIso: params.nowIso,
  });
  return {
    ok: false,
    traceId: params.traceId,
    code: "AUDIT_WRITE_FAILED",
    message: "Audit write failed for high-risk action.",
  };
}

export async function invokeEnterpriseDataAction(
  params: EnterpriseDataInvokeParams,
): Promise<DataGatewayResponse> {
  const traceId = randomUUID();
  const startedAt = Date.parse(params.nowIso);
  const { context, ref } = params;

  try {
    assertTrustedExecutionContext(context);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Untrusted execution context.";
    const code: InvocationDenialReason =
      error instanceof EnterpriseDataStoreError && error.code === "UNTRUSTED_EXECUTION_CONTEXT"
        ? "UNTRUSTED_EXECUTION_CONTEXT"
        : "NO_SEAT_CONTEXT";
    return deny({
      ...params,
      traceId,
      code,
      message,
    });
  }

  if (!context.seatId || !context.employeeId) {
    return deny({
      ...params,
      traceId,
      code: "NO_SEAT_CONTEXT",
      message: "Seat context is required.",
    });
  }

  const action = findConnectorAction(params.store, context.tenantId, ref);
  if (!action) {
    return deny({
      ...params,
      traceId,
      code: "ACTION_NOT_REGISTERED",
      message: `Action ${ref.actionKey}@${ref.version} not found.`,
    });
  }
  if (action.lifecycle === "frozen") {
    return deny({
      ...params,
      traceId,
      code: "ACTION_FROZEN",
      message: `Action ${ref.actionKey}@${ref.version} is frozen.`,
      riskLevel: action.riskLevel,
    });
  }

  const grant =
    findSeatActionGrant(params.store, context.tenantId, context.seatId, ref) ??
    resolvePolicyBackedSeatActionGrant({
      store: params.store,
      tenantId: context.tenantId,
      seatId: context.seatId,
      ref,
      departmentId: context.departmentId,
      roleCode: context.roleCode,
    });
  if (!grant) {
    return deny({
      ...params,
      traceId,
      code: "NO_ACTION_GRANT",
      message: "No seat action grant for this action.",
      riskLevel: action.riskLevel,
    });
  }

  let registryEntry;
  try {
    registryEntry = resolveRuntimeHandler(params.store, context.tenantId, ref);
  } catch {
    return deny({
      ...params,
      traceId,
      code: "ACTION_NOT_REGISTERED",
      message: `No runtime handler registered for ${ref.actionKey}@${ref.version}.`,
      riskLevel: action.riskLevel,
    });
  }

  const scopePolicyId = grant.scopePolicyId ?? "scope-self-default";
  const scopePolicy = findScopePolicy(params.store, context.tenantId, scopePolicyId);
  if (!scopePolicy) {
    return deny({
      ...params,
      traceId,
      code: "SCOPE_DENIED",
      message: `Scope policy ${scopePolicyId} not found.`,
      riskLevel: action.riskLevel,
    });
  }

  let scopeResult;
  try {
    scopeResult = evaluateScopePolicy({
      policy: scopePolicy,
      context: {
        tenantId: context.tenantId,
        seatId: context.seatId,
        employeeId: context.employeeId,
        userId: context.userId,
        teamLabel: context.teamLabel,
        roleCode: context.roleCode,
        departmentId: context.departmentId,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Scope evaluation failed.";
    const code: InvocationDenialReason =
      error instanceof EnterpriseDataStoreError && error.code === "SCOPE_CONTEXT_MISSING"
        ? "SCOPE_CONTEXT_MISSING"
        : "SCOPE_DENIED";
    return deny({
      ...params,
      traceId,
      code,
      message,
      riskLevel: action.riskLevel,
      scopeType: scopePolicy.scopeType,
      nowIso: params.nowIso,
    });
  }

  const approvalCheck = checkApproval({
    store: params.store,
    tenantId: context.tenantId,
    grant,
    action,
    ref,
    approvalContextId: params.approvalContextId,
    nowIso: params.nowIso,
  });
  if (!approvalCheck.ok) {
    return deny({
      ...params,
      traceId,
      code: approvalCheck.code,
      message: approvalCheck.message,
      details: approvalCheck.details,
      riskLevel: action.riskLevel,
      scopeType: scopeResult.scopeType,
      approvalContextId:
        typeof approvalCheck.details.approvalContextId === "string"
          ? approvalCheck.details.approvalContextId
          : params.approvalContextId,
      nowIso: params.nowIso,
    });
  }

  let handlerResult: { payload: unknown } | undefined;
  let sarCorrelation: SarGatewayCorrelation | undefined;
  const auditBase = () => ({
    store: params.store,
    traceId,
    tenantId: context.tenantId,
    seatId: context.seatId,
    employeeId: context.employeeId,
    agentId: context.agentId,
    connectorId: ref.connectorId,
    actionKey: ref.actionKey,
    version: ref.version,
    riskLevel: action.riskLevel,
    scopeType: scopeResult.scopeType,
    scopeAppliedLabel: scopeResult.scopeAppliedLabel,
    approvalContextId: approvalCheck.approvalContextId,
    approvalId: approvalCheck.approvalId,
    durationMs: Date.parse(params.nowIso) - startedAt,
    nowIso: params.nowIso,
    options: params.auditOptions,
  });
  try {
    if (resolveConnectorAccessMethod(ref.connectorId) === "website_session") {
      const decision = await executeGovernedSarBridge({
        store: params.store,
        context,
        ref,
        sourceId: params.sourceId,
        scope: scopeResult,
        input: params.input,
        provider: params.sarProvider,
        actionReadOnly: action.readOnly,
      });
      if (decision.kind === "deny") {
        return deny({
          ...params,
          traceId,
          code: decision.code,
          message: decision.message,
          details: decision.details,
          riskLevel: action.riskLevel,
          scopeType: scopeResult.scopeType,
          approvalContextId: approvalCheck.approvalContextId,
          nowIso: params.nowIso,
        });
      }
      if (decision.kind === "preserved") {
        recordInvocationAudit({
          ...auditBase(),
          status: "PRESERVED",
          denialReason: "SAR_OUTCOME_PRESERVED",
          errorMessage: decision.message,
          ...sarAuditFields(decision.sar),
        });
        rememberSarLink({
          store: params.store,
          tenantId: context.tenantId,
          traceId,
          sar: decision.sar,
          denialReason: "SAR_OUTCOME_PRESERVED",
          nowIso: params.nowIso,
          trace: decision.data,
        });
        const preservedPartial = preservedPartialForMaterializer({
          context,
          decision,
          store: params.store,
          ref,
          scopeApplied: scopeResult.scopeAppliedLabel,
        });
        return {
          ok: false,
          traceId,
          code: "SAR_OUTCOME_PRESERVED",
          message: decision.message,
          sar: decision.sar,
          details: withFailureDisplay(
            { traceId, runId: decision.sar.runId },
            {
              status: decision.sar.status,
              errorCode: decision.sar.errorCode,
              denialReason: "SAR_OUTCOME_PRESERVED",
            },
          ),
          ...(preservedPartial ? { preservedPartial } : {}),
        };
      }
      if (decision.kind === "ordinary_failure") {
        recordInvocationAudit({
          ...auditBase(),
          status: "FAILED",
          denialReason: "HANDLER_ERROR",
          errorMessage: decision.message,
          ...sarAuditFields(decision.sar),
        });
        rememberSarLink({
          store: params.store,
          tenantId: context.tenantId,
          traceId,
          sar: decision.sar,
          denialReason: "HANDLER_ERROR",
          nowIso: params.nowIso,
        });
        return {
          ok: false,
          traceId,
          code: "HANDLER_ERROR",
          message: decision.message,
          sar: decision.sar,
          details: withFailureDisplay(
            {
              traceId,
              runId: decision.sar.runId,
              sarErrorCode: decision.sar.errorCode,
            },
            {
              status: decision.sar.status,
              errorCode: decision.sar.errorCode,
              denialReason: "HANDLER_ERROR",
            },
          ),
        };
      }
      handlerResult = { payload: decision.data };
      sarCorrelation = decision.sar;
    } else {
      const selection = selectSourceCredential({
        store: params.store,
        tenantId: context.tenantId,
        connectorId: ref.connectorId,
        sourceId: params.sourceId,
      });
      if (selection.kind === "deny") {
        return deny({
          ...params,
          traceId,
          code: selection.code,
          message: selection.message,
          riskLevel: action.riskLevel,
          scopeType: scopeResult.scopeType,
          approvalContextId: approvalCheck.approvalContextId,
          nowIso: params.nowIso,
        });
      }
      const credentialSecret =
        selection.kind === "credential"
          ? await loadCredentialSecret(selection.credential.credentialId)
          : null;
      handlerResult = await executeConnectorHandlerAsync(
        registryEntry.handlerRef,
        {
          input: params.input,
          scope: scopeResult,
          employeeId: context.employeeId,
        },
        {
          connectorId: ref.connectorId,
          credentialSecret,
          accessMethod: "credential",
        },
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Handler execution failed.";
    return deny({
      ...params,
      traceId,
      code: "HANDLER_ERROR",
      message,
      riskLevel: action.riskLevel,
      scopeType: scopeResult.scopeType,
      approvalContextId: approvalCheck.approvalContextId,
      nowIso: params.nowIso,
    });
  }

  if (!handlerResult) {
    return deny({
      ...params,
      traceId,
      code: "HANDLER_ERROR",
      message: "Handler returned no result.",
      riskLevel: action.riskLevel,
      scopeType: scopeResult.scopeType,
      approvalContextId: approvalCheck.approvalContextId,
      nowIso: params.nowIso,
    });
  }

  const masking = applyClassificationMasking({
    store: params.store,
    tenantId: context.tenantId,
    ref,
    payload: handlerResult.payload,
  });

  const auditPolicy = resolveAuditWritePolicy(action.riskLevel);
  const durationMs = Date.parse(params.nowIso) - startedAt;
  const invocationAuditParams = {
    store: params.store,
    traceId,
    tenantId: context.tenantId,
    seatId: context.seatId,
    employeeId: context.employeeId,
    agentId: context.agentId,
    connectorId: ref.connectorId,
    actionKey: ref.actionKey,
    version: ref.version,
    riskLevel: action.riskLevel,
    scopeType: scopeResult.scopeType,
    scopeAppliedLabel: scopeResult.scopeAppliedLabel,
    approvalContextId: approvalCheck.approvalContextId,
    approvalId: approvalCheck.approvalId,
    durationMs,
    nowIso: params.nowIso,
    options: params.auditOptions,
  };
  const failAuditParams = {
    store: params.store,
    traceId,
    context,
    ref,
    riskLevel: action.riskLevel,
    scopeType: scopeResult.scopeType,
    scopeAppliedLabel: scopeResult.scopeAppliedLabel,
    approvalContextId: approvalCheck.approvalContextId,
    approvalId: approvalCheck.approvalId,
    durationMs,
    nowIso: params.nowIso,
    auditOptions: params.auditOptions,
  };

  if (auditPolicy === "fail_closed") {
    const dataOk = recordDataAudit({
      store: params.store,
      traceId,
      tenantId: context.tenantId,
      payload: handlerResult.payload,
      masking,
      riskLevel: action.riskLevel,
      approvalId: approvalCheck.approvalId,
      nowIso: params.nowIso,
      options: params.auditOptions,
    });
    if (!dataOk) {
      return failAuditClosed(failAuditParams);
    }
    const invOk = recordInvocationAudit({
      ...invocationAuditParams,
      status: "SUCCESS",
      ...(sarCorrelation ? sarAuditFields(sarCorrelation) : {}),
    });
    if (!invOk) {
      removeDataAuditForTrace({
        store: params.store,
        tenantId: context.tenantId,
        traceId,
      });
      return failAuditClosed(failAuditParams);
    }
  } else {
    recordDataAudit({
      store: params.store,
      traceId,
      tenantId: context.tenantId,
      payload: handlerResult.payload,
      masking,
      riskLevel: action.riskLevel,
      approvalId: approvalCheck.approvalId,
      nowIso: params.nowIso,
      options: params.auditOptions,
    });
    recordInvocationAudit({
      ...invocationAuditParams,
      status: "SUCCESS",
      ...(sarCorrelation ? sarAuditFields(sarCorrelation) : {}),
    });
  }

  const successInvocation = findInvocationAuditForTrace({
    store: params.store,
    tenantId: context.tenantId,
    traceId,
  });
  if (auditPolicy === "fail_closed" && successInvocation?.status !== "SUCCESS") {
    return failAuditClosed(failAuditParams);
  }

  if (sarCorrelation) {
    rememberSarLink({
      store: params.store,
      tenantId: context.tenantId,
      traceId,
      sar: sarCorrelation,
      nowIso: params.nowIso,
      trace: handlerResult.payload,
    });
  }

  if (approvalCheck.approvalId) {
    consumeApprovalRequest({
      store: params.store,
      tenantId: context.tenantId,
      approvalId: approvalCheck.approvalId,
      traceId,
      nowIso: params.nowIso,
    });
  }

  if (params.sourceId) {
    recordGovernedReadSuccess({
      store: params.store,
      tenantId: context.tenantId,
      sourceId: params.sourceId,
      nowIso: params.nowIso,
    });
  }

  return {
    ok: true,
    traceId,
    source: ref.connectorId,
    actionKey: ref.actionKey,
    version: ref.version,
    generatedAt: params.nowIso,
    data: masking.data,
    recordCount: countRecords(masking.data),
    scopeApplied: scopeResult.scopeAppliedLabel,
    masked: masking.masked,
    maskedFields: masking.maskedFields,
    blockedFields: masking.blockedFields,
    durationMs,
    approvalId: approvalCheck.approvalId,
    sar: sarCorrelation,
  };
}
