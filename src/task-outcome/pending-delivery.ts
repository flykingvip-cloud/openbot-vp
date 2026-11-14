/**
 * Side channel: prepare (agent-runner) registers awaiting delivery; dispatch
 * confirms after the channel send succeeds or fails.
 *
 * R85d: registrations are durable under the TaskOutcome store so a process
 * restart (or a confirm call missing runId) can still resolve taskId/deliveryId.
 */
import fs from "node:fs";
import path from "node:path";
import type { TaskCompletionBinding } from "../agent-runtime/contracts/task-binding.js";

export type PendingVisiblePayload = {
  text?: string;
  mediaUrl?: string;
  mediaUrls?: string[];
  replyToId?: string;
  audioAsVoice?: boolean;
  isError?: boolean;
  channelData?: Record<string, unknown>;
};

export type PendingVisibleTarget = {
  channel: string;
  to: string;
  accountId?: string;
  threadId?: string | number | null;
  replyToId?: string | null;
};

/** not_attempted: persist intent before handoff; only this may be auto-sent on recovery. */
export type AwaitingDeliverySendDisposition = "not_attempted" | "handed_off" | "unknown";

export type AwaitingDeliveryRegistration = {
  taskId: string;
  deliveryId: string;
  agentId: string;
  runId: string;
  registeredAtMs: number;
  checkedTask?: { sessionFile: string; binding: TaskCompletionBinding };
  payloads?: PendingVisiblePayload[];
  target?: PendingVisibleTarget;
  sendDisposition?: AwaitingDeliverySendDisposition;
};

const byRunId = new Map<string, AwaitingDeliveryRegistration>();
const byDeliveryId = new Map<string, AwaitingDeliveryRegistration>();
const byTaskId = new Map<string, AwaitingDeliveryRegistration>();

const PENDING_DIRNAME = "pending-deliveries";

/** Unknown deliveries stay until a real receipt. This age is observability only. */
export const AWAITING_DELIVERY_STALE_AFTER_MS = 30 * 60 * 1000;

/** Pending rows older than maxAgeMs. Does not delete or mark them delivered. */
export function listStaleAwaitingDeliveries(
  nowMs: number = Date.now(),
  maxAgeMs: number = AWAITING_DELIVERY_STALE_AFTER_MS,
): AwaitingDeliveryRegistration[] {
  const stale: AwaitingDeliveryRegistration[] = [];
  for (const reg of byRunId.values()) {
    if (nowMs - reg.registeredAtMs >= maxAgeMs) {
      stale.push(reg);
    }
  }
  return stale;
}

function pendingDir(persistRoot: string): string {
  return path.join(persistRoot, PENDING_DIRNAME);
}

function fileForRun(persistRoot: string, runId: string): string {
  return path.join(pendingDir(persistRoot), `${encodeURIComponent(runId)}.json`);
}

function intentFileForRun(persistRoot: string, runId: string): string {
  return path.join(pendingDir(persistRoot), `${encodeURIComponent(runId)}.intent`);
}

function sanitizePendingVisiblePayloads(
  payloads: readonly PendingVisiblePayload[] | undefined,
): PendingVisiblePayload[] | undefined {
  if (!payloads?.length) {
    return undefined;
  }
  const out: PendingVisiblePayload[] = [];
  for (const payload of payloads) {
    if (!payload || typeof payload !== "object") {
      continue;
    }
    const next: PendingVisiblePayload = {};
    if (typeof payload.text === "string") {
      next.text = payload.text;
    }
    if (typeof payload.mediaUrl === "string" && payload.mediaUrl.trim()) {
      next.mediaUrl = payload.mediaUrl;
    }
    if (Array.isArray(payload.mediaUrls) && payload.mediaUrls.length > 0) {
      next.mediaUrls = payload.mediaUrls.filter((u) => typeof u === "string" && u.trim());
    }
    if (typeof payload.replyToId === "string") {
      next.replyToId = payload.replyToId;
    }
    if (payload.audioAsVoice === true) {
      next.audioAsVoice = true;
    }
    if (payload.isError === true) {
      next.isError = true;
    }
    if (payload.channelData && typeof payload.channelData === "object") {
      next.channelData = { ...payload.channelData };
    }
    if (next.text || next.mediaUrl || (next.mediaUrls && next.mediaUrls.length > 0)) {
      out.push(next);
    }
  }
  return out.length > 0 ? out : undefined;
}

