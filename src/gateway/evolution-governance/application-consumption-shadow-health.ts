/**
 * Fail-closed shadow store health.
 *
 * The durable fact is the append-only hash chain at
 * evolution-shadow-ledger/events.jsonl. control-plane-application-consumption.health.json
 * is only a mirror. A missing mirror does not make the store healthy. If the
 * mirror cannot be written, the chain still records the fault with
 * mirrorPersisted=false. Recovery ignores client booleans and appends a
 * server-authored event only after the admin check and the window check pass.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { APPLICATION_CONSUMPTION_SCHEMA, type ShadowStoreHealth } from "@openbot/evolution-core";

const HEALTH_SCHEMA = 1;
const GENESIS_HASH = "genesis";
const FAULT_KINDS = [
  "write_failure",
  "read_failure",
  "corrupt",
  "truncated",
  "unsupported_schema",
] as const;

export type ShadowStoreFaultKind = (typeof FAULT_KINDS)[number];

type ChainEvent = {
  schemaVersion: 1;
  seq: number;
  prevHash: string;
  type: "fault" | "witness" | "recovery";
  kind: ShadowStoreFaultKind | null;
  mirrorPersisted: boolean;
  recordedAt: string;
  adminId: string;
  reason: string;
  sampleCount: number;
  hash: string;
};

type ChainRead = {
  events: ChainEvent[];
  missing: boolean;
  tampered: boolean;
  unreadable: boolean;
};

type MirrorRead = {
  faults: ShadowStoreFaultKind[];
  missing: boolean;
  tampered: boolean;
  unreadable: boolean;
};

type Fold = {
  faults: Set<ShadowStoreFaultKind>;
  mirrorRequired: boolean;
};

const rememberedFailures = new Set<string>();

export type ShadowRecoveryAuthority = {
  verifyAdmin(adminId: string): boolean;
};

function shadowPath(configDir: string): string {
  return path.join(
    configDir,
    "evolution-governance",
    "control-plane-application-consumption.jsonl",
  );
}

function mirrorPath(configDir: string): string {
  return path.join(configDir, "control-plane-application-consumption.health.json");
}

function chainPath(configDir: string): string {
  return path.join(configDir, "evolution-shadow-ledger", "events.jsonl");
}

function isFaultKind(value: unknown): value is ShadowStoreFaultKind {
  return typeof value === "string" && (FAULT_KINDS as readonly string[]).includes(value);
}

function digest(body: Omit<ChainEvent, "hash">): string {
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
}

function remember(configDir: string): void {
  rememberedFailures.add(configDir);
}

export function discardInMemoryShadowStoreHealthForTests(): void {
  rememberedFailures.clear();
}

/** Chain presence only. A present chain can still hold open faults. */
export function describeShadowHealthChain(configDir: string): "present" | "missing" | "untrusted" {
  const chain = readChain(configDir);
  if (chain.missing) {
    return "missing";
  }
  if (chain.tampered || chain.unreadable) {
    return "untrusted";
  }
  return "present";
}

function finishHealth(health: ShadowStoreHealth): ShadowStoreHealth {
  health.observationStoreHealthy =
    health.corruptionCount === 0 &&
    health.unsupportedSchemaCount === 0 &&
    !health.truncated &&
    !health.persistenceFailure;
  return health;
}

