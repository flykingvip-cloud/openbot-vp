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