function sanitizePendingVisibleTarget(
  target: PendingVisibleTarget | undefined,
): PendingVisibleTarget | undefined {
  const channel = target?.channel?.trim();
  const to = target?.to?.trim();
  if (!channel || channel === "none" || !to) {
    return undefined;
  }
  const accountId = target?.accountId?.trim();
  const replyToId =
    typeof target?.replyToId === "string"
      ? target.replyToId
      : target?.replyToId === null
        ? null
        : undefined;
  const threadId = target?.threadId;
  return {
    channel,
    to,
    ...(accountId ? { accountId } : {}),
    ...(threadId !== undefined ? { threadId } : {}),
    ...(replyToId !== undefined ? { replyToId } : {}),
  };
}

function sanitizeSendDisposition(value: unknown): AwaitingDeliverySendDisposition | undefined {
  return value === "not_attempted" || value === "handed_off" || value === "unknown"
    ? value
    : undefined;
}

function optionalDeliveryMaterials(raw: {
  checkedTask?: AwaitingDeliveryRegistration["checkedTask"];
  payloads?: PendingVisiblePayload[];
  target?: PendingVisibleTarget;
  sendDisposition?: AwaitingDeliverySendDisposition;
}): Pick<AwaitingDeliveryRegistration, "checkedTask" | "payloads" | "target" | "sendDisposition"> {
  const payloads = sanitizePendingVisiblePayloads(raw.payloads);
  const target = sanitizePendingVisibleTarget(raw.target);
  const sendDisposition = sanitizeSendDisposition(raw.sendDisposition);
  return {
    ...(raw.checkedTask &&
    typeof raw.checkedTask.sessionFile === "string" &&
    typeof raw.checkedTask.binding?.taskId === "string" &&
    typeof raw.checkedTask.binding.executionAttempt === "string" &&
    typeof raw.checkedTask.binding.deliverableVersion === "string"
      ? { checkedTask: raw.checkedTask }
      : {}),
    ...(payloads ? { payloads } : {}),
    ...(target ? { target } : {}),
    ...(sendDisposition ? { sendDisposition } : {}),
  };
}

function writeRegistrationFile(filePath: string, reg: AwaitingDeliveryRegistration): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

function writeDurable(persistRoot: string, reg: AwaitingDeliveryRegistration): void {
  writeRegistrationFile(fileForRun(persistRoot, reg.runId), reg);
}

function removeDurable(persistRoot: string, runId: string): void {
  try {
    fs.unlinkSync(fileForRun(persistRoot, runId));
  } catch {
    // ignore missing
  }
}

function readDurableFile(filePath: string): AwaitingDeliveryRegistration | undefined {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as AwaitingDeliveryRegistration;
    if (
      typeof raw?.runId === "string" &&
      typeof raw?.taskId === "string" &&
      typeof raw?.deliveryId === "string" &&
      typeof raw?.agentId === "string"
    ) {
      return {
        taskId: raw.taskId,
        deliveryId: raw.deliveryId,
        agentId: raw.agentId,
        runId: raw.runId,
        ...optionalDeliveryMaterials(raw),
        registeredAtMs:
          typeof raw.registeredAtMs === "number" && Number.isFinite(raw.registeredAtMs)
            ? raw.registeredAtMs
            : Date.now(),
      };
    }
  } catch {
    // ignore
  }
  return undefined;
}

function indexMemory(reg: AwaitingDeliveryRegistration): void {
  byRunId.set(reg.runId, reg);
  byDeliveryId.set(reg.deliveryId, reg);
  byTaskId.set(reg.taskId, reg);
}

function unindexMemory(reg: AwaitingDeliveryRegistration): void {
  if (byRunId.get(reg.runId) === reg || byRunId.get(reg.runId)?.deliveryId === reg.deliveryId) {
    byRunId.delete(reg.runId);
  }
  if (byDeliveryId.get(reg.deliveryId)?.runId === reg.runId) {
    byDeliveryId.delete(reg.deliveryId);
  }
  if (byTaskId.get(reg.taskId)?.runId === reg.runId) {
    byTaskId.delete(reg.taskId);
  }
}

/**
 * Load durable pending deliveries into memory (gateway boot / tests).
 * Returns how many registrations were (re)hydrated.
 */
