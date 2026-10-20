import { readFileSync } from "node:fs";
import path from "node:path";
import { readNotedDeliveryArtifactPaths } from "./delivery.js";
import {
  JSON_CANVAS_VALIDATOR_ID,
  JSON_CANVAS_VALIDATOR_VERSION,
  validateJsonCanvasBytes,
} from "./json-canvas-validator.js";
import type { SkillRuntimeContract } from "./skill-contract.js";
import type { ExecutionPreflight } from "./types.js";
import { issueValidationReceipt, registerTrustedValidator } from "./validation.js";

const DEFAULT_VALIDATOR_BUDGET_MS = 2_000;

let registrationAllowed = true;

/** Tests use this to prove an unregistered validator fails closed. */
export function setProductionValidatorRegistrationForTest(allowed: boolean): void {
  registrationAllowed = allowed;
}

/**
 * True only when `OPENBOT_CANARY_VALIDATORS` names this id (comma-separated).
 * Empty / unset => inert: no registration, no contract enforcement, no delivery hold.
 * Never bake this env into image or compose defaults — host canary only.
 */
export function productionCanaryEnabled(validatorId: string): boolean {
  const raw = process.env.OPENBOT_CANARY_VALIDATORS ?? "";
  return raw
    .split(/[,，]/u)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .includes(validatorId);
}

/**
 * Host startup and preflight call this. Model text cannot register a validator.
 * Registers nothing unless `OPENBOT_CANARY_VALIDATORS` names the production id.
 */
export function ensureProductionValidatorsRegistered(): void {
  if (!registrationAllowed || !productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)) {
    return;
  }
  registerTrustedValidator({
    id: JSON_CANVAS_VALIDATOR_ID,
    version: JSON_CANVAS_VALIDATOR_VERSION,
  });
}

/**
 * The json-canvas contract stays in SKILL.md, but it is inert until
 * OPENBOT_CANARY_VALIDATORS includes its validator id.
 */
export function gateProductionCanaryContract(
  contract: SkillRuntimeContract,
): SkillRuntimeContract | undefined {
  if (!contract.requiredValidators.includes(JSON_CANVAS_VALIDATOR_ID)) {
    return contract;
  }
  if (!productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)) {
    return undefined;
  }
  ensureProductionValidatorsRegistered();
  return contract;
}

export function runProductionValidatorsForAttempt(params: {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  now?: number;
  budgetMs?: number;
  readFile?: (filePath: string) => Buffer;
}): void {
  if (!params.preflight.requiredValidators.includes(JSON_CANVAS_VALIDATOR_ID)) {
    return;
  }
  ensureProductionValidatorsRegistered();
  const workspaceDir = params.workspaceDir?.trim();
  if (!workspaceDir) {
    return;
  }
  const now = params.now ?? Date.now();
  const deadlineMs = now + (params.budgetMs ?? DEFAULT_VALIDATOR_BUDGET_MS);
  const readFile = params.readFile ?? ((filePath: string) => readFileSync(filePath));
  const noted = readNotedDeliveryArtifactPaths(
    params.preflight.taskId,
    params.preflight.attemptNumber,
  );
  for (const required of params.preflight.requiredArtifacts) {
    const relative = noted.find((item) => artifactMatches(item, required));
    if (!relative) {
      continue;
    }
    const absolute = pathInsideWorkspace(workspaceDir, relative);
    if (!absolute) {
      continue;
    }
    let bytes: Buffer;
    try {
      bytes = readFile(absolute);
    } catch {
      continue;
    }
    const judged = validateJsonCanvasBytes(bytes, now, deadlineMs);
    issueValidationReceipt({
      validatorId: JSON_CANVAS_VALIDATOR_ID,
      taskId: params.preflight.taskId,
      artifactPath: relative,
      artifactBytes: bytes,
      now: new Date(now),
      result: judged.result,
    });
  }
}

function artifactMatches(notedPath: string, required: string): boolean {
  const normalized = notedPath.replaceAll("\\", "/");
  const name = required.replaceAll("\\", "/");
  return normalized === name || normalized.endsWith(`/${name}`);
}

function pathInsideWorkspace(workspaceDir: string, relativePath: string): string | undefined {
  const root = path.resolve(workspaceDir);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return target;
}
