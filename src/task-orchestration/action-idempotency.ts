/**
 * WP-07 — Action idempotency key helper (skeleton; not wired to live send paths).
 *
 * Key = hash(tenant, taskId, logicalActionId). Same key with a different param
 * digest is rejected. Does NOT steal Fabric execute / outbound outbox ownership:
 * this module is a pure helper + in-memory registry for unit tests and future
 * adapter wiring. Does NOT flip ORCHESTRATION_LIVE_INVOKE.
 */
import { createHash } from "node:crypto";

export const ACTION_IDEMPOTENCY_SCHEMA_VERSION = 1 as const;

export type ActionIdempotencyKeyInput = {
  tenantId: string | null | undefined;
  taskId: string;
  logicalActionId: string;
};

export type ActionIdempotencyRecord = {
  key: string;
  paramDigest: string;
  registeredAtMs: number;
};

export type ActionIdempotencyRegisterOk = {
  ok: true;
  key: string;
  paramDigest: string;
  reused: boolean;
};

export type ActionIdempotencyRegisterFail = {
  ok: false;
  reason:
    | "empty_task_id"
    | "empty_logical_action_id"
    | "param_digest_conflict"
    | "empty_param_digest";
  key?: string;
  existingParamDigest?: string;
};

function normalizePart(value: string | null | undefined): string {
  if (value == null) {
    return "";
  }
  return value.trim();
}

/** Stable SHA-256 hex digest of a JSON-serializable value (or raw string). */
export function digestActionParams(params: unknown): string {
  if (typeof params === "string") {
    return createHash("sha256").update(params, "utf8").digest("hex");
  }
  const json = JSON.stringify(params);
  return createHash("sha256")
    .update(json ?? "null", "utf8")
    .digest("hex");
}

/**
 * Build action idempotency key: sha256(tenant|taskId|logicalActionId).
 * Tenant may be empty string when unset (still part of the hash domain).
 */
export function buildActionIdempotencyKey(input: ActionIdempotencyKeyInput): string {
  const tenant = normalizePart(input.tenantId);
  const taskId = normalizePart(input.taskId);
  const logicalActionId = normalizePart(input.logicalActionId);
  const material = `${tenant}\0${taskId}\0${logicalActionId}`;
  return createHash("sha256").update(material, "utf8").digest("hex");
}

export type ActionIdempotencyRegistry = {
  lookup(key: string): ActionIdempotencyRecord | null;
  register(input: {
    tenantId?: string | null;
    taskId: string;
    logicalActionId: string;
    paramDigest: string;
    nowMs?: number;
  }): ActionIdempotencyRegisterOk | ActionIdempotencyRegisterFail;
  clear(): void;
  size(): number;
};

/** In-memory registry for tests / local planning. Not a durable outbox. */
export function createActionIdempotencyRegistry(): ActionIdempotencyRegistry {
  const byKey = new Map<string, ActionIdempotencyRecord>();

  return {
    lookup(key: string) {
      return byKey.get(key) ?? null;
    },
    register(input) {
      const taskId = normalizePart(input.taskId);
      const logicalActionId = normalizePart(input.logicalActionId);
      if (!taskId) {
        return { ok: false, reason: "empty_task_id" };
      }
      if (!logicalActionId) {
        return { ok: false, reason: "empty_logical_action_id" };
      }
      const paramDigest = normalizePart(input.paramDigest);
      if (!paramDigest) {
        return { ok: false, reason: "empty_param_digest" };
      }
      const key = buildActionIdempotencyKey({
        tenantId: input.tenantId,
        taskId,
        logicalActionId,
      });
      const existing = byKey.get(key);
      if (existing) {
        if (existing.paramDigest !== paramDigest) {
          return {
            ok: false,
            reason: "param_digest_conflict",
            key,
            existingParamDigest: existing.paramDigest,
          };
        }
        return { ok: true, key, paramDigest, reused: true };
      }
      const registeredAtMs = input.nowMs ?? Date.now();
      byKey.set(key, { key, paramDigest, registeredAtMs });
      return { ok: true, key, paramDigest, reused: false };
    },
    clear() {
      byKey.clear();
    },
    size() {
      return byKey.size;
    },
  };
}
