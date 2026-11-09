/**
 * Floor Runtime v2.1 §2.10 / §5.6 P1-B③ — HandoffContract invariants + txn.
 *
 * Status order: Proposed → ReceiverAccepted → Approved → apply.
 * applyApprovedHandoff is the only mutator. Commit order (§2.10):
 *   1. write `<ns>/handoffs/<taskId>.txn`
 *   2. append TaskResponsibilityChanged (ledger fact)
 *   3. write the task overlay
 *   4. delete the txn
 * A crash after the fact and before the task write leaves the txn. Recovery
 * rolls the task forward and never deletes the fact.
 *
 * Flag `collaboration.task.handoffContract` (plan `collab.task.handoffContract`)
 * defaults off. Flag-off: these functions do not write, and task-runtime keeps
 * the owner_transfer shortcut.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Task } from "@openbot/collaboration-core";
import {
  applyHandoffContractToResponsibility,
  appendHandoffHistoryById,
  classifyHandoffApplyAgainstLive,
  handoffPartyLooksLikeBot as looksLikeBot,
  resolveHandoffApproval as resolveApproval,
  responsibilityFromHandoffTask,
} from "../../agent-runtime/policy/index.js";
import {
  appendHandoffLogLine,
  withHandoffRoundLock,
  writeHandoffJson,
} from "../../agent-runtime/state/index.js";
import type { OpenBotConfig } from "../../config/types.js";
import type { CollaborationFactRecord, HandoffFactType } from "../collaboration-ledger/types.js";
import { appendCollaborationFactRecord } from "../collaboration-ledger/writer.js";
import { eventKeyOf } from "./collaboration-event-key.js";
import type {
  EffectiveCollaborationPolicy,
  TaskHandoff,
  TaskResponsibility,
} from "./effective-policy.js";
import { evaluateGovernanceGate, type GovernanceActor } from "./governance-gate.js";
import {
  enrichHandoffAssumptionsWithOguiBrief,
  resolveOguiHandoffBriefForPropose,
} from "./ogui-handoff-projection.js";
import type { RuntimeAuthority } from "./runtime-authority.js";
import {
  assertCollaborationRuntimeWritable,
  resolveCollaborationRuntimeFactPaths,
} from "./runtime-namespace.js";
import { isCollabTaskHandoffContractEnabled } from "./task-runtime.js";
import { recordWakeEventBestEffort } from "./wake-contract.js";

export type ResponsibilityRole = "owner" | "executor" | "reviewer" | "approver" | "contributor";

export type HandoffStatus =
  | "proposed"
  | "receiver_accepted"
  | "approved"
  | "applied"
  | "completed"
  | "rejected"
  | "expired"
  | "cancelled";

export type HandoffKind = "continue" | "review" | "owner_transfer" | "evidence";

export type HandoffApproval = "none" | "human" | "governance";

export type HandoffParty = Readonly<{
  agentId: string;
  responsibilityRole: ResponsibilityRole;
}>;

export type HandoffContract = Readonly<{
  handoffId: string;
  key: ReturnType<typeof eventKeyOf>;
  taskId: string;
  kind: HandoffKind;
  from: HandoffParty;
  to: HandoffParty;
  completedArtifacts: readonly string[];
  remainingWork: string;
  assumptions: readonly string[];
  blockers: readonly string[];
  acceptanceCriteria: readonly string[];
  status: HandoffStatus;
  requiresApproval: HandoffApproval;
  proposedBy: string;
  proposedAt: number;
  acceptedAt?: number;
  approvedAt?: number;
  appliedAt?: number;
  expiresAt?: number;
  /**
   * T47: responsibility-chain precondition — handoffs[] length observed at propose.
   * Apply refuses when live history length diverges (A→B→A then replay old contract).
   */
  baseHistoryLen?: number;
}>;

export type HandoffTask = Task & {
  responsibility?: TaskResponsibility;
  handoffs?: TaskHandoff[];
};

export type HandoffResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

