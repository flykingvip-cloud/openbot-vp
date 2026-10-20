import type { SkillLifecycleState } from "./skill-models.ts";

export type SkillStatusTransition = {
  from: SkillLifecycleState;
  to: SkillLifecycleState;
  action:
    | "finalize_draft"
    | "share_to_group"
    | "submit_to_enterprise"
    | "approve"
    | "reject"
    | "publish"
    | "deprecate"
    | "retire";
};

/**
 * 合法状态流转（对应需求 10.10）。
 * 主路径：draft → private → reviewing → approved → published → deprecated → retired
 * 分支：reviewing → rejected
 */
export const VALID_TRANSITIONS: readonly SkillStatusTransition[] = [
  { from: "draft", to: "private", action: "finalize_draft" },
  { from: "private", to: "reviewing", action: "submit_to_enterprise" },
  { from: "reviewing", to: "approved", action: "approve" },
  { from: "reviewing", to: "rejected", action: "reject" },
  { from: "approved", to: "published", action: "publish" },
  { from: "published", to: "deprecated", action: "deprecate" },
  { from: "deprecated", to: "retired", action: "retire" },
];

export function isValidTransition(from: SkillLifecycleState, to: SkillLifecycleState): boolean {
  return VALID_TRANSITIONS.some((transition) => transition.from === from && transition.to === to);
}

export function getAvailableTransitions(
  currentStatus: SkillLifecycleState,
): SkillStatusTransition[] {
  return VALID_TRANSITIONS.filter((transition) => transition.from === currentStatus);
}

/**
 * 草稿禁止直接提交企业审核（需求 10.11）。
 * 仅 private 状态可提交。
 */
export function assertCanSubmitToEnterprise(currentStatus: SkillLifecycleState): void {
  if (currentStatus === "draft") {
    throw new Error(
      "Cannot submit to enterprise review: skill must be finalized first (currently in draft)",
    );
  }
  if (currentStatus !== "private") {
    throw new Error(
      `Cannot submit to enterprise review: skill must be in "private" status (currently "${currentStatus}")`,
    );
  }
}

/**
 * 分享到协作小组的合法前置状态：private / approved / published。
 * 分享不改变 Skill_Status。
 */
export function canShareToGroup(currentStatus: SkillLifecycleState): boolean {
  return (
    currentStatus === "private" || currentStatus === "approved" || currentStatus === "published"
  );
}
