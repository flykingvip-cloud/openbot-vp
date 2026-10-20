import { createHash } from "node:crypto";
import type { ValidationReceipt } from "./types.js";

type TrustedValidator = {
  id: string;
  version: string;
};

const trusted = new Map<string, TrustedValidator>();
const receipts: ValidationReceipt[] = [];
const decisionCounts = new Map<string, number>();

export function resetValidationStateForTest(): void {
  trusted.clear();
  receipts.length = 0;
  decisionCounts.clear();
}

export function isTrustedValidatorRegistered(id: string): boolean {
  const validator = trusted.get(id.trim());
  return Boolean(validator?.id && validator.version);
}

export function recordExecutionDecision(decisionCode: string): void {
  const code = decisionCode.trim();
  if (!code) {
    return;
  }
  decisionCounts.set(code, (decisionCounts.get(code) ?? 0) + 1);
}

export function readExecutionDecisionCount(decisionCode: string): number {
  return decisionCounts.get(decisionCode) ?? 0;
}

/** Host code registers validators. Model text cannot add one. */
export function registerTrustedValidator(validator: TrustedValidator): void {
  const id = validator.id.trim();
  const version = validator.version.trim();
  if (!id || !version) {
    return;
  }
  trusted.set(id, { id, version });
}

export function hashArtifact(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function issueValidationReceipt(input: {
  validatorId: string;
  taskId: string;
  artifactPath: string;
  artifactBytes: Buffer | string;
  now?: Date;
  result?: ValidationReceipt["result"];
}): ValidationReceipt | undefined {
  const validator = trusted.get(input.validatorId.trim());
  const taskId = input.taskId.trim();
  const artifactPath = input.artifactPath.trim();
  if (!validator || !taskId || !artifactPath) {
    return undefined;
  }
  const receipt: ValidationReceipt = {
    taskId,
    artifactPath,
    artifactHash: hashArtifact(input.artifactBytes),
    validatorId: validator.id,
    validatorVersion: validator.version,
    timestamp: (input.now ?? new Date()).toISOString(),
    result: input.result ?? "passed",
  };
  receipts.push(receipt);
  return receipt;
}

export type ValidatorMatchStatus = "passed" | "missing" | "failed" | "stale" | "version_mismatch";

export type ValidatorMatch = {
  validatorId: string;
  status: ValidatorMatchStatus;
  receipt?: ValidationReceipt;
};

/** Every required validator must match this task, path, and hash. */
export function matchRequiredValidators(params: {
  taskId: string;
  artifactPath: string;
  artifactHash: string;
  requiredValidators: string[];
}): ValidatorMatch[] {
  return params.requiredValidators.map((validatorId) => {
    const registered = trusted.get(validatorId);
    const samePath = receipts.filter(
      (receipt) =>
        receipt.validatorId === validatorId &&
        receipt.taskId === params.taskId &&
        receipt.artifactPath === params.artifactPath,
    );
    if (!registered) {
      return { validatorId, status: "missing" };
    }
    const passed = samePath.find(
      (receipt) =>
        receipt.result === "passed" &&
        receipt.artifactHash === params.artifactHash &&
        receipt.validatorVersion === registered.version,
    );
    if (passed) {
      return { validatorId, status: "passed", receipt: passed };
    }
    const failed = samePath.find(
      (receipt) => receipt.result === "failed" && receipt.artifactHash === params.artifactHash,
    );
    if (failed) {
      return { validatorId, status: "failed", receipt: failed };
    }
    const wrongVersion = samePath.find(
      (receipt) =>
        receipt.artifactHash === params.artifactHash &&
        receipt.validatorVersion !== registered.version,
    );
    if (wrongVersion) {
      return { validatorId, status: "version_mismatch", receipt: wrongVersion };
    }
    const stale = samePath.find((receipt) => receipt.artifactHash !== params.artifactHash);
    if (stale) {
      return { validatorId, status: "stale", receipt: stale };
    }
    return { validatorId, status: "missing" };
  });
}

/** Latest in-memory receipt for observability. Does not authorize delivery. */
export function readLatestValidationReceipt(taskId: string): ValidationReceipt | undefined {
  const id = taskId.trim();
  if (!id) {
    return undefined;
  }
  for (let index = receipts.length - 1; index >= 0; index -= 1) {
    const receipt = receipts[index];
    if (receipt?.taskId === id) {
      return receipt;
    }
  }
  return undefined;
}

export function findValidReceipt(params: {
  taskId: string;
  artifactPath: string;
  artifactHash: string;
  requiredValidators: string[];
}): ValidationReceipt | undefined {
  if (params.requiredValidators.length === 0) {
    return undefined;
  }
  const matches = matchRequiredValidators(params);
  if (matches.some((match) => match.status !== "passed")) {
    return undefined;
  }
  return matches[0]?.receipt;
}

/** Same task and path, but the stored hash is no longer the file on disk. */
export function findStaleReceipt(params: {
  taskId: string;
  artifactPath: string;
  artifactHash: string;
  requiredValidators: string[];
}): ValidationReceipt | undefined {
  const matches = matchRequiredValidators(params);
  return matches.find((match) => match.status === "stale")?.receipt;
}
