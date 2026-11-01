/**
 * Side channel: prepare (agent-runner) registers awaiting delivery; dispatch
 * confirms after the channel send succeeds or fails.
 *
 * R85d: registrations are durable under the TaskOutcome store so a process
 * restart (or a confirm call missing runId) can still resolve taskId/deliveryId.
 */
import fs from "node:fs";
import path from "node:path";

export type AwaitingDeliveryRegistration = {
  taskId: string;
  deliveryId: string;
  agentId: string;
  runId: string;
  registeredAtMs: number;
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

function writeDurable(persistRoot: string, reg: AwaitingDeliveryRegistration): void {
  const dir = pendingDir(persistRoot);
  fs.mkdirSync(dir, { recursive: true });
  const target = fileForRun(persistRoot, reg.runId);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, target);
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
  };
  indexMemory(full);
  const persistRoot = reg.persistRoot?.trim();
  if (persistRoot) {
    writeDurable(persistRoot, full);
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