export type ProposeHandoffInput = {
  taskId: string;
  kind: HandoffKind;
  from: HandoffParty;
  to: HandoffParty;
  completedArtifacts?: readonly string[];
  remainingWork: string;
  assumptions?: readonly string[];
  blockers?: readonly string[];
  acceptanceCriteria: readonly string[];
  proposedBy: string;
  beatId?: string | null;
  requiresApproval?: HandoffApproval;
  expiresAt?: number;
  handoffId?: string;
  /** T47: snapshot of task.handoffs length at propose (duty-chain version). */
  baseHistoryLen?: number;
  /**
   * Optional chat text carrying an `ogui-answer` fence (Form P0 submit).
   * When `collaboration.task.oguiHandoffProjection` is ON, a legal fence is
   * projected into assumptions. Not part of Gateway ProposeHandoff RPC schema.
   */
  sourceChatText?: string;
};

export type HandoffContractOptions = {
  cfg?: OpenBotConfig;
  nowMs?: number;
  /** Test-only: throw after the responsibility fact is durable and before the task write. */
  hooks?: {
    afterFactBeforeTask?: () => void;
  };
};

type HandoffLogLine = {
  kind: "handoff_contract";
  at: number;
  contract: HandoffContract;
};

type HandoffApplyTxn = {
  version: 1;
  handoffId: string;
  taskId: string;
  fact: CollaborationFactRecord;
  task: HandoffTask;
  contract: HandoffContract;
  taskOverlayPath: string;
};

const HANDOFF_KINDS = new Set<HandoffKind>(["continue", "review", "owner_transfer", "evidence"]);
const RESPONSIBILITY_ROLES = new Set<ResponsibilityRole>([
  "owner",
  "executor",
  "reviewer",
  "approver",
  "contributor",
]);
const HANDOFF_STATUSES = new Set<HandoffStatus>([
  "proposed",
  "receiver_accepted",
  "approved",
  "applied",
  "completed",
  "rejected",
  "expired",
  "cancelled",
]);

function fail(reason: string, message: string): HandoffResult<never> {
  return { ok: false, reason, message };
}

function nowOf(options?: HandoffContractOptions): number {
  return options?.nowMs ?? Date.now();
}

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function uniqueIds(values: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values ?? []) {
    const id = compact(value);
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    out.push(id);
  }
  return out;
}

function safeStem(id: string): string | null {
  const trimmed = id.trim();
  if (!trimmed || trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return encodeURIComponent(trimmed);
}

export function handoffLogPath(handoffsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("handoff taskId is not a safe id");
  }
  return path.join(handoffsDir, `${stem}.jsonl`);
}

export function handoffTxnPath(handoffsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("handoff taskId is not a safe id");
  }
  return path.join(handoffsDir, `${stem}.txn`);
}

export function handoffTaskOverlayPath(handoffsDir: string, taskId: string): string {
  const stem = safeStem(taskId);
  if (!stem) {
    throw new Error("handoff taskId is not a safe id");
  }
  return path.join(handoffsDir, `${stem}.task.json`);
}

function isParty(value: unknown): value is HandoffParty {
  if (!value || typeof value !== "object") {
    return false;
  }
  const party = value as HandoffParty;
  return (
    typeof party.agentId === "string" &&
    party.agentId.trim().length > 0 &&
    RESPONSIBILITY_ROLES.has(party.responsibilityRole)
  );
}

function isHandoffContract(value: unknown): value is HandoffContract {
  if (!value || typeof value !== "object") {
    return false;
  }
  const contract = value as HandoffContract;
  return (
    typeof contract.handoffId === "string" &&
    contract.handoffId.trim().length > 0 &&
    typeof contract.taskId === "string" &&
    HANDOFF_KINDS.has(contract.kind) &&
    HANDOFF_STATUSES.has(contract.status) &&
    isParty(contract.from) &&
    isParty(contract.to) &&
    contract.key !== undefined &&
    typeof contract.key === "object"
  );
}

function flagOff<T>(): HandoffResult<T> {
  return fail(
    "flag_off",
    "collaboration.task.handoffContract is off; HandoffContract does not write",
  );
}