function readChain(configDir: string): ChainRead {
  const filePath = chainPath(configDir);
  let raw = "";
  try {
    if (!fs.existsSync(filePath)) {
      return { events: [], missing: true, tampered: false, unreadable: false };
    }
    if (!fs.statSync(filePath).isFile()) {
      return { events: [], missing: false, tampered: false, unreadable: true };
    }
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { events: [], missing: false, tampered: false, unreadable: true };
  }
  if (raw.length === 0 || !raw.endsWith("\n")) {
    return { events: [], missing: false, tampered: true, unreadable: false };
  }
  const events: ChainEvent[] = [];
  let prevHash = GENESIS_HASH;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: ChainEvent;
    try {
      parsed = JSON.parse(line) as ChainEvent;
    } catch {
      return { events: [], missing: false, tampered: true, unreadable: false };
    }
    if (
      parsed?.schemaVersion !== HEALTH_SCHEMA ||
      parsed.seq !== events.length + 1 ||
      parsed.prevHash !== prevHash ||
      (parsed.type !== "fault" && parsed.type !== "witness" && parsed.type !== "recovery") ||
      typeof parsed.hash !== "string"
    ) {
      return { events: [], missing: false, tampered: true, unreadable: false };
    }
    if (parsed.type === "fault" && !isFaultKind(parsed.kind)) {
      return { events: [], missing: false, tampered: true, unreadable: false };
    }
    const { hash, ...body } = parsed;
    if (digest(body) !== hash) {
      return { events: [], missing: false, tampered: true, unreadable: false };
    }
    events.push(parsed);
    prevHash = hash;
  }
  if (events.length === 0) {
    return { events: [], missing: false, tampered: true, unreadable: false };
  }
  return { events, missing: false, tampered: false, unreadable: false };
}

function fold(events: readonly ChainEvent[]): Fold {
  const faults = new Set<ShadowStoreFaultKind>();
  let mirrorRequired = false;
  for (const event of events) {
    if (event.type === "fault" && event.kind) {
      faults.add(event.kind);
      if (event.mirrorPersisted) {
        mirrorRequired = true;
      }
    } else if (event.type === "witness") {
      if (event.mirrorPersisted) {
        mirrorRequired = true;
      }
    } else if (event.type === "recovery") {
      faults.clear();
      mirrorRequired = true;
    }
  }
  return { faults, mirrorRequired };
}

function readMirror(configDir: string): MirrorRead {
  const filePath = mirrorPath(configDir);
  let raw = "";
  try {
    if (!fs.existsSync(filePath)) {
      return { faults: [], missing: true, tampered: false, unreadable: false };
    }
    if (!fs.statSync(filePath).isFile()) {
      return { faults: [], missing: false, tampered: false, unreadable: true };
    }
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { faults: [], missing: false, tampered: false, unreadable: true };
  }
  try {
    const parsed = JSON.parse(raw) as { schemaVersion?: unknown; faults?: unknown };
    if (parsed?.schemaVersion !== HEALTH_SCHEMA || !Array.isArray(parsed.faults)) {
      return { faults: [], missing: false, tampered: true, unreadable: false };
    }
    const faults: ShadowStoreFaultKind[] = [];
    for (const entry of parsed.faults) {
      if (!entry || typeof entry !== "object") {
        return { faults: [], missing: false, tampered: true, unreadable: false };
      }
      const kind = (entry as { kind?: unknown }).kind;
      if (!isFaultKind(kind)) {
        return { faults: [], missing: false, tampered: true, unreadable: false };
      }
      faults.push(kind);
    }
    return { faults, missing: false, tampered: false, unreadable: false };
  } catch {
    return { faults: [], missing: false, tampered: true, unreadable: false };
  }
}

function sameFaults(
  left: readonly ShadowStoreFaultKind[],
  right: ReadonlySet<ShadowStoreFaultKind>,
): boolean {
  if (left.length !== right.size) {
    return false;
  }
  return left.every((kind) => right.has(kind));
}

function writeAtomic(filePath: string, payload: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, payload);
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function tryWriteMirror(configDir: string, faults: ReadonlySet<ShadowStoreFaultKind>): boolean {
  try {
    const body = {
      schemaVersion: HEALTH_SCHEMA,
      faults: [...faults].map((kind) => ({ kind, recordedAt: new Date().toISOString() })),
    };
    writeAtomic(mirrorPath(configDir), `${JSON.stringify(body)}\n`);
    return true;
  } catch {
    return false;
  }
}

