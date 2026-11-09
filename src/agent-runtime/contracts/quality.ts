/** Existing version-bound validator receipt; evidence of a check, not a transport receipt. */
export type ValidationReceipt = {
  taskId: string;
  artifactPath: string;
  artifactHash: string;
  validatorId: string;
  validatorVersion: string;
  timestamp: string;
  result: "passed" | "failed";
};

/** Declarative checks only. No command, expression, module path or executable configuration. */
export type TaskAcceptanceCheck = {
  criterion: number;
  validator: "artifact.text.exact.v1";
  artifact: string;
  expected: string;
};

export type TaskCriterionVerdict = {
  criterion: number;
  status: "passed" | "failed" | "pending";
  reason: string;
  artifactHash?: string;
};

/** Bound to one accepted criterion set and execution; never a transport receipt. */
export type TaskAcceptanceEvaluation = {
  taskId: string;
  executionAttempt: string;
  deliverableVersion: string;
  criteriaHash: string;
  status: "passed" | "failed" | "pending";
  verdicts: TaskCriterionVerdict[];
};