async function readLog(logPath: string): Promise<HandoffLogLine[]> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: HandoffLogLine[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as HandoffLogLine;
      if (parsed?.kind === "handoff_contract" && isHandoffContract(parsed.contract)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

export async function loadHandoffContract(
  authority: RuntimeAuthority,
  params: { taskId: string; handoffId: string },
): Promise<HandoffContract | null> {
  const taskId = compact(params.taskId);
  const handoffId = compact(params.handoffId);
  if (!safeStem(taskId) || !handoffId) {
    return null;
  }
  const lines = await readLog(handoffLogPath(authority.namespace.handoffsDir, taskId));
  return latestContract(lines, handoffId);
}

function latestContract(
  lines: readonly HandoffLogLine[],
  handoffId: string,
): HandoffContract | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const contract = lines[i]?.contract;
    if (contract?.handoffId === handoffId) {
      return contract;
    }
  }
  return null;
}

async function appendContract(
  logPath: string,
  contract: HandoffContract,
  at: number,
): Promise<void> {
  const line: HandoffLogLine = { kind: "handoff_contract", at, contract };
  await appendHandoffLogLine(logPath, line);
}

function isTxn(value: unknown): value is HandoffApplyTxn {
  if (!value || typeof value !== "object") {
    return false;
  }
  const txn = value as HandoffApplyTxn;
  return (
    txn.version === 1 &&
    typeof txn.handoffId === "string" &&
    typeof txn.taskId === "string" &&
    typeof txn.taskOverlayPath === "string" &&
    isHandoffContract(txn.contract) &&
    Boolean(txn.fact) &&
    txn.fact.kind === "fact" &&
    Boolean(txn.task)
  );
}

