import fs from "node:fs/promises";
import path from "node:path";
import {
  applyHandoffContractToResponsibility,
  evaluateGovernanceGate,
  responsibilityFromHandoffTask,
  type CollaborationGovernanceView,
  type GovernanceActor,
  type HandoffResponsibilityRole,
  type TaskResponsibility,
} from "../../policy/index.js";
import {
  appendJsonlDurable,
  withDirectoryLock,
  writeJsonDurable,
} from "../repository/durable-json.js";

/**
 * Handoff accept / approve / apply transaction.
 * The host supplies identity, paths, and a ledger port. This module owns the lock,
 * status re-read, fact order, and crash recovery. It does not take a host callback
 * that decides the writes.
 */

const HANDOFF_KINDS = new Set(["continue", "review", "owner_transfer", "evidence"]);
const HANDOFF_STATUSES = new Set([
  "proposed",
  "receiver_accepted",
  "approved",
  "applied",
  "completed",
  "rejected",
  "expired",
  "cancelled",
]);
function isResponsibilityRole(value: unknown): value is HandoffResponsibilityRole {
  return (
    value === "owner" ||
    value === "executor" ||
    value === "reviewer" ||
    value === "approver" ||
    value === "contributor"
  );
}

export type HandoffTxnParty = {
  agentId: string;
  responsibilityRole: HandoffResponsibilityRole;
};

export type HandoffTxnContract = {
  handoffId: string;
  taskId: string;
  kind: "continue" | "review" | "owner_transfer" | "evidence";
  status:
    | "proposed"
    | "receiver_accepted"
    | "approved"
    | "applied"
    | "completed"
    | "rejected"
    | "expired"
    | "cancelled";
  from: HandoffTxnParty;
  to: HandoffTxnParty;
  key: {
    tenantId: string | null;
    groupId: string;
    episodeId: string;
    beatId: string | null;
    policySnapshotId: string;
    policyHash: string;
    compilerRevision: string;
  };
  requiresApproval: "none" | "human" | "governance";
  acceptedAt?: number;
  approvedAt?: number;
  appliedAt?: number;
};

export type HandoffTxnTask = {
  taskId: string;
  ownerMemberId?: string | null;
  assignedMemberIds?: string[];
  responsibility?: TaskResponsibility;
  updatedAtMs?: number;
};

export type HandoffStoredFact = {
  kind: "fact";
  type: "TaskHandoffReceiverAccepted" | "TaskHandoffApproved" | "TaskResponsibilityChanged";
  factId: string;
  groupId: string;
  taskId: string;
  handoffId: string;
  key: HandoffTxnContract["key"];
  at: number;
  recordedAtMs: number;
  fromAgentId: string;
  toAgentId: string;
  responsibilityRole: string;
  ownerBefore?: string;
  ownerAfter?: string;
};

export type HandoffTxnResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string; message: string };

/** Ledger IO. The transaction decides when each call happens. */
export type HandoffLedgerPort = {
  readText: (filePath: string) => Promise<string | null>;
  appendFact: (fact: HandoffStoredFact) => Promise<void>;
  assertWritable: (filePath: string) => void;
};

type HandoffLogLine<T> = { kind: "handoff_contract"; at: number; contract: T };

type HandoffApplyTxn<TContract, TTask> = {
  version: 1;
  handoffId: string;
  taskId: string;
  fact: HandoffStoredFact;
  task: TTask;
  contract: TContract;
  taskOverlayPath: string;
};

function fail(reason: string, message: string): HandoffTxnResult<never> {
  return { ok: false, reason, message };
}

function isParty(value: unknown): value is HandoffTxnParty {
  if (!value || typeof value !== "object") {
    return false;
  }
  const party = value as { agentId?: unknown; responsibilityRole?: unknown };
  return (
    typeof party.agentId === "string" &&
    party.agentId.trim().length > 0 &&
    isResponsibilityRole(party.responsibilityRole)
  );
}

