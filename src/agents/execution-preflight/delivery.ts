import { readFileSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import {
  hashArtifact,
  matchRequiredValidators,
} from "../../agent-runtime/delivery/acceptance/index.js";
import { EmptyWorkspaceWriteError } from "../../infra/non-empty-workspace-write.js";
import {
  FIXED_PROGRESS_TEMPLATE,
  judgeCompletionSend,
  textHasCompletionClaim,
} from "./completion-claim.js";
import { confirmationGateRequired, confirmationGateUnresolvedRisks } from "./confirmation-gate.js";
import { SkillContractViolationError } from "./failure.js";
import { recordConfirmPrompt } from "./observability.js";
import type {
  DeliveryDecisionCode,
  DeliveryEvidence,
  DeliveryGateInput,
  ExecutionPreflight,
} from "./types.js";
import type { DeliveryValidatorReceipt } from "./types.js";

/** Fixed hold text. Stream and blocked sends use this. It is not a completion claim. */
export const DELIVERY_HOLD_NOTICE = FIXED_PROGRESS_TEMPLATE;

/** Notify tools that may not claim completion until a receipt matches. */
export const DEFAULT_DELIVERY_STAGE_TOOLS = ["message", "sessions_send"] as const;

const NOTIFY_TOOLS = new Set<string>(DEFAULT_DELIVERY_STAGE_TOOLS);
const notedPaths = new Map<string, string[]>();

function noteKey(taskId: string, attemptNumber: number): string {
  return `${taskId}:${attemptNumber}`;
}

export function resetDeliveryArtifactsForTest(): void {
  notedPaths.clear();
}

/** write/edit tools call this with the path argument. Exec output is not a path source. */
export function noteDeliveryArtifactPath(
  taskId: string,
  attemptNumber: number,
  filePath: string,
): void {
  const trimmed = filePath.trim();
  if (!trimmed) {
    return;
  }
  const key = noteKey(taskId, attemptNumber);
  const current = notedPaths.get(key) ?? [];
  if (!current.includes(trimmed)) {
    current.push(trimmed);
  }
  notedPaths.set(key, current);
}

export function readNotedDeliveryArtifactPaths(taskId: string, attemptNumber: number): string[] {
  return notedPaths.get(noteKey(taskId, attemptNumber))?.slice() ?? [];
}

/**
 * Commit-before-note companion: a write/edit that left a zero-byte workspace file
 * is not a durable deliverable. Missing files are not observed here — the tool
 * result is still the success signal from #699 when we cannot see the bytes.
 * A file we can see at size 0 fails the note and is removed so preview stays a miss.
 */
export function assertNotedArtifactNonEmpty(
  workspaceDir: string | undefined,
  filePath: string,
): void {
  const root = workspaceDir?.trim();
  if (!root) {
    return;
  }
  const absolute = resolveInsideWorkspace(root, filePath);
  if (!absolute) {
    return;
  }
  let size = -1;
  try {
    const stat = statSync(absolute);
    if (!stat.isFile()) {
      return;
    }
    size = stat.size;
  } catch {
    return;
  }
  if (size > 0) {
    return;
  }
  try {
    unlinkSync(absolute);
  } catch {
    // Still refuse the note if the empty file cannot be removed.
  }
  throw new EmptyWorkspaceWriteError(filePath);
}

function resolveInsideWorkspace(workspaceDir: string, filePath: string): string | undefined {
  const root = path.resolve(workspaceDir);
  const absolute = path.resolve(root, filePath);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) {
    return undefined;
  }
  return absolute;
}

function artifactTypeOf(filePath: string): string {
  const extension = path.extname(filePath).replace(/^\./u, "").toLowerCase();
  return extension || "file";
}

