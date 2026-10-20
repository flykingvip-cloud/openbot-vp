import { canBindCapsuleToBot } from "@openbot/collaboration-core";
import type { GroupMemoryCapsule } from "@openbot/collaboration-core";

/**
 * Learning eligibility contracts for collaboration learning-governance.
 */
export interface LearningEligibilityResult {
  eligible: boolean;
  reason: string;
  details?: Record<string, unknown>;
}

export interface LearningEligibilityChecker {
  checkEligibility(params: {
    botId: string;
    groupId: string;
    capsuleId: string;
  }): Promise<LearningEligibilityResult>;
  isCapsuleApproved(capsuleId: string): Promise<boolean>;
}

export type LearningEligibilityDependencies = {
  loadCapsule: (capsuleId: string) => Promise<GroupMemoryCapsule | null>;
};

function isCapsuleApprovedValue(capsule: GroupMemoryCapsule | null): boolean {
  return capsule?.status === undefined || capsule.status === "approved";
}

export class DefaultLearningEligibilityChecker implements LearningEligibilityChecker {
  constructor(private readonly deps: LearningEligibilityDependencies) {}

  async checkEligibility(params: {
    botId: string;
    groupId: string;
    capsuleId: string;
  }): Promise<LearningEligibilityResult> {
    const capsule = await this.deps.loadCapsule(params.capsuleId);
    if (!capsule) {
      return {
        eligible: false,
        reason: "capsule_not_found",
      };
    }

    if (capsule.groupId !== params.groupId) {
      return {
        eligible: false,
        reason: "group_mismatch",
        details: { capsuleGroupId: capsule.groupId },
      };
    }

    if (!isCapsuleApprovedValue(capsule)) {
      return {
        eligible: false,
        reason: "capsule_not_approved",
      };
    }

    if (!canBindCapsuleToBot(params.botId, capsule)) {
      return {
        eligible: false,
        reason: "policy_blocked",
        details: {
          sensitivity: capsule.sensitivity,
          reusability: capsule.reusability,
        },
      };
    }

    return {
      eligible: true,
      reason: "eligible",
      details: {
        sensitivity: capsule.sensitivity,
        reusability: capsule.reusability,
      },
    };
  }

  async isCapsuleApproved(capsuleId: string): Promise<boolean> {
    const capsule = await this.deps.loadCapsule(capsuleId);
    return isCapsuleApprovedValue(capsule);
  }
}