export function hydrateAwaitingDeliveriesFromDisk(persistRoot: string): number {
  const root = persistRoot.trim();
  if (!root) {
    return 0;
  }
  const dir = pendingDir(root);
  if (!fs.existsSync(dir)) {
    return 0;
  }
  let n = 0;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const reg = readDurableFile(path.join(dir, name));
    if (!reg) {
      continue;
    }
    indexMemory(reg);
    n += 1;
  }
  return n;
}

/**
 * Persist identity, binding, payload and target before commit/register.
 * This is not a confirmable registration: peek/hydrate ignore `.intent` files.
 */
export function persistAwaitingDeliveryIntent(
  reg: Omit<AwaitingDeliveryRegistration, "registeredAtMs"> & { persistRoot: string },
): void {
  const runId = reg.runId.trim();
  const taskId = reg.taskId.trim();
  const deliveryId = reg.deliveryId.trim();
  const agentId = reg.agentId.trim();
  const persistRoot = reg.persistRoot.trim();
  if (!runId || !taskId || !deliveryId || !agentId || !persistRoot) {
    return;
  }
  const full: AwaitingDeliveryRegistration = {
    taskId,
    deliveryId,
    agentId,
    runId,
    registeredAtMs: Date.now(),
    ...optionalDeliveryMaterials({
      ...reg,
      sendDisposition: reg.sendDisposition ?? "not_attempted",
    }),
  };
  writeRegistrationFile(intentFileForRun(persistRoot, runId), full);
}

export function listPendingDeliveryIntents(persistRoot: string): AwaitingDeliveryRegistration[] {
  const root = persistRoot.trim();
  if (!root) {
    return [];
  }
  const dir = pendingDir(root);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AwaitingDeliveryRegistration[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".intent")) {
      continue;
    }
    const reg = readDurableFile(path.join(dir, name));
    if (reg) {
      out.push(reg);
    }
  }
  return out;
}

export function clearPendingDeliveryIntent(persistRoot: string, runId: string): void {
  const root = persistRoot.trim();
  const id = runId.trim();
  if (!root || !id) {
    return;
  }
  try {
    fs.unlinkSync(intentFileForRun(root, id));
  } catch {
    // ignore missing
  }
}

export function listDurableAwaitingDeliveries(persistRoot: string): AwaitingDeliveryRegistration[] {
  const root = persistRoot.trim();
  if (!root) {
    return [];
  }
  const dir = pendingDir(root);
  if (!fs.existsSync(dir)) {
    return [];
  }
  const out: AwaitingDeliveryRegistration[] = [];
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const reg = readDurableFile(path.join(dir, name));
    if (reg) {
      out.push(reg);
    }
  }
  return out;
}

export function markAwaitingDeliverySendDisposition(
  lookup: AwaitingDeliveryLookup & { persistRoot?: string },
  disposition: AwaitingDeliverySendDisposition,
): AwaitingDeliveryRegistration | undefined {
  const got = peekAwaitingDelivery(lookup);
  if (!got) {
    return undefined;
  }
  const next: AwaitingDeliveryRegistration = { ...got, sendDisposition: disposition };
  indexMemory(next);
  const persistRoot = lookup.persistRoot?.trim();
  if (persistRoot) {
    writeDurable(persistRoot, next);
  }
  return next;
}

export function registerAwaitingDelivery(
  reg: Omit<AwaitingDeliveryRegistration, "registeredAtMs"> & {
    /** TaskOutcome store root — when set, intent survives process restart. */
    persistRoot?: string;
  },
): void {
  const runId = reg.runId.trim();
  const taskId = reg.taskId.trim();
  const deliveryId = reg.deliveryId.trim();
  const agentId = reg.agentId.trim();
  if (!runId || !taskId || !deliveryId || !agentId) {
    return;
  }
  const full: AwaitingDeliveryRegistration = {
    taskId,
    deliveryId,
    agentId,
    runId,
    registeredAtMs: Date.now(),
    ...optionalDeliveryMaterials(reg),
  };
  indexMemory(full);
  const persistRoot = reg.persistRoot?.trim();
  if (persistRoot) {
    writeDurable(persistRoot, full);
    clearPendingDeliveryIntent(persistRoot, full.runId);
  }
}

