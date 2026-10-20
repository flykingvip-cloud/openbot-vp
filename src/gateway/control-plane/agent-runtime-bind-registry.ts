import fs from "node:fs";
import path from "node:path";
import { normalizeAgentId } from "../../routing/session-key.js";
import type { AgentRuntimeStatus } from "../../shared/session-types.js";
import { CONFIG_DIR } from "../../utils.js";
import { requireTenantId } from "./agent-catalog-port.js";

/**
 * Minimal agent↔runtime bind registry (Phase 2 foundation).
 *
 * Verifiable bind + health beats “id exists in local agents.list”.
 * Shared path via OPENBOT_RUNTIME_BIND_REGISTRY_PATH for multi-Gateway SoT;
 * otherwise local CONFIG_DIR adapter (dev only).
 */

export type RuntimeBindHealth = "healthy" | "degraded" | "unhealthy" | "unknown";

export type AgentRuntimeBindRecord = {
  tenantId: string;
  agentId: string;
  runtimeId: string;
  health: RuntimeBindHealth;
  /** ISO timestamp of last heartbeat / health update. */
  lastHeartbeatAt?: string;
  updatedAt: string;
};

type BindRegistryStore = {
  version: 1;
  bindings: Record<string, AgentRuntimeBindRecord>;
};

function makeBindKey(tenantId: string, agentId: string): string {
  return `${tenantId}:${normalizeAgentId(agentId)}`;
}

function emptyStore(): BindRegistryStore {
  return { version: 1, bindings: {} };
}

function resolveRegistryPath(): string {
  const fromEnv = process.env.OPENBOT_RUNTIME_BIND_REGISTRY_PATH?.trim();
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv);
  }
  return path.join(CONFIG_DIR, "organization", "agent-runtime-bindings.json");
}

function readStore(filePath: string): BindRegistryStore {
  try {
    if (!fs.existsSync(filePath)) {
      return emptyStore();
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as BindRegistryStore;
  } catch {
    return emptyStore();
  }
}

function writeStore(filePath: string, store: BindRegistryStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function getAgentRuntimeBind(params: {
  tenantId: string;
  agentId: string;
}): AgentRuntimeBindRecord | null {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    return null;
  }
  const store = readStore(resolveRegistryPath());
  return store.bindings[makeBindKey(tid, params.agentId)] ?? null;
}

export function upsertAgentRuntimeBind(params: {
  tenantId: string;
  agentId: string;
  runtimeId: string;
  health?: RuntimeBindHealth;
  lastHeartbeatAt?: string;
}): AgentRuntimeBindRecord {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    throw new Error("tenantId required for runtime bind upsert");
  }
  const filePath = resolveRegistryPath();
  const store = readStore(filePath);
  const agentId = normalizeAgentId(params.agentId);
  const key = makeBindKey(tid, agentId);
  const previous = store.bindings[key];
  const now = new Date().toISOString();
  const next: AgentRuntimeBindRecord = {
    tenantId: tid,
    agentId,
    runtimeId: params.runtimeId.trim(),
    health: params.health ?? previous?.health ?? "unknown",
    lastHeartbeatAt: params.lastHeartbeatAt ?? previous?.lastHeartbeatAt,
    updatedAt: now,
  };
  store.bindings[key] = next;
  writeStore(filePath, store);
  return next;
}

/**
 * Map bind registry + host inventory into roster runtimeStatus.
 * Prefer registry when a bind record exists; fall back to inventory heuristics.
 */
export function resolveRuntimeStatusFromBindRegistry(params: {
  tenantId: string;
  agentId: string;
  runtimeId: string;
  explicitRuntimeIds: ReadonlySet<string>;
  catalogRuntimeBinding?: string | null;
  disabled?: boolean;
}): AgentRuntimeStatus {
  if (params.disabled) {
    return "unavailable";
  }
  const bind = getAgentRuntimeBind({
    tenantId: params.tenantId,
    agentId: params.agentId,
  });
  if (bind) {
    if (bind.runtimeId !== params.runtimeId) {
      return "unavailable";
    }
    if (bind.health === "unhealthy") {
      return "unavailable";
    }
    if (bind.health === "unknown" || bind.health === "degraded") {
      return params.explicitRuntimeIds.has(normalizeAgentId(params.agentId))
        ? "ready"
        : "provisioning";
    }
    // healthy
    return params.explicitRuntimeIds.has(normalizeAgentId(params.agentId))
      ? "ready"
      : "provisioning";
  }

  const binding = params.catalogRuntimeBinding?.trim();
  if (binding) {
    if (binding !== params.runtimeId) {
      return "unavailable";
    }
    return params.explicitRuntimeIds.has(normalizeAgentId(params.agentId))
      ? "ready"
      : "provisioning";
  }
  if (params.explicitRuntimeIds.has(normalizeAgentId(params.agentId))) {
    return "ready";
  }
  return "provisioning";
}