function appendEvent(
  configDir: string,
  input: Omit<ChainEvent, "schemaVersion" | "seq" | "prevHash" | "hash">,
): void {
  const current = readChain(configDir);
  if (current.tampered || current.unreadable) {
    throw new Error("shadow health chain is not appendable");
  }
  const prev = current.events.at(-1);
  const body: Omit<ChainEvent, "hash"> = {
    schemaVersion: HEALTH_SCHEMA,
    seq: current.events.length + 1,
    prevHash: prev?.hash ?? GENESIS_HASH,
    type: input.type,
    kind: input.kind,
    mirrorPersisted: input.mirrorPersisted,
    recordedAt: input.recordedAt,
    adminId: input.adminId,
    reason: input.reason,
    sampleCount: input.sampleCount,
  };
  const event = { ...body, hash: digest(body) };
  const prior = current.missing ? "" : fs.readFileSync(chainPath(configDir), "utf8");
  writeAtomic(chainPath(configDir), `${prior}${JSON.stringify(event)}\n`);
}

export function latchShadowStoreFaults(
  configDir: string,
  kinds: readonly ShadowStoreFaultKind[],
): void {
  const unique = kinds.filter((kind, index) => kinds.indexOf(kind) === index);
  if (unique.length === 0) {
    return;
  }
  try {
    const current = readChain(configDir);
    if (current.tampered || current.unreadable) {
      remember(configDir);
      return;
    }
    const open = fold(current.events).faults;
    const next = new Set(open);
    const added: ShadowStoreFaultKind[] = [];
    for (const kind of unique) {
      if (!open.has(kind)) {
        next.add(kind);
        added.push(kind);
      }
    }
    if (added.length === 0) {
      return;
    }
    const mirrored = tryWriteMirror(configDir, next);
    for (const kind of added) {
      appendEvent(configDir, {
        type: "fault",
        kind,
        mirrorPersisted: mirrored,
        recordedAt: new Date().toISOString(),
        adminId: "",
        reason: "",
        sampleCount: 0,
      });
    }
  } catch {
    remember(configDir);
  }
}

export function attestShadowStoreWrite(configDir: string, sampleCount: number): void {
  const mirrored = tryWriteMirror(configDir, new Set());
  appendEvent(configDir, {
    type: "witness",
    kind: null,
    mirrorPersisted: mirrored,
    recordedAt: new Date().toISOString(),
    adminId: "",
    reason: "",
    sampleCount,
  });
  if (!mirrored) {
    latchShadowStoreFaults(configDir, ["write_failure"]);
    throw new Error("shadow health mirror was not written");
  }
}

