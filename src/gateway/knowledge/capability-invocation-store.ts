import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";

/**
 * Audit + quota ledger for governed capability invocations. Every invoke attempt
 * (allowed or denied) is recorded here so capability access is attributable and
 * rate-limitable. This is a knowledge-plane store only — it records that an invoke
 * happened; it never calls a connector.
 */

export type CapabilityInvocationRecord = {
  id: string;
  tenantId: string;
  seatId: string;
  capabilityId: string;
  ok: boolean;
  reason?: string;
  atMs: number;
};

type CapabilityInvocationStore = { invocations: CapabilityInvocationRecord[] };

const DEFAULT_STORE_FILE = path.join(CONFIG_DIR, "knowledge", "capability-invocations.json");
const MAX_RETAINED = 2000;

function readStore(storePath: string): CapabilityInvocationStore {
  try {
    if (!fs.existsSync(storePath)) {
      return { invocations: [] };
    }
    const parsed = JSON.parse(fs.readFileSync(storePath, "utf-8")) as unknown;
    const record =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const invocations = Array.isArray(record.invocations)
      ? (record.invocations as CapabilityInvocationRecord[])
      : [];
    return { invocations };
  } catch {
    return { invocations: [] };
  }
}

function writeStore(store: CapabilityInvocationStore, storePath: string): void {
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  const trimmed =
    store.invocations.length > MAX_RETAINED
      ? store.invocations.slice(store.invocations.length - MAX_RETAINED)
      : store.invocations;
  fs.writeFileSync(storePath, `${JSON.stringify({ invocations: trimmed }, null, 2)}\n`, "utf8");
}

export function recordCapabilityInvocation(
  params: {
    tenantId: string;
    seatId: string;
    capabilityId: string;
    ok: boolean;
    reason?: string;
  },
  storePath: string = DEFAULT_STORE_FILE,
): CapabilityInvocationRecord {
  const store = readStore(storePath);
  const entry: CapabilityInvocationRecord = {
    id: randomUUID(),
    tenantId: params.tenantId,
    seatId: params.seatId,
    capabilityId: params.capabilityId,
    ok: params.ok,
    reason: params.reason,
    atMs: Date.now(),
  };
  store.invocations.push(entry);
  writeStore(store, storePath);
  return entry;
}

export function countCapabilityInvocations(
  params: {
    tenantId: string;
    seatId: string;
    capabilityId: string;
    sinceMs?: number;
    okOnly?: boolean;
  },
  storePath: string = DEFAULT_STORE_FILE,
): number {
  return readStore(storePath).invocations.filter(
    (item) =>
      item.tenantId === params.tenantId &&
      item.seatId === params.seatId &&
      item.capabilityId === params.capabilityId &&
      (params.okOnly ? item.ok : true) &&
      (params.sinceMs ? item.atMs >= params.sinceMs : true),
  ).length;
}

export function listCapabilityInvocations(
  filter: { tenantId?: string; seatId?: string; capabilityId?: string } = {},
  storePath: string = DEFAULT_STORE_FILE,
): CapabilityInvocationRecord[] {
  return readStore(storePath)
    .invocations.filter((item) => (filter.tenantId ? item.tenantId === filter.tenantId : true))
    .filter((item) => (filter.seatId ? item.seatId === filter.seatId : true))
    .filter((item) => (filter.capabilityId ? item.capabilityId === filter.capabilityId : true))
    .toSorted((left, right) => right.atMs - left.atMs);
}