export function pathFromToolArgs(args: unknown): string | undefined {
  if (!args || typeof args !== "object") {
    return undefined;
  }
  const record = args as Record<string, unknown>;
  for (const key of ["path", "file_path", "filePath"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function gateInput(params: {
  taskId: string;
  artifactPath?: string;
  artifactSha256?: string;
  artifactType?: string;
  validatorId?: string;
  validatorVersion?: string;
  validationResult: DeliveryGateInput["validationResult"];
  validatorReceipts?: DeliveryValidatorReceipt[];
}): DeliveryGateInput {
  return {
    taskId: params.taskId,
    ...(params.artifactPath ? { artifactPath: params.artifactPath } : {}),
    ...(params.artifactSha256 ? { artifactSha256: params.artifactSha256 } : {}),
    ...(params.artifactType ? { artifactType: params.artifactType } : {}),
    ...(params.validatorId ? { validatorId: params.validatorId } : {}),
    ...(params.validatorVersion ? { validatorVersion: params.validatorVersion } : {}),
    validationResult: params.validationResult,
    ...(params.validatorReceipts ? { validatorReceipts: params.validatorReceipts } : {}),
  };
}

type ArtifactCheck = {
  path: string;
  hash?: string;
  type?: string;
  exists: boolean;
  readable: boolean;
};

function artifactMatchesRequired(written: string, required: string): boolean {
  const left = written.replaceAll("\\", "/");
  const right = required.replaceAll("\\", "/").replace(/^\.\//u, "");
  return left === right || left.endsWith(`/${right}`);
}

export function evaluateDeliveryEvidence(params: {
  preflight: Pick<
    ExecutionPreflight,
    | "deliveryRequirements"
    | "deliveryBlockedUntil"
    | "decisionCode"
    | "requiredValidators"
    | "requiredArtifacts"
    | "requiredConfirmations"
    | "taskId"
    | "attemptNumber"
  >;
  artifactPath?: string;
  artifactHash?: string;
  artifactType?: string;
  artifactExists?: boolean;
  artifactReadable?: boolean;
  artifacts?: ArtifactCheck[];
  /** Ignored when a validator is required. Model text is not evidence. */
  modelClaim?: string;
  unresolvedRisks?: string[];
}): DeliveryEvidence {
  const checks = artifactChecks(params);
  const artifactExists = checks.length > 0 && checks.every((item) => item.exists);
  const artifactReadable = checks.length > 0 && checks.every((item) => item.readable);
  const blockedUntil = params.preflight.deliveryBlockedUntil?.trim();
  const requiredValidators = params.preflight.requiredValidators;
  const requiredConfirmations = params.preflight.requiredConfirmations ?? [];
  const confirmationRisks = confirmationGateUnresolvedRisks({
    taskId: params.preflight.taskId,
    attemptNumber: params.preflight.attemptNumber ?? 1,
    requiredConfirmations,
  });
  const unresolvedRisks = [...(params.unresolvedRisks ?? []), ...confirmationRisks];
  const needsConfirmation = confirmationGateRequired(requiredConfirmations);
  const needsReceipt = Boolean(blockedUntil) || requiredValidators.length > 0;
  void params.modelClaim;

  let decisionCode: DeliveryDecisionCode = "delivery_allowed";
  let validationPassed = true;
  let validationResult: DeliveryGateInput["validationResult"] = needsReceipt
    ? "missing"
    : "not_required";
  let validatorReceipts: DeliveryValidatorReceipt[] = [];

  if (
    params.preflight.decisionCode === "validator_unavailable" ||
    params.preflight.decisionCode === "skill_disabled" ||
    params.preflight.decisionCode === "skill_ambiguous" ||
    params.preflight.decisionCode === "skill_alias_unresolved" ||
    params.preflight.decisionCode === "goal_unclear"
  ) {
    decisionCode =
      params.preflight.decisionCode === "validator_unavailable"
        ? "validator_unavailable"
        : "delivery_blocked";
    validationPassed = false;
    validationResult = "missing";
  } else if (needsConfirmation && confirmationRisks.length > 0) {
    // Declared confirmation gates block completion until noted as passed.
    decisionCode = "delivery_blocked";
    validationPassed = false;
    validationResult = needsReceipt ? "missing" : "not_required";
  } else if (!needsReceipt) {
    decisionCode = unresolvedRisks.length === 0 ? "delivery_allowed" : "delivery_blocked";
    validationPassed = true;
    validationResult = "not_required";
  } else if (checks.length === 0 || requiredValidators.length === 0) {
    decisionCode = "delivery_blocked";
    validationPassed = false;
    validationResult = "missing";
  } else {
    const judged = judgeArtifactReceipts({
      taskId: params.preflight.taskId,
      requiredValidators,
      checks,
    });
    validatorReceipts = judged.receipts;
    const onlyStale =
      judged.statuses.some((status) => status === "stale") &&
      judged.statuses.every((status) => status === "passed" || status === "stale");
    if (judged.statuses.every((status) => status === "passed")) {
      decisionCode = unresolvedRisks.length === 0 ? "delivery_allowed" : "delivery_blocked";
      validationPassed = true;
      validationResult = "passed";
    } else if (onlyStale) {
      decisionCode = "artifact_changed";
      validationPassed = false;
      validationResult = "failed";
    } else {
      decisionCode = "delivery_blocked";
      validationPassed = false;
      validationResult = judged.statuses.some((status) => status === "failed")
        ? "failed"
        : "missing";
    }
  }

  const allowedToDeliver = decisionCode === "delivery_allowed";
  const summary = allowedToDeliver ? "可以对外给出结果。" : "结果尚未对外公布。";
  const sole = validatorReceipts.length === 1 ? validatorReceipts[0] : undefined;
  const primary = checks[0];
  return {
    artifactExists,
    artifactReadable,
    validationPassed,
    decisionCode,
    userVisibleSummary: summary,
    unresolvedRisks,
    allowedToDeliver,
    gateInput: gateInput({
      taskId: params.preflight.taskId,
      artifactPath: sole?.artifactPath ?? primary?.path,
      artifactSha256: sole?.artifactSha256 ?? primary?.hash,
      artifactType: primary?.type,
      validatorId: sole?.validatorId,
      validatorVersion: sole?.validatorVersion,
      validationResult,
      ...(validatorReceipts.length > 0 ? { validatorReceipts } : {}),
    }),
  };
}

function artifactChecks(params: {
  artifactPath?: string;
  artifactHash?: string;
  artifactType?: string;
  artifactExists?: boolean;
  artifactReadable?: boolean;
  artifacts?: ArtifactCheck[];
}): ArtifactCheck[] {
  if (params.artifacts) {
    return params.artifacts;
  }
  const artifactPath = params.artifactPath?.trim();
  const artifactHash = params.artifactHash?.trim();
  if (!artifactPath || !artifactHash) {
    return [];
  }
  return [
    {
      path: artifactPath,
      hash: artifactHash,
      type: params.artifactType,
      exists: params.artifactExists === true,
      readable: params.artifactReadable === true,
    },
  ];
}

function judgeArtifactReceipts(params: {
  taskId: string;
  requiredValidators: string[];
  checks: ArtifactCheck[];
}): {
  receipts: DeliveryValidatorReceipt[];
  statuses: Array<"passed" | "failed" | "missing" | "stale" | "version_mismatch">;
} {
  const receipts: DeliveryValidatorReceipt[] = [];
  const statuses: Array<"passed" | "failed" | "missing" | "stale" | "version_mismatch"> = [];
  for (const artifact of params.checks) {
    if (!artifact.exists || !artifact.hash) {
      for (const validatorId of params.requiredValidators) {
        receipts.push({
          validatorId,
          artifactPath: artifact.path,
          validationResult: "missing",
        });
        statuses.push("missing");
      }
      continue;
    }
    const matches = matchRequiredValidators({
      taskId: params.taskId,
      artifactPath: artifact.path,
      artifactHash: artifact.hash,
      requiredValidators: params.requiredValidators,
    });
    for (const match of matches) {
      receipts.push({
        validatorId: match.validatorId,
        ...(match.receipt?.validatorVersion
          ? { validatorVersion: match.receipt.validatorVersion }
          : {}),
        artifactPath: artifact.path,
        artifactSha256: artifact.hash,
        validationResult:
          match.status === "passed" ? "passed" : match.status === "failed" ? "failed" : "missing",
      });
      statuses.push(match.status);
    }
  }
  return { receipts, statuses };
}

export type AttemptDeliveryArtifact = {
  path: string;
  bytes: Buffer;
  type: string;
};

/**
 * The attempt return calls this. It hashes the write/edit path recorded for
 * this task, then asks the delivery gate. Missing path or hash blocks delivery
 * when validators are required.
 */
export function resolveAttemptDelivery(params: {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  readFile?: (filePath: string) => Buffer;
  artifacts?: AttemptDeliveryArtifact[];
}): DeliveryEvidence {
  const artifacts =
    params.artifacts ??
    loadNotedArtifacts({
      preflight: params.preflight,
      workspaceDir: params.workspaceDir,
      readFile: params.readFile,
    });
  return evaluateDeliveryEvidence({
    preflight: params.preflight,
    artifacts: selectRequiredArtifacts(params.preflight.requiredArtifacts, artifacts),
  });
}

function selectRequiredArtifacts(
  required: string[],
  loaded: AttemptDeliveryArtifact[],
): ArtifactCheck[] {
  if (required.length === 0) {
    const latest = loaded.at(-1);
    return latest
      ? [
          {
            path: latest.path,
            hash: hashArtifact(latest.bytes),
            type: latest.type,
            exists: true,
            readable: latest.bytes.length > 0,
          },
        ]
      : [];
  }
  return required.map((name) => {
    const exact = loaded.find(
      (item) => item.path.replaceAll("\\", "/") === name.replaceAll("\\", "/"),
    );
    const matched = exact ?? loaded.find((item) => artifactMatchesRequired(item.path, name));
    if (!matched) {
      return { path: name, exists: false, readable: false };
    }
    return {
      path: matched.path,
      hash: hashArtifact(matched.bytes),
      type: matched.type,
      exists: true,
      readable: matched.bytes.length > 0,
    };
  });
}

function loadNotedArtifacts(params: {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  readFile?: (filePath: string) => Buffer;
}): AttemptDeliveryArtifact[] {
  const workspaceDir = params.workspaceDir?.trim();
  if (!workspaceDir) {
    return [];
  }
  const readFile = params.readFile ?? ((filePath: string) => readFileSync(filePath));
  const artifacts: AttemptDeliveryArtifact[] = [];
  for (const filePath of readNotedDeliveryArtifactPaths(
    params.preflight.taskId,
    params.preflight.attemptNumber,
  )) {
    const absolute = resolveInsideWorkspace(workspaceDir, filePath);
    if (!absolute) {
      continue;
    }
    try {
      const bytes = readFile(absolute);
      artifacts.push({
        path: filePath,
        bytes,
        type: artifactTypeOf(filePath),
      });
    } catch {
      // Missing file stays a delivery block when a validator is required.
    }
  }
  return artifacts;
}

function validatorsRequired(evidence: DeliveryEvidence): boolean {
  return evidence.gateInput.validationResult !== "not_required";
}

/** Hold completion claims when validators OR confirmation gates have not cleared. */
function completionHoldRequired(evidence: DeliveryEvidence): boolean {
  return validatorsRequired(evidence) || !evidence.allowedToDeliver;
}

/** Replace a completion claim when the contract has no trusted receipt. */
export function gateAssistantTexts(texts: string[], evidence: DeliveryEvidence): string[] {
  if (!completionHoldRequired(evidence)) {
    return texts;
  }
  const judgedTexts = texts.map((text) => {
    const judged = judgeCompletionSend({
      text,
      validatorsRequired: true,
      allowedToDeliver: evidence.allowedToDeliver,
    });
    if (judged.outcome === "completion_blocked") {
      recordConfirmPrompt({
        taskId: evidence.gateInput.taskId,
        decisionKey: judged.decisionCode,
      });
      return judged.visibleText;
    }
    return text;
  });
  if (judgedTexts.length === 0 && !evidence.allowedToDeliver) {
    return [DELIVERY_HOLD_NOTICE];
  }
  return judgedTexts;
}

export function gateReplyText(
  text: string | undefined,
  evidence: DeliveryEvidence,
): string | undefined {
  if (typeof text !== "string") {
    return text;
  }
  return gateAssistantTexts([text], evidence)[0];
}

export function deliveryStageToolNames(
  preflight: Pick<
    ExecutionPreflight,
    | "deliveryStageTools"
    | "generationStageTools"
    | "requiredValidators"
    | "deliveryBlockedUntil"
    | "requiredConfirmations"
  >,
): string[] {
  const generation = new Set(preflight.generationStageTools.map((name) => name.toLowerCase()));
  const declared = preflight.deliveryStageTools.filter(
    (name) => !generation.has(name.toLowerCase()),
  );
  const needsHold =
    preflight.requiredValidators.length > 0 ||
    Boolean(preflight.deliveryBlockedUntil?.trim()) ||
    confirmationGateRequired(preflight.requiredConfirmations);
  const names =
    declared.length > 0
      ? declared
      : needsHold
        ? DEFAULT_DELIVERY_STAGE_TOOLS.filter((name) => !generation.has(name))
        : [];
  return names;
}

/**
 * Stream path: model delta → this judge → user-visible callback.
 * Until a receipt is valid, the callback receives only the fixed progress template.
 */
export function bindGatedReply<T extends { text?: string }>(
  emit: ((payload: T) => void | Promise<void>) | undefined,
  readEvidence: () => DeliveryEvidence,
): ((payload: T) => void | Promise<void>) | undefined {
  if (!emit) {
    return undefined;
  }
  return (payload) => {
    if (typeof payload.text !== "string") {
      return emit(payload);
    }
    const evidence = readEvidence();
    if (!completionHoldRequired(evidence)) {
      return emit(payload);
    }
    if (!evidence.allowedToDeliver) {
      return emit({ ...payload, text: DELIVERY_HOLD_NOTICE });
    }
    const judged = judgeCompletionSend({
      text: payload.text,
      validatorsRequired: true,
      allowedToDeliver: true,
    });
    return emit({ ...payload, text: judged.visibleText });
  };
}

function textFields(args: unknown): string[] {
  if (!args || typeof args !== "object") {
    return [];
  }
  const record = args as Record<string, unknown>;
  const fields = ["text", "content", "message", "caption", "command"];
  return fields.flatMap((field) => (typeof record[field] === "string" ? [record[field]] : []));
}

/**
 * Refuse a delivery-stage tool before its own execute.
 * Notify tools may send progress text. A completion claim needs a matching receipt.
 * write/edit listed as delivery-stage tools are refused entirely until that receipt.
 * Model text cannot move a tool into the delivery stage.
 */
export function assertDeliveryStageSend(params: {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  toolName: string;
  args: unknown;
}): void {
  const name = params.toolName.toLowerCase();
  const stage = new Set(deliveryStageToolNames(params.preflight).map((tool) => tool.toLowerCase()));
  const generation = new Set(
    params.preflight.generationStageTools.map((tool) => tool.toLowerCase()),
  );
  if (generation.has(name) && !stage.has(name)) {
    return;
  }
  if (!stage.has(name)) {
    return;
  }
  const evidence = params.workspaceDir
    ? resolveAttemptDelivery({
        preflight: params.preflight,
        workspaceDir: params.workspaceDir,
      })
    : evaluateDeliveryEvidence({ preflight: params.preflight });
  if (!NOTIFY_TOOLS.has(name)) {
    if (!evidence.allowedToDeliver) {
      throw new SkillContractViolationError(
        `delivery_blocked: ${name} before receipt (${evidence.decisionCode})`,
      );
    }
    return;
  }
  const judged = judgeCompletionSend({
    text: textFields(params.args).join("\n"),
    validatorsRequired: true,
    allowedToDeliver: evidence.allowedToDeliver,
  });
  if (judged.outcome !== "completion_blocked") {
    return;
  }
  throw new SkillContractViolationError(
    `delivery_blocked: completion send before receipt (${judged.decisionCode})`,
  );
}

export function toolArgsClaimCompletion(args: unknown): boolean {
  return textFields(args).some((text) => textHasCompletionClaim(text));
}

function readStageEvidence(preflight: ExecutionPreflight, workspaceDir?: string): DeliveryEvidence {
  return workspaceDir
    ? resolveAttemptDelivery({ preflight, workspaceDir })
    : evaluateDeliveryEvidence({ preflight });
}

/**
 * Stage comes from the skill contract, never from model text.
 * Unspecified stage keeps write/edit available.
 */
export function assertExecutionStageTool(params: {
  preflight: ExecutionPreflight;
  workspaceDir?: string;
  toolName: string;
}): void {
  const stage = params.preflight.executionStage;
  if (stage !== "generation" && stage !== "delivery") {
    return;
  }
  const name = params.toolName.toLowerCase();
  const writing = name === "write" || name === "edit";
  if (!writing) {
    return;
  }
  const configured = params.preflight.generationStageTools.map((tool) => tool.toLowerCase());
  if (stage === "generation") {
    if (configured.length > 0 && !configured.includes(name)) {
      throw new SkillContractViolationError(
        "delivery_blocked: write is outside the generation-stage contract",
      );
    }
    return;
  }
  const evidence = readStageEvidence(params.preflight, params.workspaceDir);
  if (!evidence.allowedToDeliver) {
    throw new SkillContractViolationError(
      `delivery_blocked: write before a delivery receipt (${evidence.decisionCode})`,
    );
  }
}
