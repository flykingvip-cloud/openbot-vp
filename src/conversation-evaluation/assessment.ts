import type {
  AssessmentStatus,
  ExecutionVerdict,
  FailureAttribution,
  LinkQuality,
  UnassessedReason,
  UsabilityVerdict,
} from "./types.js";

export const ERROR_CLASSES = [
  "timeout",
  "permission",
  "sandbox",
  "config",
  "tool",
  "error",
] as const;
export type ErrorClass = (typeof ERROR_CLASSES)[number];

export function isErrorClass(value: unknown): value is ErrorClass {
  return typeof value === "string" && (ERROR_CLASSES as readonly string[]).includes(value);
}

export function classifyErrorClass(error: unknown): ErrorClass {
  const text = typeof error === "string" ? error.toLowerCase() : "";
  if (!text) {
    return "error";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "timeout";
  }
  if (
    text.includes("permission") ||
    text.includes("unauthorized") ||
    text.includes("forbidden") ||
    text.includes("not allowed")
  ) {
    return "permission";
  }
  if (text.includes("sandbox")) {
    return "sandbox";
  }
  if (text.includes("config")) {
    return "config";
  }
  return "error";
}

export type DimensionJudgement = {
  execution: ExecutionVerdict;
  usability: UsabilityVerdict;
  correctness: "unassessed";
  correctnessReason: UnassessedReason;
  failureAttribution: FailureAttribution;
  assessmentStatus: AssessmentStatus;
  unassessedReason?: UnassessedReason;
  failureCode?: string;
};

/**
 * Correctness is never inferred from execution success.
 * M0 has no user-acceptance signal, so correctness stays unassessed / no_signal.
 * Event payloads that claim correctness are ignored by the caller.
 */
export function judgeDimensions(input: {
  terminal: boolean;
  phase: "start" | "end" | "error" | null;
  aborted: boolean;
  errorClass: ErrorClass | null;
  toolFailed: boolean;
  visible: boolean;
  linkQuality: LinkQuality;
  reducerFailed: boolean;
}): DimensionJudgement {
  if (input.reducerFailed) {
    return {
      execution: "unknown",
      usability: "unassessed",
      correctness: "unassessed",
      correctnessReason: "no_signal",
      failureAttribution: "unknown",
      assessmentStatus: "failed_to_assess",
      failureCode: "reducer_error",
    };
  }

  let execution: ExecutionVerdict = "unknown";
  if (input.aborted) {
    execution = "aborted";
  } else if (input.phase === "error" && input.errorClass === "timeout") {
    execution = "timed_out";
  } else if (input.phase === "error") {
    execution = "errored";
  } else if (input.phase === "end") {
    execution = "completed";
  }

  let usability: UsabilityVerdict = "unassessed";
  if (execution === "unknown") {
    usability = "unassessed";
  } else if (input.visible && execution === "completed") {
    usability = "usable";
  } else if (input.visible) {
    usability = "degraded";
  } else if (execution === "completed") {
    usability = "degraded";
  } else {
    usability = "blocked";
  }

  let failureAttribution: FailureAttribution = "none";
  if (execution === "timed_out") {
    failureAttribution = "external";
  } else if (input.errorClass === "permission") {
    failureAttribution = "permission";
  } else if (input.errorClass === "sandbox") {
    failureAttribution = "sandbox";
  } else if (input.errorClass === "config") {
    failureAttribution = "config";
  } else if (execution === "aborted") {
    failureAttribution = "orchestration";
  } else if (execution === "errored" && input.toolFailed) {
    failureAttribution = "tool";
  } else if (execution === "errored") {
    failureAttribution = "unknown";
  } else if (execution === "unknown") {
    failureAttribution = "unknown";
  }

  const correctness = "unassessed" as const;
  const correctnessReason: UnassessedReason = "no_signal";

  if (!input.terminal) {
    return {
      execution,
      usability,
      correctness,
      correctnessReason,
      failureAttribution,
      assessmentStatus: "pending",
    };
  }

  if (input.linkQuality === "weak") {
    return {
      execution,
      usability,
      correctness,
      correctnessReason,
      failureAttribution,
      assessmentStatus: "unassessed",
      unassessedReason: "out_of_scope",
    };
  }

  if (execution === "unknown") {
    return {
      execution,
      usability,
      correctness,
      correctnessReason,
      failureAttribution,
      assessmentStatus: "unassessed",
      unassessedReason: "insufficient_evidence",
    };
  }

  return {
    execution,
    usability,
    correctness,
    correctnessReason,
    failureAttribution,
    assessmentStatus: "assessed",
  };
}
