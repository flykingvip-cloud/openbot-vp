/**
 * Unlock rule for packs with employeeVisibilityMode=enterprise_review_required
 * (cn-office). Design: docs/design/openbot-cn-office-capability-approval-backend-2026-10-16.md
 * §5.5 / §7.3 / §10 「完整 cn-office 策略」 item 1.
 *
 * An install is allowed only when the same tenant has a pack_skill_review whose
 * subjectId is buildPackSkillReviewSubjectId(packId, skillKey, targetRobotId),
 * requestedBy is the session actor (per requester, not tenant-wide), status is
 * approved, and fulfillmentStatus is fulfilled.
 *
 * approve_intent_only leaves fulfillmentStatus=pending_admin_save and does not
 * unlock. Admin fulfill records a pack/skill receipt and does not install or
 * write credentials. Listing sources never creates a request.
 */
import {
  findRegistryEntryBySkillKey,
  getRegistryEntry,
  type GovernanceRegistryEntry,
} from "../capability-governance-store.js";
import { getPackById, findPackIdsForSkillKey } from "../capability-packs/starter-packs.js";
import { buildPackSkillReviewSubjectId } from "./capability-access-request.js";
import type {
  EnterpriseDataStore,
  GovernanceApprovalFulfillmentStatus,
  GovernanceApprovalRequest,
} from "./types.js";

export const PACK_SKILL_REVIEW_REQUIRED_CODE = "PACK_SKILL_REVIEW_REQUIRED";

export type PackSkillReviewGateStatus =
  | "missing"
  | "pending"
  | "approved_pending_fulfillment"
  | "fulfilled"
  | "rejected"
  | "cancelled";

export type ReviewRequiredPackSkill = {
  packId: string;
  skillKey: string;
};

export type PackSkillReviewUnlock = {
  subjectId: string;
  status: PackSkillReviewGateStatus;
  unlocked: boolean;
  approvalId?: string;
  fulfillmentStatus?: GovernanceApprovalFulfillmentStatus;
};

const STATUS_RANK: Record<PackSkillReviewGateStatus, number> = {
  fulfilled: 5,
  approved_pending_fulfillment: 4,
  pending: 3,
  rejected: 2,
  cancelled: 1,
  missing: 0,
};

function skillKeyOf(entry: GovernanceRegistryEntry): string {
  return typeof entry.manifest.skillKey === "string" ? entry.manifest.skillKey.trim() : "";
}

function packIdOf(entry: GovernanceRegistryEntry): string {
  return typeof entry.manifest.packId === "string" ? entry.manifest.packId.trim() : "";
}

function reviewPackForSkill(packId: string, skillKey: string): ReviewRequiredPackSkill | null {
  const pack = getPackById(packId);
  if (!pack || pack.employeeVisibilityMode !== "enterprise_review_required") {
    return null;
  }
  if (!pack.skills.some((skill) => skill.skillKey === skillKey)) {
    return null;
  }
  return { packId: pack.id, skillKey };
}

/**
 * Registry distribution and the pack definition must both require enterprise review.
 * Non-pack rows that default to enterprise_review_required stay display-only.
 */
export function resolveReviewRequiredPackSkill(
  entry: GovernanceRegistryEntry | null | undefined,
): ReviewRequiredPackSkill | null {
  if (!entry || entry.distribution.employeeVisibilityMode !== "enterprise_review_required") {
    return null;
  }
  const skillKey = skillKeyOf(entry);
  if (!skillKey) {
    return null;
  }
  const fromManifest = reviewPackForSkill(packIdOf(entry), skillKey);
  if (fromManifest) {
    return fromManifest;
  }
  for (const packId of findPackIdsForSkillKey(skillKey)) {
    const match = reviewPackForSkill(packId, skillKey);
    if (match) {
      return match;
    }
  }
  return null;
}

