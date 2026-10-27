import type { CloseReasonCode, EvaluationEligibility, TaskOutcomeRecord } from "./types.js";

export function computeEvaluationEligibility(record: TaskOutcomeRecord): EvaluationEligibility {
  if (record.lifecycle !== "closed") {
    return {
      countsSkillSuccessRate: false,
      countsGrowthNegative: false,
      countsModelStability: false,
      learningValue: "none",
      attribution: "other",
    };
  }
  const code = record.reasonCode ?? inferReason(record);
  switch (code) {
    case "user_cancelled":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "low",
        attribution: "user_cancel",
      };
    case "authz_denied":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "medium",
        attribution: "authz",
      };
    case "provider_fault":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: true,
        learningValue: "medium",
        attribution: "provider",
      };
    case "delivery_failed":
    case "delivery_unconfirmed_close":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "medium",
        attribution: "delivery",
      };
    case "prepare_failed":
    case "preflight_rejected":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "medium",
        attribution: "prepare",
      };
    case "acceptance_failed_stop":
    case "run_failed":
      return {
        countsSkillSuccessRate: true,
        countsGrowthNegative: true,
        countsModelStability: false,
        learningValue: "high",
        attribution: "capability",
      };
    case "timeout":
    case "user_filtered":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "low",
        attribution: "other",
      };
    case "budget_exceeded":
      return {
        countsSkillSuccessRate: false,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "low",
        attribution: "budget",
      };
    case "accepted_and_delivered":
      return {
        countsSkillSuccessRate: true,
        countsGrowthNegative: false,
        countsModelStability: false,
        learningValue: "high",
        attribution: "capability",
      };
    default:
      return {
        countsSkillSuccessRate:
          record.taskJudgement === "success" || record.taskJudgement === "failure",
        countsGrowthNegative: record.taskJudgement === "failure",
        countsModelStability: false,
        learningValue: "medium",
        attribution: "other",
      };
  }
}

function inferReason(record: TaskOutcomeRecord): CloseReasonCode {
  if (record.taskJudgement === "cancelled") {
    return "user_cancelled";
  }
  if (record.acceptance.status === "failed") {
    return "acceptance_failed_stop";
  }
  if (record.taskJudgement === "success") {
    return "accepted_and_delivered";
  }
  if (record.delivery.status === "delivery_unknown") {
    return "delivery_unconfirmed_close";
  }
  if (record.delivery.status === "failed") {
    return "delivery_failed";
  }
  return "other";
}
