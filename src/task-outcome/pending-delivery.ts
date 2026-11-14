/**
 * Side channel: prepare (agent-runner) registers awaiting delivery; dispatch
 * confirms after the channel send succeeds or fails.
 *
 * R85d: registrations are durable under the TaskOutcome store so a process
 * restart (or a confirm call missing runId) can still resolve taskId/deliveryId.
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { TaskCompletionBinding } from "../agent-runtime/contracts/task-binding.js";
import { withDurableJsonLock, writeDurableJsonAtomic } from "./durable-json-file.js";

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

/** Verifiable locator for a current-authorization recheck. Not itself a grant. */
export type PendingVisibleAuthorizationLocator = {
  subjectRef?: string;
  sessionKey?: string;
  operatorId?: string;
  tenantId?: string;
  accountId?: string;
  channel?: string;
  to?: string;
  groupId?: string;
};

/** Live producer or send owner. Same generation is contended by producer and recovery. */
export type AwaitingDeliveryClaimHolder = {
  kind: "producer_preparing" | "send";
  pid: number;
  token: string;
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
  authorization?: PendingVisibleAuthorizationLocator;
  claimGeneration?: number;
  claimHolder?: AwaitingDeliveryClaimHolder | null;
};

export type ClaimAwaitingDeliverySendResult =
  | {
      ok: true;
      registration: AwaitingDeliveryRegistration;
      generation: number;
      token: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_attempted"
        | "live_producer"
        | "already_claimed"
        | "missing_materials";
    };

export type HandoffAwaitingDeliveryResult =
  | { ok: true; registration: AwaitingDeliveryRegistration }
  | { ok: false; reason: "not_found" | "already_taken" | "stale_holder" };

const byRunId = new Map<string, AwaitingDeliveryRegistration>();
const byDeliveryId = new Map<string, AwaitingDeliveryRegistration>();
const byTaskId = new Map<string, AwaitingDeliveryRegistration>();
const liveProducerHolds = new Map<
  string,
  { persistRoot: string; runId: string; token: string; generation: number }
>();

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