export type AwaitingDeliveryLookup = {
  runId?: string;
  deliveryId?: string;
  taskId?: string;
  /** When memory miss, read durable files under this TaskOutcome store root. */
  persistRoot?: string;
};

function fromDisk(lookup: AwaitingDeliveryLookup): AwaitingDeliveryRegistration | undefined {
  const persistRoot = lookup.persistRoot?.trim();
  if (!persistRoot) {
    return undefined;
  }
  const runId = lookup.runId?.trim();
  if (runId) {
    const hit = readDurableFile(fileForRun(persistRoot, runId));
    if (hit) {
      return hit;
    }
  }
  const dir = pendingDir(persistRoot);
  if (!fs.existsSync(dir)) {
    return undefined;
  }
  const deliveryId = lookup.deliveryId?.trim();
  const taskId = lookup.taskId?.trim();
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) {
      continue;
    }
    const reg = readDurableFile(path.join(dir, name));
    if (!reg) {
      continue;
    }
    if (deliveryId && reg.deliveryId === deliveryId) {
      return reg;
    }
    if (taskId && reg.taskId === taskId) {
      return reg;
    }
  }
  return undefined;
}

/** Peek without removing — memory first, then durable disk. */
export function peekAwaitingDelivery(
  runIdOrLookup: string | AwaitingDeliveryLookup,
): AwaitingDeliveryRegistration | undefined {
  if (typeof runIdOrLookup === "string") {
    const id = runIdOrLookup.trim();
    if (!id) {
      return undefined;
    }
    return byRunId.get(id) ?? fromDisk({ runId: id });
  }
  const runId = runIdOrLookup.runId?.trim();
  const deliveryId = runIdOrLookup.deliveryId?.trim();
  const taskId = runIdOrLookup.taskId?.trim();
  if (runId) {
    const mem = byRunId.get(runId);
    if (mem) {
      return mem;
    }
  }
  if (deliveryId) {
    const mem = byDeliveryId.get(deliveryId);
    if (mem) {
      return mem;
    }
  }
  if (taskId) {
    const mem = byTaskId.get(taskId);
    if (mem) {
      return mem;
    }
  }
  return fromDisk(runIdOrLookup);
}

/** Take (remove) registration after terminal confirm, or when abandoning. */
export function takeAwaitingDelivery(
  runIdOrLookup: string | AwaitingDeliveryLookup,
): AwaitingDeliveryRegistration | undefined {
  const got = peekAwaitingDelivery(runIdOrLookup);
  if (!got) {
    return undefined;
  }
  unindexMemory(got);
  const persistRoot =
    typeof runIdOrLookup === "string" ? undefined : runIdOrLookup.persistRoot?.trim();
  if (persistRoot) {
    removeDurable(persistRoot, got.runId);
  } else {
    // Best-effort: if caller omitted persistRoot but file exists under a known path,
    // memory-only take still clears indexes; durable cleanup happens when persistRoot known.
  }
  // When lookup carried persistRoot we already removed; also try common case via re-read keys.
  if (typeof runIdOrLookup !== "string" && runIdOrLookup.persistRoot?.trim()) {
    removeDurable(runIdOrLookup.persistRoot.trim(), got.runId);
  }
  return got;
}

/**
 * Resolve + remove using runId and/or deliveryId/taskId.
 * Prefer this from dispatch when replyOptions.runId may be missing after restart.
 */
export function resolveAndTakeAwaitingDelivery(
  lookup: AwaitingDeliveryLookup,
): AwaitingDeliveryRegistration | undefined {
  const got = peekAwaitingDelivery(lookup);
  if (!got) {
    return undefined;
  }
  unindexMemory(got);
  const persistRoot = lookup.persistRoot?.trim();
  if (persistRoot) {
    removeDurable(persistRoot, got.runId);
  }
  return got;
}

/** Test helper. */
export function clearAwaitingDeliveriesForTests(persistRoot?: string): void {
  byRunId.clear();
  byDeliveryId.clear();
  byTaskId.clear();
  const root = persistRoot?.trim();
  if (!root) {
    return;
  }
  const dir = pendingDir(root);
  if (!fs.existsSync(dir)) {
    return;
  }
  for (const name of fs.readdirSync(dir)) {
    try {
      fs.unlinkSync(path.join(dir, name));
    } catch {
      // ignore
    }
  }
}
