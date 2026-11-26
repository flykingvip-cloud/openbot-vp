/**
 * Session-scoped pack skill install gate.
 * Tenant and actor come from the gateway session, never from client params.
 */
import { loadConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import {
  resolveSessionCapabilityAccessActorId,
  resolveTrustedAdminTenantId,
} from "../enterprise-data/enterprise-data-seat-context.js";
import {
  packSkillReviewBlockMessage,
  packSkillReviewNextStep,
  PACK_SKILL_REVIEW_REQUIRED_CODE,
  evaluatePackSkillReviewUnlock,
  findReviewRequiredPackSkillByCapabilityId,
  type PackSkillReviewGateStatus,
  type PackSkillReviewUnlock,
} from "../enterprise-data/pack-skill-review-gate.js";
import {
  loadEnterpriseDataStore,
  resolveDefaultEnterpriseDataStorePath,
} from "../enterprise-data/store.js";
import type { EnterpriseDataStore } from "../enterprise-data/types.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveControlPlaneStorePathForClient } from "../tenant-context.js";
import { TENANT_ENTERPRISE_DATA_FILE } from "../tenant-store-paths.js";
import type { GatewayClient, RespondFn } from "./types.js";

export class PackSkillReviewRequiredError extends Error {
  readonly code = PACK_SKILL_REVIEW_REQUIRED_CODE;
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown>) {
    super(message);
    this.name = "PackSkillReviewRequiredError";
    this.details = details;
  }
}

export type PackSkillReviewSessionContext = {
  tenantId: string;
  requestedBy: string;
  store: EnterpriseDataStore;
};

async function loadGovernedEnterpriseDataStore(
  client: GatewayClient | null,
): Promise<EnterpriseDataStore> {
  const cfg = loadConfig();
  if (!isSharedTenantAddressingEnabled(cfg)) {
    return loadEnterpriseDataStore(resolveDefaultEnterpriseDataStorePath());
  }
  const storePath = await resolveControlPlaneStorePathForClient(
    client,
    TENANT_ENTERPRISE_DATA_FILE,
    cfg,
  );
  if (!storePath) {
    throw new Error("Enterprise data store path could not be resolved for this session.");
  }
  return loadEnterpriseDataStore(storePath);
}

export async function loadPackSkillReviewSession(
  client: GatewayClient | null,
): Promise<PackSkillReviewSessionContext> {
  // Do not pass RPC params: client tenantId / employeeId are not authorities.
  const tenantId = await resolveTrustedAdminTenantId(client);
  const requestedBy = await resolveSessionCapabilityAccessActorId(client);
  const store = await loadGovernedEnterpriseDataStore(client);
  return { tenantId, requestedBy, store };
}

export async function tryLoadPackSkillReviewSession(
  client: GatewayClient | null,
): Promise<PackSkillReviewSessionContext | null> {
  try {
    return await loadPackSkillReviewSession(client);
  } catch {
    return null;
  }
}

function blockError(params: {
  status: PackSkillReviewGateStatus | "session_unresolved";
  capabilityId: string;
  targetRobotId: string;
  packId: string;
  skillKey: string;
  decision?: PackSkillReviewUnlock;
}): PackSkillReviewRequiredError {
  return new PackSkillReviewRequiredError(packSkillReviewBlockMessage(params.status), {
    code: PACK_SKILL_REVIEW_REQUIRED_CODE,
    nextStep: packSkillReviewNextStep(params.status),
    category: "pack_skill_review",
    rpc: "enterprise-data.governance-approvals.create",
    packId: params.packId,
    skillKey: params.skillKey,
    targetRobotId: params.targetRobotId,
    capabilityId: params.capabilityId,
    approvalStatus: params.status === "session_unresolved" ? "unavailable" : params.status,
    ...(params.decision?.approvalId
      ? { capabilityAccessRequestId: params.decision.approvalId }
      : {}),
    ...(params.decision?.fulfillmentStatus
      ? { fulfillmentStatus: params.decision.fulfillmentStatus }
      : {}),
  });
}

/** Null when install may proceed. Throws nothing; returns the block instead. */
export async function resolvePackSkillInstallBlock(params: {
  client: GatewayClient | null;
  capabilityId: string;
  targetRobotId: string;
}): Promise<PackSkillReviewRequiredError | null> {
  const resolved = findReviewRequiredPackSkillByCapabilityId(params.capabilityId);
  if (!resolved) {
    return null;
  }
  let session: PackSkillReviewSessionContext;
  try {
    session = await loadPackSkillReviewSession(params.client);
  } catch {
    return blockError({
      status: "session_unresolved",
      capabilityId: params.capabilityId,
      targetRobotId: params.targetRobotId,
      packId: resolved.target.packId,
      skillKey: resolved.target.skillKey,
    });
  }
  const decision = evaluatePackSkillReviewUnlock({
    store: session.store,
    tenantId: session.tenantId,
    requestedBy: session.requestedBy,
    packId: resolved.target.packId,
    skillKey: resolved.target.skillKey,
    targetRobotId: params.targetRobotId,
  });
  if (decision.unlocked) {
    return null;
  }
  return blockError({
    status: decision.status,
    capabilityId: params.capabilityId,
    targetRobotId: params.targetRobotId,
    packId: resolved.target.packId,
    skillKey: resolved.target.skillKey,
    decision,
  });
}

export function respondIfPackSkillReviewBlocked(respond: RespondFn, error: unknown): boolean {
  if (!(error instanceof PackSkillReviewRequiredError)) {
    return false;
  }
  respond(
    false,
    undefined,
    errorShape(ErrorCodes.INVALID_REQUEST, error.message, { details: error.details }),
  );
  return true;
}

export function describePackSkillReviewListFields(params: {
  capabilityId: string;
  targetRobotId: string;
  session: PackSkillReviewSessionContext | null;
}): {
  packId?: string;
  skillKey?: string;
  approvalStatus?: string;
  capabilityAccessRequestId?: string;
  fulfillmentStatus?: string;
} {
  const resolved = findReviewRequiredPackSkillByCapabilityId(params.capabilityId);
  if (!resolved) {
    return {};
  }
  if (!params.session) {
    return {
      packId: resolved.target.packId,
      skillKey: resolved.target.skillKey,
      approvalStatus: "unavailable",
    };
  }
  const decision = evaluatePackSkillReviewUnlock({
    store: params.session.store,
    tenantId: params.session.tenantId,
    requestedBy: params.session.requestedBy,
    packId: resolved.target.packId,
    skillKey: resolved.target.skillKey,
    targetRobotId: params.targetRobotId,
  });
  return {
    packId: resolved.target.packId,
    skillKey: resolved.target.skillKey,
    approvalStatus: decision.status,
    ...(decision.approvalId ? { capabilityAccessRequestId: decision.approvalId } : {}),
    ...(decision.fulfillmentStatus ? { fulfillmentStatus: decision.fulfillmentStatus } : {}),
  };
}
