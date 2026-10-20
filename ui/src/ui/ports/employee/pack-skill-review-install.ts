import { GatewayRequestError } from "../../gateway.ts";

export type PackSkillReviewInstallBlock = {
  message: string;
  nextStep: string;
  packId: string;
  skillKey: string;
  targetRobotId: string;
  capabilityId?: string;
  approvalStatus?: string;
  capabilityAccessRequestId?: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Structured employee-install block for enterprise_review_required pack skills. */
export function readPackSkillReviewInstallBlock(
  error: unknown,
): PackSkillReviewInstallBlock | null {
  const details = asRecord(error instanceof GatewayRequestError ? error.details : null);
  if (!details || details.code !== "PACK_SKILL_REVIEW_REQUIRED") {
    return null;
  }
  const packId = text(details.packId);
  const skillKey = text(details.skillKey);
  const targetRobotId = text(details.targetRobotId);
  const nextStep = text(details.nextStep);
  if (!packId || !skillKey || !targetRobotId || !nextStep) {
    return null;
  }
  const capabilityAccessRequestId = text(details.capabilityAccessRequestId);
  return {
    message:
      error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "该技能需要企业审核。",
    nextStep,
    packId,
    skillKey,
    targetRobotId,
    ...(text(details.capabilityId) ? { capabilityId: text(details.capabilityId) } : {}),
    ...(text(details.approvalStatus) ? { approvalStatus: text(details.approvalStatus) } : {}),
    ...(capabilityAccessRequestId ? { capabilityAccessRequestId } : {}),
  };
}

/** Params for enterprise-data.governance-approvals.create. No install or credential fields. */
export function packSkillReviewSubmitParams(block: PackSkillReviewInstallBlock): {
  category: "pack_skill_review";
  packId: string;
  skillKey: string;
  targetRobotId: string;
  reason: string;
} {
  return {
    category: "pack_skill_review",
    packId: block.packId,
    skillKey: block.skillKey,
    targetRobotId: block.targetRobotId,
    reason: "申请安装需企业审核的技能包能力",
  };
}