function isHandoffContract(value: unknown): value is HandoffTxnContract {
  if (!value || typeof value !== "object") {
    return false;
  }
  const contract = value as HandoffTxnContract;
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

async function readLog<T extends HandoffTxnContract>(
  logPath: string,
): Promise<Array<HandoffLogLine<T>>> {
  let raw: string;
  try {
    raw = await fs.readFile(logPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines: Array<HandoffLogLine<T>> = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as HandoffLogLine<T>;
      if (parsed?.kind === "handoff_contract" && isHandoffContract(parsed.contract)) {
        lines.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return lines;
}

function latestContract<T extends HandoffTxnContract>(
  lines: readonly HandoffLogLine<T>[],
  handoffId: string,
): T | null {
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const contract = lines[i]?.contract;
    if (contract?.handoffId === handoffId) {
      return contract;
    }
  }
  return null;
}

async function appendContract<T extends HandoffTxnContract>(
  logPath: string,
  contract: T,
  at: number,
): Promise<void> {
  await appendJsonlDurable(logPath, { kind: "handoff_contract", at, contract });
}

function factIdFor(handoffId: string, type: HandoffStoredFact["type"]): string {
  return `fact_${handoffId}_${type}`;
}

function buildFact<T extends HandoffTxnContract>(params: {
  groupId: string;
  contract: T;
  type: HandoffStoredFact["type"];
  at: number;
  ownerBefore?: string;
  ownerAfter?: string;
}): HandoffStoredFact {
  return {
    kind: "fact",
    type: params.type,
    factId: factIdFor(params.contract.handoffId, params.type),
    groupId: params.groupId,
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

async function ledgerHasFact(
  storage: HandoffLedgerPort,
  ledgerFile: string,
  factId: string,
): Promise<boolean> {
  const raw = await storage.readText(ledgerFile);
  if (raw == null) {
    return false;
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

async function appendFactOnce(params: {
  storage: HandoffLedgerPort;
  ledgerFile: string;
  fact: HandoffStoredFact;
}): Promise<void> {
  if (await ledgerHasFact(params.storage, params.ledgerFile, params.fact.factId)) {
    return;
  }
  params.storage.assertWritable(params.ledgerFile);
  await params.storage.appendFact(params.fact);
}

async function hasFactTypes(params: {
  storage: HandoffLedgerPort;
  ledgerFile: string;
  handoffId: string;
  types: readonly HandoffStoredFact["type"][];
}): Promise<boolean> {
  const needed = new Set<string>(params.types);
  const raw = await params.storage.readText(params.ledgerFile);
  if (raw == null) {
    return false;
  }
  for (const line of raw.split("\n")) {
    if (!line.includes(params.handoffId)) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { kind?: string; handoffId?: string; type?: string };
      if (parsed.kind === "fact" && parsed.handoffId === params.handoffId && parsed.type) {
        needed.delete(parsed.type);
      }
    } catch {
      // skip
    }
  }
  return needed.size === 0;
}

function isTxn<TContract extends HandoffTxnContract, TTask>(
  value: unknown,
): value is HandoffApplyTxn<TContract, TTask> {
  if (!value || typeof value !== "object") {
    return false;
  }
  const txn = value as HandoffApplyTxn<TContract, TTask>;
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

async function readTxn<TContract extends HandoffTxnContract, TTask>(
  txnPath: string,
): Promise<HandoffApplyTxn<TContract, TTask> | null> {
  try {
    const raw = await fs.readFile(txnPath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return isTxn<TContract, TTask>(parsed) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function overlayPathInside(handoffsDir: string, overlayPath: string, taskId: string): string {
  const expected = path.join(handoffsDir, `${encodeURIComponent(taskId.trim())}.task.json`);
  const relative = path.relative(handoffsDir, overlayPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return expected;
  }
  return overlayPath;
}

async function appendAppliedIfNeeded<T extends HandoffTxnContract>(params: {
  logPath: string;
  contract: T;
  at: number;
}): Promise<void> {
  const lines = await readLog<T>(params.logPath);
  const current = latestContract(lines, params.contract.handoffId);
  if (current?.status === "applied") {
    return;
  }
  await appendContract(params.logPath, params.contract, params.at);
}

async function finishHandoffApply<TContract extends HandoffTxnContract, TTask>(params: {
  handoffsDir: string;
  txnPath: string;
  txn: HandoffApplyTxn<TContract, TTask>;
  ledgerFile: string;
  logPath: string;
  storage: HandoffLedgerPort;
  afterFactBeforeTask?: () => void;
}): Promise<void> {
  const overlayPath = overlayPathInside(
    params.handoffsDir,
    params.txn.taskOverlayPath,
    params.txn.taskId,
  );
  await appendFactOnce({
    storage: params.storage,
    ledgerFile: params.ledgerFile,
    fact: params.txn.fact,
  });
  params.afterFactBeforeTask?.();
  params.storage.assertWritable(overlayPath);
  await writeJsonDurable(overlayPath, params.txn.task);
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

async function rollForwardTask<TContract extends HandoffTxnContract, TTask>(params: {
  handoffsDir: string;
  taskId: string;
  txnPath: string;
  ledgerFile: string;
  logPath: string;
  storage: HandoffLedgerPort;
}): Promise<HandoffApplyTxn<TContract, TTask> | null> {
  const txn = await readTxn<TContract, TTask>(params.txnPath);
  if (!txn || txn.taskId !== params.taskId) {
    return null;
  }
  await finishHandoffApply({ ...params, txn });
  return txn;
}

async function requirePersisted<T extends HandoffTxnContract>(params: {
  logPath: string;
  contract: T;
  status: T["status"];
}): Promise<HandoffTxnResult<T>> {
  const lines = await readLog<T>(params.logPath);
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

export async function commitProposedHandoff<T extends HandoffTxnContract>(params: {
  handoffsDir: string;
  stem: string;
  logPath: string;
  at: number;
  contract: T;
  storage: HandoffLedgerPort;
}): Promise<void> {
  params.storage.assertWritable(params.logPath);
  await withDirectoryLock(params.handoffsDir, params.stem, async () => {
    await appendContract(params.logPath, params.contract, params.at);
  });
}

export async function acceptHandoffTransaction<T extends HandoffTxnContract>(params: {
  handoffsDir: string;
  stem: string;
  logPath: string;
  ledgerFile: string;
  groupId: string;
  at: number;
  contract: T;
  storage: HandoffLedgerPort;
}): Promise<HandoffTxnResult<T>> {
  return withDirectoryLock(params.handoffsDir, params.stem, async () => {
    const persisted = await requirePersisted({
      logPath: params.logPath,
      contract: params.contract,
      status: "proposed",
    });
    if (!persisted.ok) {
      return persisted;
    }
    const next = {
      ...persisted.value,
      status: "receiver_accepted" as const,
      acceptedAt: params.at,
    };
    const fact = buildFact({
      groupId: params.groupId,
      contract: next,
      type: "TaskHandoffReceiverAccepted",
      at: params.at,
    });
    await appendFactOnce({ storage: params.storage, ledgerFile: params.ledgerFile, fact });
    params.storage.assertWritable(params.logPath);
    await appendContract(params.logPath, next, params.at);
    return { ok: true as const, value: next };
  });
}

export async function approveHandoffTransaction<T extends HandoffTxnContract>(params: {
  handoffsDir: string;
  stem: string;
  logPath: string;
  ledgerFile: string;
  groupId: string;
  at: number;
  contract: T;
  actor: GovernanceActor;
  effective: CollaborationGovernanceView;
  storage: HandoffLedgerPort;
}): Promise<HandoffTxnResult<T>> {
  return withDirectoryLock(params.handoffsDir, params.stem, async () => {
    const persisted = await requirePersisted({
      logPath: params.logPath,
      contract: params.contract,
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
    if (humanRequired && params.actor.type !== "human") {
      return fail("human_approval_required", "owner or approver handoff requires a human approver");
    }
    if (current.requiresApproval !== "none") {
      const gate = evaluateGovernanceGate({
        action: "finalize_decision",
        actor: params.actor,
        effective: params.effective,
      });
      if (!gate.allowed) {
        return fail(gate.reason, gate.message);
      }
    }
    const next = { ...current, status: "approved" as const, approvedAt: params.at };
    const fact = buildFact({
      groupId: params.groupId,
      contract: next,
      type: "TaskHandoffApproved",
      at: params.at,
    });
    await appendFactOnce({ storage: params.storage, ledgerFile: params.ledgerFile, fact });
    params.storage.assertWritable(params.logPath);
    await appendContract(params.logPath, next, params.at);
    return { ok: true as const, value: next };
  });
}

function withResponsibility<TTask extends HandoffTxnTask>(
  task: TTask,
  responsibility: TaskResponsibility,
  at: number,
): TTask {
  return {
    ...task,
    responsibility,
    ownerMemberId: responsibility.owner,
    assignedMemberIds: [...responsibility.executors],
    updatedAtMs: at,
  };
}

export async function applyApprovedHandoffTransaction<
  TContract extends HandoffTxnContract,
  TTask extends HandoffTxnTask,
>(params: {
  handoffsDir: string;
  stem: string;
  logPath: string;
  txnPath: string;
  ledgerFile: string;
  groupId: string;
  at: number;
  contract: TContract;
  task: TTask;
  storage: HandoffLedgerPort;
  /** Crash probe between the durable fact and the task overlay. Does not choose writes. */
  afterFactBeforeTask?: () => void;
}): Promise<HandoffTxnResult<{ task: TTask; fact: HandoffStoredFact }>> {
  return withDirectoryLock(params.handoffsDir, params.stem, async () => {
    const pending = await rollForwardTask<TContract, TTask>({
      handoffsDir: params.handoffsDir,
      taskId: params.contract.taskId,
      txnPath: params.txnPath,
      ledgerFile: params.ledgerFile,
      logPath: params.logPath,
      storage: params.storage,
    });
    if (pending && pending.handoffId === params.contract.handoffId) {
      return { ok: true, value: { task: pending.task, fact: pending.fact } };
    }
    const persisted = await requirePersisted({
      logPath: params.logPath,
      contract: params.contract,
      status: "approved",
    });
    if (!persisted.ok) {
      return persisted;
    }
    const eventsReady = await hasFactTypes({
      storage: params.storage,
      ledgerFile: params.ledgerFile,
      handoffId: params.contract.handoffId,
      types: ["TaskHandoffReceiverAccepted", "TaskHandoffApproved"],
    });
    if (!eventsReady) {
      return fail(
        "events_required",
        "responsibility cannot change before receiver-accepted and approved facts",
      );
    }
    const before = responsibilityFromHandoffTask(params.task);
    const responsibility = applyHandoffContractToResponsibility(before, persisted.value);
    const nextTask = withResponsibility(params.task, responsibility, params.at);
    const applied = { ...persisted.value, status: "applied" as const, appliedAt: params.at };
    const fact = buildFact({
      groupId: params.groupId,
      contract: applied,
      type: "TaskResponsibilityChanged",
      at: params.at,
      ownerBefore: before.owner,
      ownerAfter: responsibility.owner,
    });
    const txn: HandoffApplyTxn<TContract, TTask> = {
      version: 1,
      handoffId: applied.handoffId,
      taskId: applied.taskId,
      fact,
      task: nextTask,
      contract: applied,
      taskOverlayPath: path.join(
        params.handoffsDir,
        `${encodeURIComponent(params.contract.taskId.trim())}.task.json`,
      ),
    };
    params.storage.assertWritable(params.txnPath);
    await writeJsonDurable(params.txnPath, txn);
    await finishHandoffApply({
      handoffsDir: params.handoffsDir,
      txnPath: params.txnPath,
      txn,
      ledgerFile: params.ledgerFile,
      logPath: params.logPath,
      storage: params.storage,
      afterFactBeforeTask: params.afterFactBeforeTask,
    });
    return { ok: true, value: { task: nextTask, fact } };
  });
}

export async function recoverHandoffTransactions(params: {
  handoffsDir: string;
  ledgerFile: string;
  storage: HandoffLedgerPort;
}): Promise<{ rolledForward: string[] }> {
  let names: string[];
  try {
    names = await fs.readdir(params.handoffsDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { rolledForward: [] };
    }
    throw error;
  }
  const rolledForward: string[] = [];
  for (const name of names) {
    if (!name.endsWith(".txn")) {
      continue;
    }
    const txnPath = path.join(params.handoffsDir, name);
    const txn = await readTxn<HandoffTxnContract, HandoffTxnTask>(txnPath);
    if (!txn) {
      continue;
    }
    const stem = txn.taskId.trim();
    if (!stem || stem.includes("/") || stem.includes("\\") || stem.includes("..")) {
      continue;
    }
    const encoded = encodeURIComponent(stem);
    await withDirectoryLock(params.handoffsDir, encoded, async () => {
      const done = await rollForwardTask({
        handoffsDir: params.handoffsDir,
        taskId: txn.taskId,
        txnPath: path.join(params.handoffsDir, `${encoded}.txn`),
        ledgerFile: params.ledgerFile,
        logPath: path.join(params.handoffsDir, `${encoded}.jsonl`),
        storage: params.storage,
      });
      if (done) {
        rolledForward.push(done.handoffId);
      }
    });
  }
  return { rolledForward };
}