function sanitizeAuthorizationLocator(
  value: PendingVisibleAuthorizationLocator | undefined,
): PendingVisibleAuthorizationLocator | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const out: PendingVisibleAuthorizationLocator = {};
  for (const key of [
    "subjectRef",
    "sessionKey",
    "operatorId",
    "tenantId",
    "accountId",
    "channel",
    "to",
    "groupId",
  ] as const) {
    const raw = value[key];
    if (typeof raw === "string" && raw.trim()) {
      out[key] = raw.trim();
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeClaimHolder(value: unknown): AwaitingDeliveryClaimHolder | null | undefined {
  if (value === null) {
    return null;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const raw = value as { kind?: unknown; pid?: unknown; token?: unknown };
  if (
    (raw.kind === "producer_preparing" || raw.kind === "send") &&
    typeof raw.pid === "number" &&
    Number.isInteger(raw.pid) &&
    raw.pid > 0 &&
    typeof raw.token === "string" &&
    raw.token.trim()
  ) {
    return { kind: raw.kind, pid: raw.pid, token: raw.token.trim() };
  }
  return undefined;
}

function sanitizeClaimGeneration(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

function optionalDeliveryMaterials(raw: {
  checkedTask?: AwaitingDeliveryRegistration["checkedTask"];
  payloads?: PendingVisiblePayload[];
  target?: PendingVisibleTarget;
  sendDisposition?: AwaitingDeliverySendDisposition;
  authorization?: PendingVisibleAuthorizationLocator;
  claimGeneration?: number;
  claimHolder?: AwaitingDeliveryClaimHolder | null;
}): Pick<
  AwaitingDeliveryRegistration,
  | "checkedTask"
  | "payloads"
  | "target"
  | "sendDisposition"
  | "authorization"
  | "claimGeneration"
  | "claimHolder"
> {
  const payloads = sanitizePendingVisiblePayloads(raw.payloads);
  const target = sanitizePendingVisibleTarget(raw.target);
  const sendDisposition = sanitizeSendDisposition(raw.sendDisposition);
  const authorization = sanitizeAuthorizationLocator(raw.authorization);
  const claimGeneration = sanitizeClaimGeneration(raw.claimGeneration);
  const claimHolder = sanitizeClaimHolder(raw.claimHolder);
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
    ...(authorization ? { authorization } : {}),
    ...(claimGeneration !== undefined ? { claimGeneration } : {}),
    ...(claimHolder !== undefined ? { claimHolder } : {}),
  };
}

function liveProducerHoldKey(persistRoot: string, runId: string): string {
  return `${path.resolve(persistRoot)}\0${runId}`;
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

type PendingEntryRead = {
  source: "json" | "intent";
  path: string;
  reg: AwaitingDeliveryRegistration;
};

function readCurrentPendingEntry(persistRoot: string, runId: string): PendingEntryRead | undefined {
  const jsonPath = fileForRun(persistRoot, runId);
  const json = readDurableFile(jsonPath);
  if (json) {
    return { source: "json", path: jsonPath, reg: json };
  }
  const intentPath = intentFileForRun(persistRoot, runId);
  const intent = readDurableFile(intentPath);
  if (intent) {
    return { source: "intent", path: intentPath, reg: intent };
  }
  return undefined;
}

function withPendingEntryLock<T>(
  persistRoot: string,
  runId: string,
  fn: () => Promise<T>,
): Promise<T> {
  return withDurableJsonLock(fileForRun(persistRoot, runId), fn);
}

export function hasLiveProducerPreparation(persistRoot: string, runId: string): boolean {
  const root = persistRoot.trim();
  const id = runId.trim();
  if (!root || !id) {
    return false;
  }
  if (liveProducerHolds.has(liveProducerHoldKey(root, id))) {
    return true;
  }
  const current = readCurrentPendingEntry(root, id);
  const holder = current?.reg.claimHolder;
  if (holder?.kind !== "producer_preparing") {
    return false;
  }
  // This process uses the in-memory hold as the liveness authority so a thrown
  // prepare in the same process can still be recovered after finally releases.
  if (holder.pid === process.pid) {
    return false;
  }
  return isProcessAlive(holder.pid);
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
  const token = randomUUID();
  const claimGeneration = sanitizeClaimGeneration(reg.claimGeneration) ?? 1;
  const full: AwaitingDeliveryRegistration = {
    taskId,
    deliveryId,
    agentId,
    runId,
    registeredAtMs: Date.now(),
    ...optionalDeliveryMaterials({
      ...reg,
      sendDisposition: reg.sendDisposition ?? "not_attempted",
      claimGeneration,
      claimHolder: {
        kind: "producer_preparing",
        pid: process.pid,
        token,
      },
    }),
  };
  writeRegistrationFile(intentFileForRun(persistRoot, runId), full);
  liveProducerHolds.set(liveProducerHoldKey(persistRoot, runId), {
    persistRoot,
    runId,
    token,
    generation: claimGeneration,
  });
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

function refusesOverwrite(
  existing: AwaitingDeliveryRegistration,
  incoming: AwaitingDeliveryRegistration,
): boolean {
  if (existing.sendDisposition === "unknown" || existing.claimHolder?.kind === "send") {
    return true;
  }
  // Identity-only reconstruction must not strip original payload, target, or binding.
  if (
    (existing.payloads?.length ||
      existing.target ||
      existing.checkedTask ||
      existing.authorization) &&
    !incoming.payloads &&
    !incoming.target &&
    !incoming.checkedTask &&
    !incoming.authorization
  ) {
    return true;
  }
  return false;
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
  const persistRoot = reg.persistRoot?.trim();
  const existing = persistRoot ? readCurrentPendingEntry(persistRoot, runId)?.reg : undefined;
  const mergedMaterials = optionalDeliveryMaterials({
    ...existing,
    ...reg,
    ...(existing?.authorization && !reg.authorization
      ? { authorization: existing.authorization }
      : {}),
  });
  if (existing && persistRoot) {
    const preview: AwaitingDeliveryRegistration = {
      taskId,
      deliveryId,
      agentId,
      runId,
      registeredAtMs: existing.registeredAtMs,
      ...mergedMaterials,
    };
    if (refusesOverwrite(existing, preview)) {
      return;
    }
  }
  const full: AwaitingDeliveryRegistration = {
    taskId,
    deliveryId,
    agentId,
    runId,
    registeredAtMs: existing?.registeredAtMs ?? Date.now(),
    ...mergedMaterials,
  };
  indexMemory(full);
  if (persistRoot) {
    writeDurable(persistRoot, full);
    clearPendingDeliveryIntent(persistRoot, full.runId);
  }
}

export async function releaseLiveProducerPreparation(params: {
  persistRoot: string;
  runId: string;
}): Promise<void> {
  const persistRoot = params.persistRoot.trim();
  const runId = params.runId.trim();
  if (!persistRoot || !runId) {
    return;
  }
  const key = liveProducerHoldKey(persistRoot, runId);
  const hold = liveProducerHolds.get(key);
  liveProducerHolds.delete(key);
  await withPendingEntryLock(persistRoot, runId, async () => {
    const current = readCurrentPendingEntry(persistRoot, runId);
    if (!current || current.reg.claimHolder?.kind !== "producer_preparing") {
      return;
    }
    if (hold && current.reg.claimHolder.token !== hold.token) {
      return;
    }
    if (!hold && current.reg.claimHolder.pid !== process.pid) {
      return;
    }
    const next: AwaitingDeliveryRegistration = { ...current.reg, claimHolder: null };
    writeRegistrationFile(current.path, next);
  });
}

export async function handoffAwaitingDelivery(
  reg: Omit<AwaitingDeliveryRegistration, "registeredAtMs"> & { persistRoot: string },
): Promise<HandoffAwaitingDeliveryResult> {
  const persistRoot = reg.persistRoot.trim();
  const runId = reg.runId.trim();
  const taskId = reg.taskId.trim();
  const deliveryId = reg.deliveryId.trim();
  const agentId = reg.agentId.trim();
  if (!persistRoot || !runId || !taskId || !deliveryId || !agentId) {
    return { ok: false, reason: "not_found" };
  }
  const key = liveProducerHoldKey(persistRoot, runId);
  const hold = liveProducerHolds.get(key);
  return withPendingEntryLock(persistRoot, runId, async () => {
    const current = readCurrentPendingEntry(persistRoot, runId);
    if (!current) {
      return { ok: false, reason: "not_found" };
    }
    const existing = current.reg;
    if (existing.sendDisposition === "unknown" || existing.claimHolder?.kind === "send") {
      return { ok: false, reason: "already_taken" };
    }
    const tokenOk =
      Boolean(hold) &&
      existing.claimHolder?.kind === "producer_preparing" &&
      existing.claimHolder.token === hold?.token;
    if (existing.sendDisposition === "handed_off" && !existing.claimHolder) {
      indexMemory(existing);
      liveProducerHolds.delete(key);
      clearPendingDeliveryIntent(persistRoot, runId);
      return { ok: true, registration: existing };
    }
    if (!tokenOk) {
      return { ok: false, reason: "stale_holder" };
    }
    const full: AwaitingDeliveryRegistration = {
      taskId,
      deliveryId,
      agentId,
      runId,
      registeredAtMs: existing.registeredAtMs,
      ...optionalDeliveryMaterials({
        ...existing,
        ...reg,
        sendDisposition: "handed_off",
        claimGeneration: (existing.claimGeneration ?? 0) + 1,
        claimHolder: null,
      }),
    };
    await writeDurableJsonAtomic(fileForRun(persistRoot, runId), full);
    clearPendingDeliveryIntent(persistRoot, runId);
    indexMemory(full);
    liveProducerHolds.delete(key);
    return { ok: true, registration: full };
  });
}

export async function claimAwaitingDeliverySend(lookup: {
  persistRoot: string;
  runId: string;
  deliveryId?: string;
  taskId?: string;
}): Promise<ClaimAwaitingDeliverySendResult> {
  const persistRoot = lookup.persistRoot.trim();
  const runId = lookup.runId.trim();
  if (!persistRoot || !runId) {
    return { ok: false, reason: "not_found" };
  }
  return withPendingEntryLock(persistRoot, runId, async () => {
    const current = readCurrentPendingEntry(persistRoot, runId);
    if (!current || current.source !== "json") {
      return { ok: false, reason: "not_found" };
    }
    const existing = current.reg;
    if (hasLiveProducerPreparation(persistRoot, runId)) {
      return { ok: false, reason: "live_producer" };
    }
    if (existing.sendDisposition === "unknown" || existing.claimHolder?.kind === "send") {
      return { ok: false, reason: "already_claimed" };
    }
    if (existing.sendDisposition !== "not_attempted") {
      return { ok: false, reason: "not_attempted" };
    }
    if (!existing.payloads?.length || !existing.target) {
      return { ok: false, reason: "missing_materials" };
    }
    const token = randomUUID();
    const generation = (existing.claimGeneration ?? 0) + 1;
    const next: AwaitingDeliveryRegistration = {
      ...existing,
      sendDisposition: "unknown",
      claimGeneration: generation,
      claimHolder: { kind: "send", pid: process.pid, token },
    };
    await writeDurableJsonAtomic(fileForRun(persistRoot, runId), next);
    indexMemory(next);
    return { ok: true, registration: next, generation, token };
  });
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
  if (root) {
    const prefix = `${path.resolve(root)}\0`;
    for (const key of liveProducerHolds.keys()) {
      if (key.startsWith(prefix)) {
        liveProducerHolds.delete(key);
      }
    }
  } else {
    liveProducerHolds.clear();
  }
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
