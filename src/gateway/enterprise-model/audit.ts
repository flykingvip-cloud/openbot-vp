/**
 * Append-only audit for enterprise model connection / catalog mutations.
 * Never records API key plaintext.
 */

import { randomUUID } from "node:crypto";
import path from "node:path";
import { createAsyncLock, readJsonFile, writeJsonAtomic } from "../../infra/json-files.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";

const STORE_VERSION = 1;

export type EnterpriseModelAuditAction =
  | "connection.created"
  | "connection.updated"
  | "connection.tested"
  | "connection.credential_rotated"
  | "connection.disabled"
  | "connection.deleted"
  | "catalog.discovered"
  | "catalog.registered"
  | "catalog.updated"
  | "catalog.enabled"
  | "catalog.disabled"
  /** Successful BYOK resolve ready to invoke upstream (no secrets). */
  | "runtime.invoked"
  /** Monthly spend cap blocked the invoke (fail-closed). */
  | "runtime.budget_blocked";

export type EnterpriseModelAuditEvent = {
  id: string;
  seq: number;
  ts: string;
  tenantId: string;
  actorUserId?: string;
  action: EnterpriseModelAuditAction;
  targetType: "connection" | "asset";
  targetId: string;
  result: "success" | "failure";
  code?: string;
  /** Safe metadata only — never secrets. */
  details?: Record<string, unknown>;
};

type Store = {
  version: number;
  nextSeq: number;
  events: EnterpriseModelAuditEvent[];
};

function createEmptyStore(): Store {
  return { version: STORE_VERSION, nextSeq: 1, events: [] };
}

export function resolveDefaultEnterpriseModelAuditStorePath(): string {
  return path.join(CONFIG_DIR, "openbot-enterprise-model-audit.json");
}

const withLock = createAsyncLock();

async function loadStore(storePath?: string): Promise<Store> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseModelAuditStorePath(),
  );
  const parsed = await readJsonFile<Partial<Store>>(resolvedPath);
  if (!parsed || !Array.isArray(parsed.events)) {
    return createEmptyStore();
  }
  const events = parsed.events;
  const maxSeq = events.reduce((acc, e) => Math.max(acc, e.seq), 0);
  return {
    version: STORE_VERSION,
    nextSeq: typeof parsed.nextSeq === "number" ? Math.max(parsed.nextSeq, maxSeq + 1) : maxSeq + 1,
    events,
  };
}

async function saveStore(store: Store, storePath?: string): Promise<void> {
  const resolvedPath = resolveUserPath(
    storePath?.trim() || resolveDefaultEnterpriseModelAuditStorePath(),
  );
  await writeJsonAtomic(resolvedPath, store);
}

export async function recordEnterpriseModelAuditEvent(
  input: {
    tenantId: string;
    actorUserId?: string;
    action: EnterpriseModelAuditAction;
    targetType: "connection" | "asset";
    targetId: string;
    result: "success" | "failure";
    code?: string;
    details?: Record<string, unknown>;
  },
  storePath?: string,
): Promise<EnterpriseModelAuditEvent> {
  return withLock(async () => {
    const store = await loadStore(storePath);
    const event: EnterpriseModelAuditEvent = {
      id: randomUUID(),
      seq: store.nextSeq,
      ts: new Date().toISOString(),
      tenantId: input.tenantId,
      ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      result: input.result,
      ...(input.code ? { code: input.code } : {}),
      ...(input.details ? { details: sanitizeAuditDetails(input.details) } : {}),
    };
    store.events.push(event);
    store.nextSeq += 1;
    await saveStore(store, storePath);
    return event;
  });
}

const SECRET_KEY_RE = /api[_-]?key|secret|password|token|authorization|credential/i;

function sanitizeAuditDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (SECRET_KEY_RE.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    if (typeof value === "string" && value.length > 200) {
      out[key] = `${value.slice(0, 200)}…`;
      continue;
    }
    out[key] = value;
  }
  return out;
}

export async function listEnterpriseModelAuditEvents(
  tenantId?: string,
  storePath?: string,
): Promise<EnterpriseModelAuditEvent[]> {
  const store = await loadStore(storePath);
  if (!tenantId) {
    return store.events;
  }
  return store.events.filter((e) => e.tenantId === tenantId);
}