async function readTxn(txnPath: string): Promise<HandoffApplyTxn | null> {
  try {
    const raw = await fs.readFile(txnPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isTxn(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function ledgerFileFor(authority: RuntimeAuthority, cfg: OpenBotConfig): string {
  return resolveCollaborationRuntimeFactPaths({
    groupId: authority.groupId,
    tenantId: authority.tenantId,
    tenantTrust: authority.tenantTrust,
    cfg,
  }).ledgerFile;
}

async function ledgerHasFact(ledgerFile: string, factId: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  for (const line of raw.split("\n")) {
    if (!line.includes(factId)) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { kind?: string; factId?: string };
      if (parsed.kind === "fact" && parsed.factId === factId) {
        return true;
      }
    } catch {
      // skip
    }
  }
  return false;
}

function factIdFor(handoffId: string, type: HandoffFactType): string {
  return `fact_${handoffId}_${type}`;
}

function buildFact(params: {
  authority: RuntimeAuthority;
  contract: HandoffContract;
  type: HandoffFactType;
  at: number;
  ownerBefore?: string;
  ownerAfter?: string;
}): CollaborationFactRecord {
  return {
    kind: "fact",
    type: params.type,
    factId: factIdFor(params.contract.handoffId, params.type),
    groupId: params.authority.groupId,
    taskId: params.contract.taskId,
    handoffId: params.contract.handoffId,
    key: params.contract.key,
    at: params.at,
    recordedAtMs: params.at,
    fromAgentId: params.contract.from.agentId,
    toAgentId: params.contract.to.agentId,
    responsibilityRole: params.contract.to.responsibilityRole,
    ...(params.ownerBefore ? { ownerBefore: params.ownerBefore } : {}),
    ...(params.ownerAfter ? { ownerAfter: params.ownerAfter } : {}),
  };
}

async function appendFactOnce(params: {
  fact: CollaborationFactRecord;
  ledgerFile: string;
  cfg: OpenBotConfig;
}): Promise<void> {
  if (await ledgerHasFact(params.ledgerFile, params.fact.factId)) {
    return;
  }
  assertCollaborationRuntimeWritable(params.ledgerFile, params.cfg);
  const written = await appendCollaborationFactRecord({ record: params.fact, cfg: params.cfg });
  if (!written) {
    throw new Error("handoff fact was not written; collaboration.task.handoffContract is off");
  }
}

async function hasFactTypes(params: {
  ledgerFile: string;
  handoffId: string;
  types: readonly HandoffFactType[];
}): Promise<boolean> {
  const needed = new Set(params.types);
  let raw: string;
  try {
    raw = await fs.readFile(params.ledgerFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  for (const line of raw.split("\n")) {
    if (!line.includes(params.handoffId)) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { kind?: string; handoffId?: string; type?: string };
      if (parsed.kind === "fact" && parsed.handoffId === params.handoffId && parsed.type) {
        needed.delete(parsed.type as HandoffFactType);
      }
    } catch {
      // skip
    }
  }
  return needed.size === 0;
}

export {
  appendHandoffHistoryById,
  applyHandoffContractToResponsibility,
  classifyHandoffApplyAgainstLive,
  responsibilityFromHandoffTask,
};

export type HandoffLiveApplyDecision =
  | { kind: "apply"; responsibility: TaskResponsibility }
  | { kind: "idempotent"; responsibility: TaskResponsibility }
  | {
      kind: "already_at_target";
      responsibility: TaskResponsibility;
      detail: string;
    }
  | { kind: "conflict"; detail: string; responsibility: TaskResponsibility };

function withResponsibility(
  task: HandoffTask,
  responsibility: TaskResponsibility,
  at: number,
): HandoffTask {
  return {
    ...task,
    responsibility,
    ownerMemberId: responsibility.owner,
    assignedMemberIds: [...responsibility.executors],
    updatedAtMs: at,
  };
}

function overlayPathInside(handoffsDir: string, overlayPath: string, taskId: string): string {
  const expected = handoffTaskOverlayPath(handoffsDir, taskId);
  const relative = path.relative(handoffsDir, overlayPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return expected;
  }
  return overlayPath;
}

async function appendAppliedIfNeeded(params: {
  logPath: string;
  contract: HandoffContract;
  at: number;
}): Promise<void> {
  const lines = await readLog(params.logPath);
  const current = latestContract(lines, params.contract.handoffId);
  if (current?.status === "applied") {
    return;
  }
  await appendContract(params.logPath, params.contract, params.at);
}

async function finishHandoffApply(params: {
  handoffsDir: string;
  txnPath: string;
  txn: HandoffApplyTxn;
  ledgerFile: string;
  logPath: string;
  cfg: OpenBotConfig;
  hooks?: HandoffContractOptions["hooks"];
}): Promise<void> {
  const overlayPath = overlayPathInside(
    params.handoffsDir,
    params.txn.taskOverlayPath,
    params.txn.taskId,
  );
  await appendFactOnce({ fact: params.txn.fact, ledgerFile: params.ledgerFile, cfg: params.cfg });
  params.hooks?.afterFactBeforeTask?.();
  assertCollaborationRuntimeWritable(overlayPath, params.cfg);
  await writeHandoffJson(overlayPath, params.txn.task);
  await appendAppliedIfNeeded({
    logPath: params.logPath,
    contract: params.txn.contract,
    at: params.txn.contract.appliedAt ?? params.txn.fact.at,
  });
  try {
    await fs.unlink(params.txnPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

async function rollForwardTask(params: {
  handoffsDir: string;
  taskId: string;
  ledgerFile: string;
  cfg: OpenBotConfig;
}): Promise<HandoffApplyTxn | null> {
  const stem = safeStem(params.taskId);
  if (!stem) {
    return null;
  }
  const txnPath = handoffTxnPath(params.handoffsDir, params.taskId);
  const txn = await readTxn(txnPath);
  if (!txn || txn.taskId !== params.taskId) {
    return null;
  }
  await finishHandoffApply({
    handoffsDir: params.handoffsDir,
    txnPath,
    txn,
    ledgerFile: params.ledgerFile,
    logPath: handoffLogPath(params.handoffsDir, params.taskId),
    cfg: params.cfg,
  });
  return txn;
}

export async function recoverPendingHandoffTxns(params: {
  authority: RuntimeAuthority;
  cfg?: OpenBotConfig;
}): Promise<{ rolledForward: string[] }> {
  const cfg = params.cfg;
  if (!cfg || !isCollabTaskHandoffContractEnabled(cfg)) {
    return { rolledForward: [] };
  }
  const handoffsDir = params.authority.namespace.handoffsDir;
  let names: string[];
  try {
    names = await fs.readdir(handoffsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { rolledForward: [] };
    }
    throw error;
  }
  const ledgerFile = ledgerFileFor(params.authority, cfg);
  const rolledForward: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".txn")) {
      continue;
    }
    const txn = await readTxn(path.join(handoffsDir, name));
    if (!txn) {
      continue;
    }
    const stem = safeStem(txn.taskId);
    if (!stem) {
      continue;
    }
    await withHandoffRoundLock(handoffsDir, stem, async () => {
      const done = await rollForwardTask({
        handoffsDir,
        taskId: txn.taskId,
        ledgerFile,
        cfg,
      });
      if (done) {
        rolledForward.push(done.handoffId);
      }
    });
  }
  return { rolledForward };
}

async function requirePersisted(params: {
  logPath: string;
  contract: HandoffContract;
  status: HandoffStatus;
}): Promise<HandoffResult<HandoffContract>> {
  const lines = await readLog(params.logPath);
  const persisted = latestContract(lines, params.contract.handoffId);
  if (!persisted || persisted.taskId !== params.contract.taskId) {
    return fail("handoff_not_found", "handoff contract is not in the task log");
  }
  if (persisted.status !== params.status) {
    return fail(
      "status_mismatch",
      `handoff status is ${persisted.status}; expected ${params.status}`,
    );
  }
  return { ok: true, value: persisted };
}

export async function proposeHandoff(
  authority: RuntimeAuthority,
  input: ProposeHandoffInput,
  options?: HandoffContractOptions,
): Promise<HandoffResult<HandoffContract>> {
  const cfg = options?.cfg;
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    return flagOff();
  }
  if (!cfg) {
    return fail("config_required", "proposeHandoff requires cfg when the flag is read from it");
  }
  const taskId = compact(input.taskId);
  const fromId = compact(input.from?.agentId);
  const toId = compact(input.to?.agentId);
  const remainingWork = compact(input.remainingWork);
  const acceptanceCriteria = uniqueIds(input.acceptanceCriteria);
  if (!safeStem(taskId) || !fromId || !toId) {
    return fail("invalid_handoff", "handoff requires taskId, from, and to");
  }
  if (!isParty(input.from) || !isParty(input.to)) {
    return fail("invalid_handoff", "handoff from and to require a responsibility role");
  }
  if (fromId === toId) {
    return fail("invalid_handoff", "handoff from and to must differ");
  }
  if (!HANDOFF_KINDS.has(input.kind)) {
    return fail("invalid_handoff", "handoff kind is not supported");
  }
  if (input.kind === "owner_transfer" && input.to.responsibilityRole !== "owner") {
    return fail("invalid_handoff", "owner_transfer requires to.responsibilityRole owner");
  }
  if (!remainingWork) {
    return fail("invalid_handoff", "handoff requires remainingWork");
  }
  if (acceptanceCriteria.length === 0) {
    return fail("invalid_handoff", "handoff requires acceptanceCriteria");
  }
  const allowBots = authority.policy.effective.governance.task.allowBotToBotHandoff;
  if (!allowBots && looksLikeBot(fromId) && looksLikeBot(toId)) {
    return fail("bot_to_bot_handoff_disabled", "policy does not allow bot-to-bot handoff");
  }
  const at = nowOf(options);
  // C4: when oguiHandoffProjection is ON, append projected OGUI brief into assumptions.
  // Flag-off / illegal / absent → assumptions unchanged. Never bypasses approvals.
  let assumptions = uniqueIds(input.assumptions);
  try {
    const oguiBrief = await resolveOguiHandoffBriefForPropose({
      authority,
      cfg,
      taskId,
      ...(input.sourceChatText ? { sourceChatText: input.sourceChatText } : {}),
    });
    assumptions = enrichHandoffAssumptionsWithOguiBrief({
      assumptions,
      handoffBrief: oguiBrief,
    });
  } catch {
    // best-effort; propose must not fail closed on projection errors
  }
  const contract: HandoffContract = {
    handoffId: compact(input.handoffId) || `hoff_${randomUUID()}`,
    key: eventKeyOf(authority, input.beatId === undefined ? null : input.beatId),
    taskId,
    kind: input.kind,
    from: { agentId: fromId, responsibilityRole: input.from.responsibilityRole },
    to: { agentId: toId, responsibilityRole: input.to.responsibilityRole },
    completedArtifacts: uniqueIds(input.completedArtifacts),
    remainingWork,
    assumptions,
    blockers: uniqueIds(input.blockers),
    acceptanceCriteria,
    status: "proposed",
    requiresApproval: resolveApproval(
      input.kind,
      input.to.responsibilityRole,
      input.requiresApproval,
    ),
    proposedBy: compact(input.proposedBy) || fromId,
    proposedAt: at,
    ...(typeof input.expiresAt === "number" ? { expiresAt: input.expiresAt } : {}),
    ...(typeof input.baseHistoryLen === "number" ? { baseHistoryLen: input.baseHistoryLen } : {}),
  };
  const handoffsDir = authority.namespace.handoffsDir;
  const stem = safeStem(taskId)!;
  const logPath = handoffLogPath(handoffsDir, taskId);
  assertCollaborationRuntimeWritable(logPath, cfg);
  await withHandoffRoundLock(handoffsDir, stem, async () => {
    await appendContract(logPath, contract, at);
  });
  await recordWakeEventBestEffort(
    authority,
    {
      groupId: authority.groupId,
      fromAgentId: fromId,
      toAgentIds: [toId],
      source: "handoff",
      outcome: "recorded",
      taskId,
      relatedId: contract.handoffId,
    },
    { cfg, nowMs: at },
  );
  return { ok: true, value: contract };
}

export async function acceptHandoff(
  authority: RuntimeAuthority,
  contract: HandoffContract,
  by: GovernanceActor,
  options?: HandoffContractOptions,
): Promise<HandoffResult<HandoffContract>> {
  const cfg = options?.cfg;
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    return flagOff();
  }
  if (!cfg) {
    return fail("config_required", "acceptHandoff requires cfg");
  }
  const byId = compact(by?.id);
  if (!byId) {
    return fail("actor_required", "accept requires an actor id");
  }
  if (byId !== contract.to.agentId && by.type !== "human") {
    return fail("receiver_or_human_required", "accept must be the receiver or a human");
  }
  const handoffsDir = authority.namespace.handoffsDir;
  const stem = safeStem(contract.taskId);
  if (!stem) {
    return fail("invalid_handoff", "handoff taskId is not a safe id");
  }
  const logPath = handoffLogPath(handoffsDir, contract.taskId);
  const ledgerFile = ledgerFileFor(authority, cfg);
  return await withHandoffRoundLock(handoffsDir, stem, async () => {
    const persisted = await requirePersisted({ logPath, contract, status: "proposed" });
    if (!persisted.ok) {
      return persisted;
    }
    const at = nowOf(options);
    const next: HandoffContract = {
      ...persisted.value,
      status: "receiver_accepted",
      acceptedAt: at,
    };
    const fact = buildFact({ authority, contract: next, type: "TaskHandoffReceiverAccepted", at });
    await appendFactOnce({ fact, ledgerFile, cfg });
    assertCollaborationRuntimeWritable(logPath, cfg);
    await appendContract(logPath, next, at);
    return { ok: true, value: next };
  });
}

export async function approveHandoff(
  authority: RuntimeAuthority,
  contract: HandoffContract,
  by: GovernanceActor,
  options?: HandoffContractOptions,
): Promise<HandoffResult<HandoffContract>> {
  const cfg = options?.cfg;
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    return flagOff();
  }
  if (!cfg) {
    return fail("config_required", "approveHandoff requires cfg");
  }
  const byId = compact(by?.id);
  if (!byId) {
    return fail("actor_required", "approve requires an actor id");
  }
  const handoffsDir = authority.namespace.handoffsDir;
  const stem = safeStem(contract.taskId);
  if (!stem) {
    return fail("invalid_handoff", "handoff taskId is not a safe id");
  }
  const logPath = handoffLogPath(handoffsDir, contract.taskId);
  const ledgerFile = ledgerFileFor(authority, cfg);
  return await withHandoffRoundLock(handoffsDir, stem, async () => {
    const persisted = await requirePersisted({
      logPath,
      contract,
      status: "receiver_accepted",
    });
    if (!persisted.ok) {
      return persisted;
    }
    const current = persisted.value;
    const humanRequired =
      current.requiresApproval === "human" ||
      current.to.responsibilityRole === "owner" ||
      current.to.responsibilityRole === "approver" ||
      current.kind === "owner_transfer";
    if (humanRequired && by.type !== "human") {
      return fail("human_approval_required", "owner or approver handoff requires a human approver");
    }
    if (current.requiresApproval !== "none") {
      const gate = evaluateGovernanceGate({
        action: "finalize_decision",
        actor: by,
        effective: authority.policy.effective as EffectiveCollaborationPolicy,
      });
      if (!gate.allowed) {
        return fail(gate.reason, gate.message);
      }
    }
    const at = nowOf(options);
    const next: HandoffContract = { ...current, status: "approved", approvedAt: at };
    const fact = buildFact({ authority, contract: next, type: "TaskHandoffApproved", at });
    await appendFactOnce({ fact, ledgerFile, cfg });
    assertCollaborationRuntimeWritable(logPath, cfg);
    await appendContract(logPath, next, at);
    return { ok: true, value: next };
  });
}

export async function applyApprovedHandoff(
  authority: RuntimeAuthority,
  contract: HandoffContract,
  task: HandoffTask,
  options?: HandoffContractOptions,
): Promise<HandoffResult<{ task: HandoffTask; fact: CollaborationFactRecord }>> {
  const cfg = options?.cfg;
  if (!isCollabTaskHandoffContractEnabled(cfg)) {
    return flagOff();
  }
  if (!cfg) {
    return fail("config_required", "applyApprovedHandoff requires cfg");
  }
  if (task.taskId !== contract.taskId) {
    return fail("task_mismatch", "task id does not match the handoff contract");
  }
  const handoffsDir = authority.namespace.handoffsDir;
  const stem = safeStem(contract.taskId);
  if (!stem) {
    return fail("invalid_handoff", "handoff taskId is not a safe id");
  }
  const logPath = handoffLogPath(handoffsDir, contract.taskId);
  const txnPath = handoffTxnPath(handoffsDir, contract.taskId);
  const ledgerFile = ledgerFileFor(authority, cfg);
  return await withHandoffRoundLock(handoffsDir, stem, async () => {
    const pending = await rollForwardTask({
      handoffsDir,
      taskId: contract.taskId,
      ledgerFile,
      cfg,
    });
    if (pending && pending.handoffId === contract.handoffId) {
      return { ok: true, value: { task: pending.task, fact: pending.fact } };
    }
    const persisted = await requirePersisted({ logPath, contract, status: "approved" });
    if (!persisted.ok) {
      return persisted;
    }
    const eventsReady = await hasFactTypes({
      ledgerFile,
      handoffId: contract.handoffId,
      types: ["TaskHandoffReceiverAccepted", "TaskHandoffApproved"],
    });
    if (!eventsReady) {
      return fail(
        "events_required",
        "responsibility cannot change before receiver-accepted and approved facts",
      );
    }
    const at = nowOf(options);
    const before = responsibilityFromHandoffTask(task);
    const responsibility = applyHandoffContractToResponsibility(before, persisted.value);
    const nextTask = withResponsibility(task, responsibility, at);
    const applied: HandoffContract = { ...persisted.value, status: "applied", appliedAt: at };
    const fact = buildFact({
      authority,
      contract: applied,
      type: "TaskResponsibilityChanged",
      at,
      ownerBefore: before.owner,
      ownerAfter: responsibility.owner,
    });
    const overlayPath = handoffTaskOverlayPath(handoffsDir, contract.taskId);
    const txn: HandoffApplyTxn = {
      version: 1,
      handoffId: applied.handoffId,
      taskId: applied.taskId,
      fact,
      task: nextTask,
      contract: applied,
      taskOverlayPath: overlayPath,
    };
    assertCollaborationRuntimeWritable(txnPath, cfg);
    await writeHandoffJson(txnPath, txn);
    await finishHandoffApply({
      handoffsDir,
      txnPath,
      txn,
      ledgerFile,
      logPath,
      cfg,
      hooks: options?.hooks,
    });
    return { ok: true, value: { task: nextTask, fact } };
  });
}
