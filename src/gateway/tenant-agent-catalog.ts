/**
 * Local-file catalog helpers + thin facade over AgentCatalogPort.
 *
 * Production multi-Gateway SoT is AgentCatalogPort (http/remote/memory), not CONFIG_DIR.
 */

import path from "node:path";
import { normalizeAgentId } from "../routing/session-key.js";
import type { GatewayAgentIdentity } from "../shared/session-types.js";
import { CONFIG_DIR } from "../utils.js";
import {
  createFileAgentCatalogSource,
  createInMemoryAgentCatalogPort,
  createLocalFileAgentCatalogPort,
  createRemoteAgentCatalogPort,
  makeCatalogEntityKey,
  requireTenantId,
  resolveAgentCatalogPort,
  setAgentCatalogPortForTests,
  type AgentCatalogEntity,
  type AgentCatalogPort,
  type AgentCatalogSource,
  type AgentCatalogStore,
} from "./control-plane/agent-catalog-port.js";

/** @deprecated Prefer AgentCatalogEntity */
export type TenantAgentCatalogEntry = AgentCatalogEntity;
/** @deprecated Prefer AgentCatalogStore */
export type TenantAgentCatalogStore = AgentCatalogStore;
/** @deprecated Prefer AgentCatalogSource */
export type TenantAgentCatalogSource = AgentCatalogSource;

const DEFAULT_LOCAL_FILE = path.join(CONFIG_DIR, "organization", "agent-catalog.json");

let activeLocalSource: AgentCatalogSource = createFileAgentCatalogSource(DEFAULT_LOCAL_FILE);

export function createFileTenantAgentCatalogSource(
  storeFile: string = DEFAULT_LOCAL_FILE,
): AgentCatalogSource {
  return createFileAgentCatalogSource(storeFile);
}

export function setTenantAgentCatalogSourceForTests(source: AgentCatalogSource | null): void {
  activeLocalSource = source ?? createFileAgentCatalogSource(DEFAULT_LOCAL_FILE);
  setAgentCatalogPortForTests(null);
}

export {
  createLocalFileAgentCatalogPort,
  createRemoteAgentCatalogPort,
  createInMemoryAgentCatalogPort,
  resolveAgentCatalogPort,
  setAgentCatalogPortForTests,
  requireTenantId,
  makeCatalogEntityKey,
};
export type { AgentCatalogPort, AgentCatalogEntity };

export async function listTenantAgentCatalogEntries(params?: {
  tenantId?: string;
}): Promise<TenantAgentCatalogEntry[]> {
  const tid = requireTenantId(params?.tenantId);
  if (!tid) {
    return [];
  }
  return resolveAgentCatalogPort().listEntities(tid);
}

export async function getTenantAgentCatalogEntry(params: {
  tenantId: string;
  agentId: string;
}): Promise<TenantAgentCatalogEntry | null> {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    return null;
  }
  return resolveAgentCatalogPort().getEntity(tid, params.agentId);
}

export async function upsertTenantAgentCatalogEntry(params: {
  tenantId: string;
  agentId: string;
  name?: string | null;
  identity?: GatewayAgentIdentity | null;
  ownerId?: string | null;
  ownerName?: string | null;
  scope?: string | null;
  shareStatus?: string | null;
  runtimeBinding?: string | null;
  disabled?: boolean | null;
}): Promise<TenantAgentCatalogEntry> {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    throw new Error("tenantId required for catalog upsert (fail closed; no default tenant)");
  }
  const port = resolveAgentCatalogPort();
  const previous = await port.getEntity(tid, params.agentId);
  return port.upsertEntity({
    tenantId: tid,
    agentId: params.agentId,
    name: params.name?.trim() || previous?.name,
    identity: params.identity ?? previous?.identity,
    ownerId: params.ownerId?.trim() || previous?.ownerId,
    ownerName: params.ownerName?.trim() || previous?.ownerName,
    scope: params.scope?.trim() || previous?.scope,
    shareStatus: params.shareStatus?.trim() || previous?.shareStatus,
    runtimeBinding: params.runtimeBinding?.trim() || previous?.runtimeBinding,
    disabled: params.disabled ?? previous?.disabled,
  });
}

export type LocalAgentSeedRow = {
  id: string;
  name?: string;
  identity?: GatewayAgentIdentity;
  ownerId?: string;
  ownerName?: string;
  scope?: string;
  shareStatus?: string;
};

export async function seedTenantAgentCatalogFromLocalAgents(params: {
  tenantId: string;
  agents: LocalAgentSeedRow[];
  catalogPort?: AgentCatalogPort;
}): Promise<{ upserted: number; keys: string[] }> {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    throw new Error("tenantId required for catalog seed (fail closed)");
  }
  const port = params.catalogPort ?? resolveAgentCatalogPort();
  const keys: string[] = [];
  for (const agent of params.agents) {
    if (!agent?.id?.trim()) {
      continue;
    }
    const previous = await port.getEntity(tid, agent.id);
    const entry = await port.upsertEntity({
      tenantId: tid,
      agentId: agent.id,
      name: agent.name ?? previous?.name,
      identity: agent.identity ?? previous?.identity,
      ownerId: agent.ownerId ?? previous?.ownerId,
      ownerName: agent.ownerName ?? previous?.ownerName,
      scope: agent.scope ?? previous?.scope,
      shareStatus: agent.shareStatus ?? previous?.shareStatus,
    });
    keys.push(makeCatalogEntityKey(entry.tenantId, entry.agentId));
  }
  return { upserted: keys.length, keys };
}

export async function previewTenantAgentCatalogMigration(params: {
  tenantId: string;
  agents: LocalAgentSeedRow[];
  catalogPort?: AgentCatalogPort;
}): Promise<
  Array<{
    key: string;
    agentId: string;
    action: "create" | "update" | "conflict" | "skip" | "unchanged";
    name?: string;
  }>
> {
  const tid = requireTenantId(params.tenantId);
  if (!tid) {
    return params.agents
      .filter((agent) => agent?.id?.trim())
      .map((agent) => ({
        key: `?:${normalizeAgentId(agent.id)}`,
        agentId: normalizeAgentId(agent.id),
        action: "skip" as const,
        name: agent.name,
      }));
  }
  const port = params.catalogPort ?? resolveAgentCatalogPort();
  const preview: Array<{
    key: string;
    agentId: string;
    action: "create" | "update" | "conflict" | "skip" | "unchanged";
    name?: string;
  }> = [];
  for (const agent of params.agents) {
    if (!agent?.id?.trim()) {
      continue;
    }
    const agentId = normalizeAgentId(agent.id);
    const key = makeCatalogEntityKey(tid, agentId);
    const previous = await port.getEntity(tid, agentId);
    const nextName = agent.name?.trim() || previous?.name;
    let action: "create" | "update" | "conflict" | "skip" | "unchanged" = "create";
    if (previous) {
      if (previous.disabled) {
        action = "conflict";
      } else {
        const same =
          (previous.name ?? "") === (nextName ?? "") &&
          (previous.ownerId ?? "") === (agent.ownerId?.trim() ?? previous.ownerId ?? "") &&
          (previous.scope ?? "") === (agent.scope?.trim() ?? previous.scope ?? "");
        action = same ? "unchanged" : "update";
      }
    }
    preview.push({ key, agentId, action, name: nextName });
  }
  return preview;
}

export function getActiveLocalCatalogSourceForTests(): AgentCatalogSource {
  return activeLocalSource;
}
