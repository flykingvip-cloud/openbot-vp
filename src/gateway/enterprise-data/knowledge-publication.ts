/**
 * E4 knowledge publication gate.
 *
 * on_demand and scheduled are the only implemented materialization paths.
 * event_driven remains in the enum for legacy rows only: new writes are rejected
 * as MATERIALIZATION_MODE_UNSUPPORTED. There is no event register/consume executor
 * wired to projection materialization (idempotency/replay/restart not delivered).
 * Failed, unverified, and incomplete output is not a complete knowledge object.
 * Partial output is stored only when the projection names publish_marked.
 */

import { EnterpriseDataStoreError } from "./connector-action-store.js";
import { findDataCapability } from "./data-capability-store.js";
import { findDataSource } from "./data-source-store.js";
import { MATERIALIZER_SEAT_ID } from "./enterprise-data-seat-context.js";
import { findSarExecutionBridge } from "./sar-governance-bridge.js";
import { findSeatActionGrant } from "./seat-action-grant-store.js";
import { resolveConnectorAccessMethod } from "./source-account.js";
import type {
  DataGatewayResponse,
  EnterpriseDataStore,
  EnterpriseKnowledgeProjectionMaterializationMode,
  EnterpriseKnowledgeProjectionSpec,
  KnowledgeLineageRecord,
  KnowledgeObjectPublication,
  ProjectionSourceActionRef,
  SarGatewayCorrelation,
} from "./types.js";

export const IMPLEMENTED_MATERIALIZATION_MODES = ["on_demand", "scheduled"] as const;

export type ImplementedMaterializationMode = (typeof IMPLEMENTED_MATERIALIZATION_MODES)[number];

export function isImplementedMaterializationMode(
  mode: EnterpriseKnowledgeProjectionMaterializationMode,
): boolean {
  return mode === "on_demand" || mode === "scheduled";
}

/** Scheduled refresh only. event_driven has no scheduler. on_demand is a load path, not a clock. */
export function materializationModeHasScheduler(
  mode: EnterpriseKnowledgeProjectionMaterializationMode,
): boolean {
  return mode === "scheduled";
}

/**
 * Operable migration copy for false-available event_driven configs.
 * Event materialization itself is not delivered in this batch.
 */
export function eventDrivenMaterializationUnsupportedMessage(params?: {
  targetMode?: ImplementedMaterializationMode;
}): string {
  const target = params?.targetMode ?? "scheduled";
  const alternate = target === "scheduled" ? "on_demand" : "scheduled";
  return (
    `materializationMode "event_driven" is unsupported (no event register/consume executor). ` +
    `Migrate existing bindings via enterprise-data.projection-bindings.upsert with bindingId ` +
    `and materializationMode "${target}" or "${alternate}". ` +
    `False availability removed; event capability not delivered.`
  );
}

/** Reject creating or keeping event_driven as a writable materialization mode. */
export function assertWritableMaterializationMode(
  mode: EnterpriseKnowledgeProjectionMaterializationMode,
): void {
  if (isImplementedMaterializationMode(mode)) {
    return;
  }
  throw new EnterpriseDataStoreError(
    "MATERIALIZATION_MODE_UNSUPPORTED",
    eventDrivenMaterializationUnsupportedMessage(),
  );
}

/** Status helper: implemented | unsupported (legacy enum value, not an executor). */
export function materializationModeSupportStatus(
  mode: EnterpriseKnowledgeProjectionMaterializationMode,
): "implemented" | "unsupported" {
  return isImplementedMaterializationMode(mode) ? "implemented" : "unsupported";
}

export type KnowledgePublicationDecision =
  | {
      kind: "complete";
      publication: "complete";
      data: unknown;
      maskedFields: string[];
      scopeApplied: string;
      traceId: string;
      sar?: SarGatewayCorrelation;
    }
  | {
      kind: "partial";
      publication: "partial";
      data: unknown;
      maskedFields: string[];
      scopeApplied: string;
      traceId: string;
      sar: SarGatewayCorrelation;
    }
  | {
      kind: "withhold";
      code: string;
      message: string;
      traceId?: string;
    };

function sarIsCompleteSuccess(sar: SarGatewayCorrelation): boolean {
  return (
    sar.status === "succeeded" && sar.verification === "passed" && sar.completeness === "complete"
  );
}

function sarIsPublishablePartial(sar: SarGatewayCorrelation): boolean {
  return (
    sar.status === "succeeded" && sar.verification === "passed" && sar.completeness === "partial"
  );
}

/**
 * Decide whether a governed response may become a knowledge object.
 * Gateway ok is not enough when SAR facts say the output is incomplete or unverified.
 */