export function findReviewRequiredPackSkillByCapabilityId(
  capabilityId: string,
): { entry: GovernanceRegistryEntry; target: ReviewRequiredPackSkill } | null {
  const id = capabilityId.trim();
  if (!id) {
    return null;
  }
  const entry = getRegistryEntry(id) ?? findRegistryEntryBySkillKey(id);
  const target = resolveReviewRequiredPackSkill(entry);
  if (!entry || !target) {
    return null;
  }
  return { entry, target };
}

function classifyRequest(request: {
  status: string;
  fulfillmentStatus?: string;
}): PackSkillReviewGateStatus {
  if (request.status === "approved" && request.fulfillmentStatus === "fulfilled") {
    return "fulfilled";
  }
  if (request.status === "approved") {
    return "approved_pending_fulfillment";
  }
  if (request.status === "pending") {
    return "pending";
  }
  if (request.status === "rejected") {
    return "rejected";
  }
  if (request.status === "cancelled") {
    return "cancelled";
  }
  return "missing";
}

/**
 * Per requester + subjectId. Another employee's fulfilled review does not unlock
 * this installer, and a review for another tenant or robot does not either.
 */
export function evaluatePackSkillReviewUnlock(params: {
  store: EnterpriseDataStore;
  tenantId: string;
  requestedBy: string;
  packId: string;
  skillKey: string;
  targetRobotId: string;
}): PackSkillReviewUnlock {
  const subjectId = buildPackSkillReviewSubjectId({
    packId: params.packId,
    skillKey: params.skillKey,
    targetRobotId: params.targetRobotId,
  });
  const matches = Object.values(params.store.governanceApprovalRequests).filter(
    (request) =>
      request.tenantId === params.tenantId &&
      request.category === "pack_skill_review" &&
      request.subjectId === subjectId &&
      request.requestedBy === params.requestedBy,
  );
  let bestRequest: GovernanceApprovalRequest | null = null;
  let bestStatus: PackSkillReviewGateStatus = "missing";
  for (const request of matches) {
    const status = classifyRequest(request);
    if (!bestRequest) {
      bestRequest = request;
      bestStatus = status;
      continue;
    }
    const rankDelta = STATUS_RANK[status] - STATUS_RANK[bestStatus];
    if (rankDelta > 0 || (rankDelta === 0 && request.requestedAt > bestRequest.requestedAt)) {
      bestRequest = request;
      bestStatus = status;
    }
  }
  if (!bestRequest) {
    return { subjectId, status: "missing", unlocked: false };
  }
  return {
    subjectId,
    status: bestStatus,
    unlocked: bestStatus === "fulfilled",
    approvalId: bestRequest.approvalId,
    ...(bestRequest.fulfillmentStatus ? { fulfillmentStatus: bestRequest.fulfillmentStatus } : {}),
  };
}

export function packSkillReviewBlockMessage(
  status: PackSkillReviewGateStatus | "session_unresolved",
): string {
  switch (status) {
    case "pending":
      return "该技能已提交企业审核，通过并开通后才能安装。";
    case "approved_pending_fulfillment":
      return "企业已批准该技能，等待管理员开通后才能安装。批准不会自动安装。";
    case "rejected":
      return "企业审核未通过，当前不能安装该技能。";
    case "cancelled":
      return "技能审核已撤回。请重新提交企业审核后再安装。";
    case "session_unresolved":
      return "无法确认当前企业会话，不能安装需企业审核的技能。";
    default:
      return "该技能需要企业审核。请先提交审核，管理员批准并开通后才能安装。";
  }
}

export function packSkillReviewNextStep(
  status: PackSkillReviewGateStatus | "session_unresolved",
): string {
  switch (status) {
    case "pending":
      return "wait_pack_skill_review";
    case "approved_pending_fulfillment":
      return "wait_admin_fulfill";
    case "session_unresolved":
      return "retry_signed_in";
    default:
      return "submit_pack_skill_review";
  }
}