export function projectShadowStoreHealth(
  configDir: string,
  scanned: ShadowStoreHealth,
  storePresent: boolean,
): ShadowStoreHealth {
  const health: ShadowStoreHealth = { ...scanned };
  const chain = readChain(configDir);
  const mirror = readMirror(configDir);
  const chainUntrusted = chain.tampered || chain.unreadable;
  const folded = chainUntrusted
    ? { faults: new Set<ShadowStoreFaultKind>(), mirrorRequired: false }
    : fold(chain.events);
  if (chainUntrusted || (chain.missing && storePresent) || rememberedFailures.has(configDir)) {
    health.persistenceFailure = true;
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (chainUntrusted) {
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (folded.faults.has("write_failure") || folded.faults.has("read_failure")) {
    health.persistenceFailure = true;
  }
  if (folded.faults.has("truncated")) {
    health.truncated = true;
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (folded.faults.has("corrupt") || chainUntrusted) {
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (folded.faults.has("unsupported_schema")) {
    health.unsupportedSchemaCount = Math.max(health.unsupportedSchemaCount, 1);
  }
  if (mirror.unreadable || mirror.tampered) {
    health.persistenceFailure = true;
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (!chain.missing && !chainUntrusted && folded.mirrorRequired && mirror.missing) {
    health.persistenceFailure = true;
    health.corruptionCount = Math.max(health.corruptionCount, 1);
  }
  if (
    !mirror.missing &&
    !mirror.tampered &&
    !mirror.unreadable &&
    !chainUntrusted &&
    !chain.missing
  ) {
    if (!sameFaults(mirror.faults, folded.faults)) {
      health.corruptionCount = Math.max(health.corruptionCount, 1);
    }
  }
  return finishHealth(health);
}

function assessWindow(configDir: string): { ok: boolean; sampleCount: number } {
  const filePath = shadowPath(configDir);
  let raw = "";
  try {
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      return { ok: false, sampleCount: 0 };
    }
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return { ok: false, sampleCount: 0 };
  }
  if (raw.length === 0 || !raw.endsWith("\n")) {
    return { ok: false, sampleCount: 0 };
  }
  let sampleCount = 0;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    let parsed: {
      schemaVersion?: unknown;
      idempotencyKey?: unknown;
      recordedAt?: unknown;
      executedConsumer?: unknown;
      denyReason?: unknown;
      outcome?: unknown;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      return { ok: false, sampleCount: 0 };
    }
    if (parsed.schemaVersion !== APPLICATION_CONSUMPTION_SCHEMA) {
      return { ok: false, sampleCount: 0 };
    }
    if (typeof parsed.idempotencyKey !== "string" || parsed.idempotencyKey.trim() === "") {
      return { ok: false, sampleCount: 0 };
    }
    if (typeof parsed.recordedAt !== "string" || parsed.recordedAt.trim() === "") {
      return { ok: false, sampleCount: 0 };
    }
    if (parsed.executedConsumer !== false) {
      return { ok: false, sampleCount: 0 };
    }
    if (parsed.denyReason != null || parsed.outcome === "denied") {
      return { ok: false, sampleCount: 0 };
    }
    sampleCount += 1;
  }
  return { ok: sampleCount > 0, sampleCount };
}

export function recoverShadowStoreHealth(input: {
  configDir: string;
  adminId: string;
  reason: string;
  authority: ShadowRecoveryAuthority;
}): { cleared: boolean; reason: string } {
  const adminId = input.adminId.trim();
  const reason = input.reason.trim();
  const adminOk: unknown = input.authority.verifyAdmin(adminId);
  if (!adminId || !reason || adminOk !== true) {
    return { cleared: false, reason: "admin_rejected" };
  }
  const chain = readChain(input.configDir);
  if (chain.missing || chain.tampered || chain.unreadable) {
    return { cleared: false, reason: "ledger_untrusted" };
  }
  const window = assessWindow(input.configDir);
  if (!window.ok) {
    return { cleared: false, reason: "observation_window_rejected" };
  }
  const mirrored = tryWriteMirror(input.configDir, new Set());
  if (!mirrored) {
    return { cleared: false, reason: "recovery_not_persisted" };
  }
  try {
    appendEvent(input.configDir, {
      type: "recovery",
      kind: null,
      mirrorPersisted: true,
      recordedAt: new Date().toISOString(),
      adminId,
      reason,
      sampleCount: window.sampleCount,
    });
    rememberedFailures.delete(input.configDir);
  } catch {
    return { cleared: false, reason: "recovery_not_persisted" };
  }
  return { cleared: true, reason: "recovered" };
}

export function removeShadowStoreHealthFiles(configDir: string): void {
  rememberedFailures.delete(configDir);
  for (const filePath of [mirrorPath(configDir), chainPath(configDir)]) {
    try {
      fs.rmSync(filePath, { force: true });
    } catch {
      // Parent may not be a directory.
    }
  }
  try {
    fs.rmSync(path.dirname(chainPath(configDir)), { recursive: true, force: true });
  } catch {
    // Ledger directory may already be gone.
  }
}