export function decideKnowledgePublication(params: {
  response: DataGatewayResponse;
  partialPublication?: EnterpriseKnowledgeProjectionSpec["partialPublication"];
}): KnowledgePublicationDecision {
  const response = params.response;
  if (response.ok) {
    if (response.sar && !sarIsCompleteSuccess(response.sar)) {
      return {
        kind: "withhold",
        code: "PROJECTION_PUBLICATION_WITHHELD",
        message: `SAR output is not a complete verified success (status ${response.sar.status}, verification ${response.sar.verification}, completeness ${response.sar.completeness}).`,
        traceId: response.traceId,
      };
    }
    return {
      kind: "complete",
      publication: "complete",
      data: response.data,
      maskedFields: response.maskedFields,
      scopeApplied: response.scopeApplied,
      traceId: response.traceId,
      sar: response.sar,
    };
  }

  const sar = response.sar;
  if (
    response.code === "SAR_OUTCOME_PRESERVED" &&
    sar &&
    sarIsPublishablePartial(sar) &&
    params.partialPublication === "publish_marked" &&
    response.preservedPartial
  ) {
    return {
      kind: "partial",
      publication: "partial",
      data: response.preservedPartial.data,
      maskedFields: response.preservedPartial.maskedFields,
      scopeApplied: response.preservedPartial.scopeApplied,
      traceId: response.traceId,
      sar,
    };
  }

  if (response.code === "SAR_OUTCOME_PRESERVED" || (sar && !sarIsCompleteSuccess(sar))) {
    return {
      kind: "withhold",
      code: "PROJECTION_PUBLICATION_WITHHELD",
      message: response.message,
      traceId: response.traceId,
    };
  }

  return {
    kind: "withhold",
    code: "PROJECTION_GATEWAY_DENIED",
    message: `${response.message} (${response.code}, trace=${response.traceId})`,
    traceId: response.traceId,
  };
}

export function projectionSourceId(spec: EnterpriseKnowledgeProjectionSpec): string | undefined {
  const sourceId = spec.sourceId?.trim();
  return sourceId ? sourceId : undefined;
}

/**
 * Resolve the DataSource the projection named and the continuous execution identity.
 *
 * Bridge owner ≠ continuous execution delegation. Website materialization requires:
 * 1) an explicit sourceId and matching DataSource;
 * 2) a SAR execution bridge that names the AccountBinding owner;
 * 3) that AccountBinding still present and matching (account auth not revoked);
 * 4) an active SeatActionGrant for the materializer seat on the source action
 *    (continuous execution delegation — revocable independently of the bridge).
 *
 * Downstream knowledge visibility is not checked here (execution ⊥ visibility).
 * The caller cannot substitute another userId.
 */
export function resolveProjectionExecutionIdentity(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  spec: EnterpriseKnowledgeProjectionSpec;
  sourceRef: ProjectionSourceActionRef;
}): { sourceId?: string; userId?: string; employeeId?: string } {
  const sourceId = projectionSourceId(params.spec);
  const website = resolveConnectorAccessMethod(params.sourceRef.connectorId) === "website_session";
  if (website && !sourceId) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_REQUIRED",
      "Website projections require an explicit DataSource sourceId.",
    );
  }
  if (!sourceId) {
    return {};
  }
  const source = findDataSource(params.store, params.tenantId, sourceId);
  if (!source || source.connectorId !== params.sourceRef.connectorId) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_SOURCE_MISMATCH",
      `Projection sourceId ${sourceId} is not an instance of ${params.sourceRef.connectorId}.`,
    );
  }
  if (params.spec.capabilityId) {
    const capability = findDataCapability(params.store, params.tenantId, params.spec.capabilityId);
    if (capability && !capability.sourceIds.includes(sourceId)) {
      throw new EnterpriseDataStoreError(
        "PROJECTION_SOURCE_NOT_IN_CAPABILITY",
        `sourceId ${sourceId} is not on the linked DataCapability.`,
      );
    }
  }
  if (!website) {
    return { sourceId };
  }

  const bridge = findSarExecutionBridge(params.store, params.tenantId, sourceId, params.sourceRef);
  const owner = bridge?.userId.trim();
  if (!bridge || !owner) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_EXECUTION_IDENTITY_MISSING",
      "Website projection materialization requires a SAR bridge that names the account owner.",
    );
  }

  const bindingId = bridge.bindingId.trim();
  const accountBinding = bindingId ? params.store.accountBindings?.[bindingId] : undefined;
  if (
    !accountBinding ||
    accountBinding.tenantId !== params.tenantId ||
    accountBinding.userId !== owner ||
    accountBinding.bindingId !== bindingId
  ) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_ACCOUNT_AUTH_REVOKED",
      "Account authorization for this projection source is missing or revoked; scheduled materialization will not read.",
    );
  }

  const delegation = findSeatActionGrant(
    params.store,
    params.tenantId,
    MATERIALIZER_SEAT_ID,
    params.sourceRef,
  );
  if (!delegation) {
    throw new EnterpriseDataStoreError(
      "PROJECTION_EXECUTION_DELEGATION_MISSING",
      "Bridge owner is present but there is no active continuous execution delegation (materializer seat grant) for this action.",
    );
  }

  return { sourceId, userId: owner, employeeId: owner };
}

function presentText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * True only when lineage itself carries a complete verified SAR run and a named validator.
 * Missing fields stay false. They are not treated as verified.
 */
export function lineageRecordsVerifiedSar(record: KnowledgeLineageRecord): boolean {
  if (record.publication === "partial") {
    return false;
  }
  return (
    Boolean(presentText(record.sourceId)) &&
    record.sourceActions.length > 0 &&
    Boolean(presentText(record.sarCapabilityId)) &&
    Boolean(presentText(record.sarVersion)) &&
    Boolean(presentText(record.sarRunId)) &&
    Boolean(presentText(record.validator)) &&
    record.sarVerification === "passed" &&
    record.sarCompleteness === "complete"
  );
}

export function consumerPublicationNotice(
  publication: KnowledgeObjectPublication | undefined,
): string | undefined {
  if (publication !== "partial") {
    return undefined;
  }
  return "不完整输出，不是完整知识对象";
}
