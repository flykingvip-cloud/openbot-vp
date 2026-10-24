/**
 * WP-05 — Read-only single-path ActionBinding for orchestration pilot surfaces.
 *
 * Server-authoritative path selection (client path claims ignored). Default path
 * is `legacy`. Fabric path is opt-in via env and still executes the **same**
 * read-only adapter at most once (optional decide-only gate via injected check).
 * Does not unlock ORCHESTRATION_LIVE_INVOKE. Does not dual-exec.
 */

import type { ExecutionSurface } from "./types.js";

export type ReadonlyPilotPath = "legacy" | "fabric";

/** Env: set to `fabric` to force fabric path for pilot readonly surfaces; default legacy. */
export const ORCH_READONLY_PATH_PILOT_ENV = "OPENBOT_ORCH_READONLY_PATH_PILOT" as const;

export type ReadonlyActionBinding = {
  actionId: string;
  policyVersion: string | null;
  path: ReadonlyPilotPath;
  surface: ExecutionSurface;
  toolNameHint: string;
  tenantId: string | null;
  correlationId: string;
  boundAtMs: number;
};

export type ReadonlyPilotPolicyCheck = {
  decision: "ALLOW" | "DENY" | "MODIFY";
  reason?: string;
};

const READONLY_PILOT_SURFACES = new Set<ExecutionSurface>(["memory", "web_read", "skill"]);

/** In-process dual-exec guard (one binding registry per process). */
const boundByActionId = new Map<string, ReadonlyActionBinding>();

export function isReadonlyPilotSurface(surface: ExecutionSurface): boolean {
  return READONLY_PILOT_SURFACES.has(surface);
}

export function resolveReadonlyPilotPath(env: NodeJS.ProcessEnv = process.env): ReadonlyPilotPath {
  const raw = env[ORCH_READONLY_PATH_PILOT_ENV]?.trim().toLowerCase();
  return raw === "fabric" ? "fabric" : "legacy";
}

export function toolNameHintForSurface(surface: ExecutionSurface): string {
  if (surface === "memory") {
    return "memory_search";
  }
  if (surface === "web_read") {
    return "web_read";
  }
  if (surface === "skill") {
    return "skill_snapshot";
  }
  return surface;
}

export function clearReadonlyPathBindingsForTests(): void {
  boundByActionId.clear();
}

/**
 * Bind a single path for this actionId. Second bind with same id → dual_exec_refused.
 * Non-pilot surfaces return null (no binding required).
 */
export function bindReadonlyPilotAction(params: {
  surface: ExecutionSurface;
  actionId: string;
  correlationId?: string;
  tenantId?: string | null;
  policyVersion?: string | null;
  env?: NodeJS.ProcessEnv;
  nowMs?: number;
}): { ok: true; binding: ReadonlyActionBinding } | { ok: false; reason: string } {
  if (!isReadonlyPilotSurface(params.surface)) {
    return { ok: false, reason: "not_readonly_pilot_surface" };
  }
  const actionId = params.actionId.trim();
  if (!actionId) {
    return { ok: false, reason: "action_id_required" };
  }
  const existing = boundByActionId.get(actionId);
  if (existing) {
    return { ok: false, reason: "dual_exec_refused" };
  }
  const binding: ReadonlyActionBinding = {
    actionId,
    policyVersion: params.policyVersion ?? null,
    path: resolveReadonlyPilotPath(params.env ?? process.env),
    surface: params.surface,
    toolNameHint: toolNameHintForSurface(params.surface),
    tenantId: params.tenantId ?? null,
    correlationId: (params.correlationId ?? actionId).trim() || actionId,
    boundAtMs: params.nowMs ?? Date.now(),
  };
  boundByActionId.set(actionId, binding);
  return { ok: true, binding };
}

export function getReadonlyPathBinding(actionId: string): ReadonlyActionBinding | undefined {
  return boundByActionId.get(actionId.trim());
}

/** Release binding after a completed (or abandoned) invoke — tests / idempotent cleanup. */
export function releaseReadonlyPathBinding(actionId: string): void {
  boundByActionId.delete(actionId.trim());
}
