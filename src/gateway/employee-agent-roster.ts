import type { OpenBotConfig } from "../config/config.js";
import { normalizeAgentId } from "../routing/session-key.js";
import type { AgentRuntimeStatus, GatewayAgentRow } from "../shared/session-types.js";
import {
  classifyCatalogEntitlement,
  requireTenantId,
  resolveAgentCatalogPort,
  type AgentCatalogEntity,
  type AgentCatalogPort,
} from "./control-plane/agent-catalog-port.js";
import { resolveRuntimeStatusFromBindRegistry } from "./control-plane/agent-runtime-bind-registry.js";
import type { EmployeeWorkbenchActor } from "./employee-workbench-scope.js";
import { listAgentsForGateway } from "./session-utils.js";

export type { AgentRuntimeStatus };

export type RosterGatewayAgentRow = GatewayAgentRow & {
  runtimeStatus?: AgentRuntimeStatus;
  integrity?: "catalog_missing";
};

function catalogEntityToRow(entry: AgentCatalogEntity): RosterGatewayAgentRow {
  return {
    id: entry.agentId,
    name: entry.name,
    identity: entry.identity,
    ownerId: entry.ownerId,
    ownerName: entry.ownerName,
    scope: entry.scope,
    shareStatus: entry.shareStatus,
  };
}

function mergeRow(
  base: RosterGatewayAgentRow | undefined,
  overlay: RosterGatewayAgentRow | undefined,
): RosterGatewayAgentRow {
  const id = overlay?.id ?? base?.id ?? "";
  return {
    id,
    name: overlay?.name ?? base?.name,
    identity: overlay?.identity ?? base?.identity,
    ownerId: overlay?.ownerId ?? base?.ownerId,
    ownerName: overlay?.ownerName ?? base?.ownerName,
    scope: overlay?.scope ?? base?.scope,
    shareStatus: overlay?.shareStatus ?? base?.shareStatus,
  };
}

function resolveRuntimeId(_cfg: OpenBotConfig): string {
  return process.env.OPENBOT_RUNTIME_ID?.trim() || "local-gateway";
}

/** @deprecated Prefer resolveRuntimeStatusFromBindRegistry — kept for unit tests. */
export function resolveAgentRuntimeStatus(params: {
  agentId: string;
  entity: AgentCatalogEntity | null | undefined;
  explicitRuntimeIds: ReadonlySet<string>;
  runtimeId: string;
  tenantId?: string;
}): AgentRuntimeStatus {
  return resolveRuntimeStatusFromBindRegistry({
    tenantId: params.tenantId ?? params.entity?.tenantId ?? "",
    agentId: params.agentId,
    runtimeId: params.runtimeId,
    explicitRuntimeIds: params.explicitRuntimeIds,
    catalogRuntimeBinding: params.entity?.runtimeBinding,
    disabled: params.entity?.disabled,
  });
}

export async function projectEmployeeAgentRoster(params: {
  actor: EmployeeWorkbenchActor;
  cfg: OpenBotConfig;
  catalogPort?: AgentCatalogPort;
}): Promise<RosterGatewayAgentRow[]> {
  const { actor, cfg } = params;
  const tenantId = requireTenantId(actor.tenantId);
  if (!tenantId) {
    return [];
  }

  const catalogPort = params.catalogPort ?? resolveAgentCatalogPort();
  const gatewayList = listAgentsForGateway(cfg);
  const runtimeById = new Map(
    gatewayList.agents.map((row) => [normalizeAgentId(row.id), row] as const),
  );
  const explicitRuntimeIds = new Set(
    (cfg.agents?.list ?? [])
      .map((entry) => (entry?.id ? normalizeAgentId(entry.id) : ""))
      .filter(Boolean),
  );
  const runtimeId = resolveRuntimeId(cfg);

  const entitledIds = new Set(actor.seatAgentIds.map((id) => normalizeAgentId(id)).filter(Boolean));

  const rows: RosterGatewayAgentRow[] = [];
  for (const agentId of entitledIds) {
    const entity = await catalogPort.getEntity(tenantId, agentId);
    const integrity = classifyCatalogEntitlement({
      tenantId,
      agentId,
      entitledIds,
      entity,
    });
    if (integrity === "tenant_missing" || integrity === "not_entitled") {
      continue;
    }
    const catalogRow = entity ? catalogEntityToRow(entity) : undefined;
    const runtimeRow = runtimeById.get(agentId);
    const row = mergeRow(catalogRow, runtimeRow ? { ...runtimeRow } : catalogRow);
    const runtimeStatus = resolveRuntimeStatusFromBindRegistry({
      tenantId,
      agentId,
      runtimeId,
      explicitRuntimeIds,
      catalogRuntimeBinding: entity?.runtimeBinding,
      disabled: entity?.disabled,
    });
    rows.push({
      id: agentId,
      name: row?.name ?? agentId,
      identity: row?.identity,
      ownerId: row?.ownerId,
      ownerName: row?.ownerName,
      scope: row?.scope,
      shareStatus: row?.shareStatus,
      runtimeStatus,
      ...(integrity === "catalog_missing" ? { integrity: "catalog_missing" as const } : {}),
    });
  }
  return rows;
}

export async function listAgentsForEmployeeGateway(params: {
  actor: EmployeeWorkbenchActor;
  cfg: OpenBotConfig;
  catalogPort?: AgentCatalogPort;
}): Promise<{
  defaultId: string;
  mainKey: string;
  scope: ReturnType<typeof listAgentsForGateway>["scope"];
  agents: RosterGatewayAgentRow[];
  controlPlaneId: string;
  runtimeId: string;
}> {
  const base = listAgentsForGateway(params.cfg);
  const catalogPort = params.catalogPort ?? resolveAgentCatalogPort();
  return {
    ...base,
    agents: await projectEmployeeAgentRoster({ ...params, catalogPort }),
    controlPlaneId: catalogPort.controlPlaneId,
    runtimeId: resolveRuntimeId(params.cfg),
  };
}
