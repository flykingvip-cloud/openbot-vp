/**
 * supervisor/node-seat-binding-store.ts — tenant/seat → nodeId bindings (M5).
 *
 * Persisted at CONFIG_DIR/openbot-node-seat-bindings.json.
 */

import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const STORE_VERSION = 1;

export type NodeSeatBinding = {
  tenantId: string;
  seatId: string;
  nodeId: string;
  updatedAt: string;
  /**
   * Set when the user chose Always Allow (始终授权) on the local-computer popup.
   * Bounded Desktop host=node ops may skip the card until revoked/unbound.
   */
  alwaysAllowDesktop?: boolean;
};

interface Store {
  version: number;
  /** key = `${tenantId}:${seatId}` */
  bindings: Record<string, NodeSeatBinding>;
}

function bindingKey(tenantId: string, seatId: string): string {
  return `${tenantId.trim()}:${seatId.trim()}`;
}

function createEmptyStore(): Store {
  return { version: STORE_VERSION, bindings: {} };
}

export function resolveDefaultNodeSeatBindingStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-node-seat-bindings.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultNodeSeatBindingStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.bindings !== "object" || parsed.bindings === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, bindings: parsed.bindings };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultNodeSeatBindingStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function listNodeSeatBindings(
  tenantId: string,
  storePath?: string,
): Promise<NodeSeatBinding[]> {
  const normalizedTenant = tenantId.trim();
  if (!normalizedTenant) {
    return [];
  }
  const store = await loadStore(storePath);
  return Object.values(store.bindings)
    .filter((entry) => entry.tenantId === normalizedTenant)
    .toSorted((a, b) => a.seatId.localeCompare(b.seatId));
}

export async function getNodeSeatBinding(
  tenantId: string,
  seatId: string,
  storePath?: string,
): Promise<NodeSeatBinding | null> {
  const store = await loadStore(storePath);
  return store.bindings[bindingKey(tenantId, seatId)] ?? null;
}

export async function upsertNodeSeatBinding(
  input: {
    tenantId: string;
    seatId: string;
    nodeId: string;
    /** When set, updates the Always Allow Desktop flag; otherwise preserves the previous value. */
    alwaysAllowDesktop?: boolean;
  },
  storePath?: string,
): Promise<NodeSeatBinding> {
  const tenantId = input.tenantId.trim();
  const seatId = input.seatId.trim();
  const nodeId = input.nodeId.trim();
  if (!tenantId || !seatId || !nodeId) {
    throw new Error("tenantId, seatId, and nodeId are required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = bindingKey(tenantId, seatId);
    const previous = store.bindings[key];
    const record: NodeSeatBinding = {
      tenantId,
      seatId,
      nodeId,
      updatedAt: new Date().toISOString(),
    };
    if (typeof input.alwaysAllowDesktop === "boolean") {
      if (input.alwaysAllowDesktop) {
        record.alwaysAllowDesktop = true;
      }
    } else if (previous?.alwaysAllowDesktop && previous.nodeId.trim() === nodeId) {
      record.alwaysAllowDesktop = true;
    }
    store.bindings[key] = record;
    await saveStore(store, storePath);
    return record;
  });
}

export async function removeNodeSeatBinding(
  tenantId: string,
  seatId: string,
  storePath?: string,
): Promise<boolean> {
  const normalizedTenant = tenantId.trim();
  const normalizedSeat = seatId.trim();
  if (!normalizedTenant || !normalizedSeat) {
    return false;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const key = bindingKey(normalizedTenant, normalizedSeat);
    if (!store.bindings[key]) {
      return false;
    }
    delete store.bindings[key];
    await saveStore(store, storePath);
    return true;
  });
}
