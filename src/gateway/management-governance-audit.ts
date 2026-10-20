import fs from "node:fs/promises";
import {
  accessControlAuditPaths,
  emitManagementGovernanceAudit,
  type ManagementGovernanceAuditEvent,
} from "./access-control/audit-sink.js";
import type { QueryScope } from "./scope-attribution.js";
import type { GatewayClient } from "./server-methods/types.js";

function resolveAuditRole(
  client: GatewayClient | null,
): ManagementGovernanceAuditEvent["actor"]["role"] {
  if (!client?.sessionDomain) {
    return "local-operator";
  }
  if (client.sessionDomain === "platform") {
    return client.sessionKind === "platform-super-admin"
      ? "platform-super-admin"
      : "platform-admin";
  }
  if (client.sessionDomain === "enterprise") {
    return "tenant-admin";
  }
  return "employee-supervisor";
}

export async function auditManagementDecision(params: {
  client: GatewayClient | null;
  scope: QueryScope;
  action: ManagementGovernanceAuditEvent["action"];
  target: ManagementGovernanceAuditEvent["target"];
  effect: ManagementGovernanceAuditEvent["effect"];
  reason?: string;
  requestId?: string;
}): Promise<void> {
  await emitManagementGovernanceAudit({
    ts: new Date().toISOString(),
    ...(params.requestId ? { requestId: params.requestId } : {}),
    actor: {
      role: resolveAuditRole(params.client),
      subjectId: params.client?.user?.trim().toLowerCase() || "local-operator",
      scope:
        params.scope.kind === "self" || params.scope.kind === "none"
          ? "employee"
          : params.scope.kind,
    },
    action: params.action,
    target: params.target,
    effect: params.effect,
    ...(params.reason ? { reason: params.reason } : {}),
  });
}

export type ManagementAuditQuery = {
  action?: ManagementGovernanceAuditEvent["action"];
  effect?: ManagementGovernanceAuditEvent["effect"];
  actorId?: string;
  resourceId?: string;
  from?: string;
  to?: string;
  limit?: number;
};

function isManagementAuditEvent(value: unknown): value is ManagementGovernanceAuditEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const event = value as Partial<ManagementGovernanceAuditEvent>;
  return Boolean(
    typeof event.ts === "string" &&
    event.actor &&
    typeof event.actor.subjectId === "string" &&
    event.target &&
    typeof event.target.resourceId === "string" &&
    typeof event.action === "string" &&
    (event.effect === "allowed" || event.effect === "denied"),
  );
}

function isVisibleToScope(event: ManagementGovernanceAuditEvent, scope: QueryScope): boolean {
  if (scope.kind === "platform") {
    return true;
  }
  if (scope.kind === "tenant") {
    return event.target.tenantId === scope.tenantId;
  }
  if (scope.kind === "self") {
    return event.target.ownerUserId === scope.ownerId;
  }
  return false;
}

function matchesQuery(event: ManagementGovernanceAuditEvent, query: ManagementAuditQuery): boolean {
  if (query.action && event.action !== query.action) {
    return false;
  }
  if (query.effect && event.effect !== query.effect) {
    return false;
  }
  if (query.actorId && event.actor.subjectId !== query.actorId.trim().toLowerCase()) {
    return false;
  }
  if (query.resourceId && event.target.resourceId !== query.resourceId) {
    return false;
  }
  if (query.from && event.ts < query.from) {
    return false;
  }
  if (query.to && event.ts > query.to) {
    return false;
  }
  return true;
}

export function filterManagementAuditEvents(params: {
  events: ManagementGovernanceAuditEvent[];
  scope: QueryScope;
  query?: ManagementAuditQuery;
}): ManagementGovernanceAuditEvent[] {
  const query = params.query ?? {};
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  return params.events
    .filter((event) => isVisibleToScope(event, params.scope) && matchesQuery(event, query))
    .toSorted((left, right) => right.ts.localeCompare(left.ts))
    .slice(0, limit);
}

export async function listManagementAuditEvents(params: {
  scope: QueryScope;
  query?: ManagementAuditQuery;
}): Promise<ManagementGovernanceAuditEvent[]> {
  let raw: string;
  try {
    raw = await fs.readFile(accessControlAuditPaths().managementGovernance, "utf8");
  } catch {
    return [];
  }
  const events: ManagementGovernanceAuditEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event: unknown = JSON.parse(line);
      if (isManagementAuditEvent(event)) {
        events.push(event);
      }
    } catch {
      // One malformed line must not hide the rest of the append-only audit stream.
    }
  }
  return filterManagementAuditEvents({ events, scope: params.scope, query: params.query });
}
