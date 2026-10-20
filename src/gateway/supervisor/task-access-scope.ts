/**
 * Session-authoritative access scope for supervised tasks.
 *
 * Personal workbench sessions (employee / enterprise self-view) resolve identity
 * from trusted session attribution (platform user id) — the same authority cron
 * personal scope uses — and ignore client-supplied userId/tenantId for authz.
 * Local/CLI callers without a personal session keep a legacy soft filter.
 */

import { resolveTrustedAttribution } from "../scope-attribution.js";
import type { GatewayClient } from "../server-methods/types.js";
import type { SupervisedTask } from "./types.js";

export type SupervisorTaskActor = {
  userId: string;
  userEmail: string;
  tenantId?: string;
};

export type SupervisorTaskSessionScope = {
  kind: "session";
  actor: SupervisorTaskActor;
};

export type SupervisorTaskLegacyScope = {
  kind: "legacy";
  /** Optional soft filters from request params (not authoritative). */
  tenantId?: string;
  userId?: string;
};

export type SupervisorTaskAccessScope = SupervisorTaskSessionScope | SupervisorTaskLegacyScope;

const PERSONAL_WORKBENCH_SESSION_DOMAINS = new Set(["employee", "enterprise"]);

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

export function isPersonalWorkbenchSupervisorClient(
  client: GatewayClient | null | undefined,
): boolean {
  return Boolean(
    client?.sessionDomain && PERSONAL_WORKBENCH_SESSION_DOMAINS.has(client.sessionDomain),
  );
}

export function buildSupervisorActorIdentities(actor: SupervisorTaskActor): Set<string> {
  return new Set(
    [actor.userId, actor.userEmail].map((entry) => normalizeIdentity(entry)).filter(Boolean),
  );
}

/**
 * Whether the supervised task belongs to the session actor.
 * Orphan tasks (missing userId) are never owned — they must not appear in "我的任务".
 * Legacy email-stamped tasks still match via actor.userEmail during migration.
 */
export function actorOwnsSupervisedTask(
  task: Pick<SupervisedTask, "userId" | "tenantId">,
  actor: SupervisorTaskActor,
): boolean {
  const taskUserId = normalizeIdentity(task.userId);
  if (!taskUserId) {
    return false;
  }
  if (!buildSupervisorActorIdentities(actor).has(taskUserId)) {
    return false;
  }
  const actorTenant = actor.tenantId?.trim();
  const taskTenant = task.tenantId?.trim();
  if (actorTenant && taskTenant && actorTenant !== taskTenant) {
    return false;
  }
  return true;
}

/** Soft filter used only when no personal workbench session is present. */
export function matchesLegacySupervisorTaskFilter(
  task: Pick<SupervisedTask, "userId" | "tenantId">,
  filter: { tenantId?: string; userId?: string },
): boolean {
  if (filter.tenantId && task.tenantId != null && task.tenantId !== filter.tenantId) {
    return false;
  }
  if (filter.userId && task.userId != null && task.userId !== filter.userId) {
    return false;
  }
  return true;
}

export function isSupervisedTaskVisibleToScope(
  task: Pick<SupervisedTask, "userId" | "tenantId">,
  scope: SupervisorTaskAccessScope,
): boolean {
  if (scope.kind === "session") {
    return actorOwnsSupervisedTask(task, scope.actor);
  }
  return matchesLegacySupervisorTaskFilter(task, scope);
}

async function resolveSessionActor(client: GatewayClient): Promise<SupervisorTaskActor | null> {
  const attribution = await resolveTrustedAttribution(client);
  const userId = attribution.ownerId?.trim();
  if (!userId) {
    return null;
  }
  const userEmail = client.user?.trim() ?? "";
  const tenantId = attribution.tenantId?.trim();
  return {
    userId,
    userEmail,
    ...(tenantId ? { tenantId } : {}),
  };
}

/**
 * Resolve list/mutate scope for supervised-task RPCs.
 * - Personal workbench session → session actor (fail closed to null when unresolved).
 * - Otherwise → legacy soft filter from optional request params.
 */
export async function resolveSupervisorTaskAccessScope(params: {
  client: GatewayClient | null | undefined;
  requestedTenantId?: string;
  requestedUserId?: string;
}): Promise<SupervisorTaskAccessScope | null> {
  if (isPersonalWorkbenchSupervisorClient(params.client) && params.client) {
    const actor = await resolveSessionActor(params.client);
    if (!actor) {
      return null;
    }
    return { kind: "session", actor };
  }
  return {
    kind: "legacy",
    ...(params.requestedTenantId ? { tenantId: params.requestedTenantId } : {}),
    ...(params.requestedUserId ? { userId: params.requestedUserId } : {}),
  };
}

/** Identity fields stamped on create — session wins over client params. */
export function resolveSupervisedTaskCreateIdentity(params: {
  scope: SupervisorTaskAccessScope;
  requestedTenantId?: string;
  requestedUserId?: string;
}): { tenantId?: string; userId?: string } {
  if (params.scope.kind === "session") {
    return {
      userId: params.scope.actor.userId,
      ...(params.scope.actor.tenantId?.trim()
        ? { tenantId: params.scope.actor.tenantId.trim() }
        : params.requestedTenantId
          ? { tenantId: params.requestedTenantId }
          : {}),
    };
  }
  return {
    ...(params.requestedTenantId ? { tenantId: params.requestedTenantId } : {}),
    ...(params.requestedUserId ? { userId: params.requestedUserId } : {}),
  };
}
