/**
 * supervisor/node-seat-binding-request-store.ts — employee initiated Node binding requests.
 *
 * Persisted at CONFIG_DIR/openbot-node-seat-binding-requests.json.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const STORE_VERSION = 1;

export type NodeSeatBindingRequestStatus = "pending" | "approved" | "rejected";

export type NodeSeatBindingRequest = {
  requestId: string;
  tenantId: string;
  seatId: string;
  userId?: string;
  nodeId: string;
  nodeDisplayName?: string;
  status: NodeSeatBindingRequestStatus;
  requestedAt: string;
  updatedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
};

interface Store {
  version: number;
  requests: Record<string, NodeSeatBindingRequest>;
}

function createEmptyStore(): Store {
  return { version: STORE_VERSION, requests: {} };
}

export function resolveDefaultNodeSeatBindingRequestStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-node-seat-binding-requests.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultNodeSeatBindingRequestStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || typeof parsed.requests !== "object" || parsed.requests === null) {
    return createEmptyStore();
  }
  return { version: STORE_VERSION, requests: parsed.requests };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultNodeSeatBindingRequestStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function listNodeSeatBindingRequests(input: {
  tenantId: string;
  seatId?: string;
  status?: NodeSeatBindingRequestStatus | "all";
  storePath?: string;
}): Promise<NodeSeatBindingRequest[]> {
  const tenantId = input.tenantId.trim();
  if (!tenantId) {
    return [];
  }
  const seatId = input.seatId?.trim();
  const status = input.status ?? "pending";
  const store = await loadStore(input.storePath);
  return Object.values(store.requests)
    .filter((entry) => entry.tenantId === tenantId)
    .filter((entry) => (seatId ? entry.seatId === seatId : true))
    .filter((entry) => (status === "all" ? true : entry.status === status))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createNodeSeatBindingRequest(
  input: {
    tenantId: string;
    seatId: string;
    nodeId: string;
    userId?: string;
    nodeDisplayName?: string;
  },
  storePath?: string,
): Promise<NodeSeatBindingRequest> {
  const tenantId = input.tenantId.trim();
  const seatId = input.seatId.trim();
  const nodeId = input.nodeId.trim();
  const userId = input.userId?.trim();
  const nodeDisplayName = input.nodeDisplayName?.trim();
  if (!tenantId || !seatId || !nodeId) {
    throw new Error("tenantId, seatId, and nodeId are required");
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const now = new Date().toISOString();
    const existing = Object.values(store.requests).find(
      (entry) =>
        entry.tenantId === tenantId && entry.seatId === seatId && entry.status === "pending",
    );
    const request: NodeSeatBindingRequest = {
      requestId: existing?.requestId ?? `sup_node_bind_${randomUUID()}`,
      tenantId,
      seatId,
      ...(userId ? { userId } : {}),
      nodeId,
      ...(nodeDisplayName ? { nodeDisplayName } : {}),
      status: "pending",
      requestedAt: existing?.requestedAt ?? now,
      updatedAt: now,
    };
    store.requests[request.requestId] = request;
    await saveStore(store, storePath);
    return request;
  });
}

export async function resolveNodeSeatBindingRequest(
  input: {
    requestId: string;
    decision: "approved" | "rejected";
    decidedBy?: string;
    reason?: string;
  },
  storePath?: string,
): Promise<NodeSeatBindingRequest | null> {
  const requestId = input.requestId.trim();
  if (!requestId) {
    return null;
  }
  return withLock(async () => {
    const store = await loadStore(storePath);
    const current = store.requests[requestId];
    if (!current) {
      return null;
    }
    const now = new Date().toISOString();
    const decidedBy = input.decidedBy?.trim();
    const reason = input.reason?.trim();
    const next: NodeSeatBindingRequest = {
      ...current,
      status: input.decision,
      updatedAt: now,
      decidedAt: now,
      ...(decidedBy ? { decidedBy } : {}),
      ...(reason ? { decisionReason: reason } : {}),
    };
    store.requests[requestId] = next;
    await saveStore(store, storePath);
    return next;
  });
}
