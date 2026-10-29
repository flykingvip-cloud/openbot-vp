import type { FinalDecisionPolicy } from "@openbot/collaboration-core";
import { loadConfig } from "../../config/config.js";
import {
  withSpaceEffectivePolicy,
  type SpaceEffectivePolicySource,
} from "../collaboration-dispatch/policy-lane-presentation.js";
import {
  dissolveGatewayCollaborationSpace,
  leaveGatewayCollaborationSpace,
  listGatewayCollaborationSpaces,
  loadGroupCharterForRuntime,
  resetGatewayCollaborationSpace,
  resolveCollaborationTransitionError,
  transferGatewayCollaborationSpaceOwnership,
  updateGatewayCollaborationSpaceMembers,
} from "../collaboration-learning.js";
import { advanceCollaborationGroupMissionFromOnboarding } from "../collaboration-learning/mission-advance.js";
import { resolveMembershipTenantIdForAcl } from "../collaboration-learning/trusted-tenant.js";
import { listCollaborationOrgBotDirectoryForActor } from "../collaboration-org-bot-directory.js";
import {
  buildArchivedCollaborationGroupIdSet,
  filterCollaborationSpacesForEmployeeActor,
  isCollaborationSpaceVisibleToEmployeeUser,
  isPersonalWorkbenchClient,
  resolveCollaborationSpaceMutateDenial,
  resolveEmployeeWorkbenchActor,
  type EmployeeWorkbenchActor,
} from "../employee-workbench-scope.js";
import {
  ErrorCodes,
  errorShape,
  validateCollaborationOrgBotDirectoryListParams,
  validateCollaborationSpaceMembersUpdateParams,
  validateCollaborationSpaceLeaveParams,
  validateCollaborationSpaceOwnershipTransferParams,
  validateCollaborationSpaceDissolveParams,
  validateCollaborationSpaceResetParams,
  validateCollaborationSpaceMissionAdvanceParams,
  validateCollaborationSpacesListParams,
} from "../protocol/index.js";
import { isRecord } from "../records.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { buildSessionStorePathResolver } from "../tenant-context.js";
import { broadcastWorkbenchSignalsInvalidate } from "../workbench/signals-invalidate.js";
import { loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { provisionManagedGroupMembersForListedSpaces } from "../workspace/managed-group-members-provision.js";
import type { GatewayRequestHandlers } from "./types.js";
import { assertValidParams } from "./validation.js";

function isEmployeeVisibleCollaborationSpace(
  space: object,
): space is Parameters<typeof isCollaborationSpaceVisibleToEmployeeUser>[0] {
  return isRecord(space);
}

function spaceGroupId(space: { groupId?: string; id?: string }): string {
  const groupId = typeof space.groupId === "string" ? space.groupId.trim() : "";
  if (groupId) {
    return groupId;
  }
  const id = typeof space.id === "string" ? space.id.trim() : "";
  return id.replace(/^space:/, "");
}

/** Managed list keeps catalog-visible spaces even when C5 members.json is empty;
 *  send-path / list-path provision writes UUID members.json so write ACL matches.
 */
async function filterSpacesByManagedWriteAuthority<T extends { groupId?: string; id?: string }>(
  spaces: T[],
  client: Parameters<GatewayRequestHandlers["spaces.list"]>[0]["client"],
  actor?: EmployeeWorkbenchActor | null,
): Promise<T[]> {
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  if (profile.profile !== "managed_enterprise") {
    return spaces;
  }
  // Track D fail-closed: managed write ACL uses membership only (no actor fallback).
  const tenantId = await resolveMembershipTenantIdForAcl(client);
  if (!tenantId) {
    return [];
  }
  const kept: T[] = [];
  for (const space of spaces) {
    const groupId = spaceGroupId(space);
    if (!groupId) {
      continue;
    }
    try {
      const members = await loadAuthoritativeGroupMembers({
        groupId,
        tenantId,
        profile: "managed_enterprise",
        cfg,
      });
      if (members.length > 0) {
        kept.push(space);
        continue;
      }
    } catch {
      // Catalog-visible but tenant ACL unreadable — hide unless the actor owns it.
    }
    // User-scoped owned spaces are not in tenants/<tid>/collaboration/groups.
    // Do not hide owners when the tenant catalog is incomplete.
    if (
      actor &&
      isEmployeeVisibleCollaborationSpace(space) &&
      isCollaborationSpaceVisibleToEmployeeUser(space, actor)
    ) {
      kept.push(space);
    }
  }
  return kept;
}

function collectCollaborationSignalsUserIds(space: unknown): string[] {
  if (!space || typeof space !== "object") {
    return [];
  }
  const record = space as {
    ownerUserId?: string | null;
    members?: {
      humans?: Array<{ userId?: string | null; status?: string | null }> | null;
      bots?: Array<{ ownerUserId?: string | null; status?: string | null }> | null;
    } | null;
    invites?: {
      humans?: Array<{ userId?: string | null; status?: string | null }> | null;
      bots?: Array<{ ownerUserId?: string | null; status?: string | null }> | null;
    } | null;
  };
  const ids = new Set<string>();
  const push = (value: string | null | undefined) => {
    const normalized = value?.trim();
    if (normalized) {
      ids.add(normalized);
    }
  };
  push(record.ownerUserId);
  for (const human of [...(record.members?.humans ?? []), ...(record.invites?.humans ?? [])]) {
    const status = human.status?.trim().toLowerCase();
    if (
      status === "invited" ||
      status === "pending" ||
      status === "active" ||
      status === "paused"
    ) {
      push(human.userId);
    }
  }
  for (const bot of [...(record.members?.bots ?? []), ...(record.invites?.bots ?? [])]) {
    const status = bot.status?.trim().toLowerCase();
    if (status === "invited" || status === "pending") {
      push(bot.ownerUserId);
    }
  }
  return [...ids];
}

function resolveActorId(actor: unknown) {
  return typeof actor === "string" && actor.trim().length > 0 ? actor.trim() : undefined;
}

function resolveClientActorId(
  client: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0]["client"],
) {
  const connect = client?.connect;
  const legacyConnectUser =
    isRecord(connect) && "user" in connect ? resolveActorId(connect.user) : undefined;
  return resolveActorId(client?.user) ?? legacyConnectUser;
}

function resolveFinalDecisionPolicy(value: {
  mode?: string;
  defaultFinalDeciderRole?: string;
  allowAgentPublishProposal?: boolean;
}): FinalDecisionPolicy | undefined {
  if (value.mode !== "human_required" && value.mode !== "delegated_low_risk") {
    return undefined;
  }
  return {
    mode: value.mode,
    defaultFinalDeciderRole: value.defaultFinalDeciderRole === "admin" ? "admin" : "owner",
    allowAgentPublishProposal: value.allowAgentPublishProposal === true,
  };
}

/**
 * Read the auto-archive notice fields used only for the dissolve broadcast.
 * The RPC response still returns the original payload. A non-finite
 * archivedAtMs skips the broadcast; the old cast would have forwarded it.
 */
function readAutoArchivedNotice(payload: unknown): {
  archivedAtMs: number;
  notificationMessage?: string;
  title?: string;
} | null {
  if (!isRecord(payload) || payload.autoArchived !== true) {
    return null;
  }
  const archivedAtMs = payload.archivedAtMs;
  if (typeof archivedAtMs !== "number" || !Number.isFinite(archivedAtMs)) {
    return null;
  }
  const space = isRecord(payload.space) ? payload.space : null;
  const title = typeof space?.title === "string" ? space.title : undefined;
  const notificationMessage =
    typeof payload.notificationMessage === "string" ? payload.notificationMessage : undefined;
  return {
    archivedAtMs,
    ...(notificationMessage !== undefined ? { notificationMessage } : {}),
    ...(title !== undefined ? { title } : {}),
  };
}

function broadcastCollaborationSpaceDissolved(
  context: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0]["context"],
  payload: {
    groupId: string;
    title?: string;
    message?: string;
    dissolvedAtMs: number;
    notifiedUserIds?: string[];
  },
) {
  context.broadcast?.("collaboration.space.dissolved", {
    groupId: payload.groupId,
    title: payload.title,
    message: payload.message,
    notifiedUserIds: payload.notifiedUserIds ?? [],
    dissolvedAtMs: payload.dissolvedAtMs,
  });
}

async function provisionListedManagedSpaces<T extends { groupId?: string; id?: string }>(
  spaces: T[],
  client: Parameters<GatewayRequestHandlers["spaces.list"]>[0]["client"],
  actor?: EmployeeWorkbenchActor | null,
): Promise<T[]> {
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg, process.env);
  if (profile.profile !== "managed_enterprise" || spaces.length === 0) {
    return spaces;
  }
  // Track D fail-closed: provision under membership tenant only.
  const tenantId = await resolveMembershipTenantIdForAcl(client);
  if (!tenantId) {
    return spaces;
  }
  try {
    await provisionManagedGroupMembersForListedSpaces({
      tenantId,
      cfg,
      spaces,
      actor,
    });
  } catch {
    // List must still return catalog-visible spaces; chat.send retries C5 repair.
  }
  return spaces;
}

async function handleCollaborationSpacesList({
  params,
  respond,
  method,
  client,
}: Parameters<GatewayRequestHandlers["spaces.list"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpacesListParams, method, respond)) {
    return;
  }
  const payload = await listGatewayCollaborationSpaces();
  const archivedGroupIds = [...buildArchivedCollaborationGroupIdSet(payload.spaces ?? [])];
  // Default is personal/self. Tenant-wide list is opt-in for 机巢治理 only —
  // enterprise-admin personal workbench must not inherit the mesh catalog.
  const wantsTenantScope = isRecord(params) && params.scope === "tenant";
  if (wantsTenantScope && client?.sessionDomain === "enterprise") {
    const { filterSpacesForEnterpriseTenantClient } =
      await import("../enterprise-tenant-roster-scope.js");
    const tenantSpaces = await filterSpacesForEnterpriseTenantClient(client, payload.spaces ?? []);
    respond(
      true,
      {
        ...payload,
        spaces: withSpacesEffectivePolicy(
          await provisionListedManagedSpaces(
            await filterSpacesByManagedWriteAuthority(tenantSpaces ?? [], client, null),
            client,
            null,
          ),
        ),
        archivedGroupIds,
      },
      undefined,
    );
    return;
  }
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (actor) {
    const scoped = filterCollaborationSpacesForEmployeeActor(payload.spaces ?? [], actor);
    respond(
      true,
      {
        ...payload,
        spaces: withSpacesEffectivePolicy(
          await provisionListedManagedSpaces(
            await filterSpacesByManagedWriteAuthority(scoped, client, actor),
            client,
            actor,
          ),
        ),
        archivedGroupIds,
      },
      undefined,
    );
    return;
  }
  // A personal-workbench session (employee/enterprise) that fails to resolve an
  // actor must NOT fall through to the unscoped platform view — that would leak
  // every tenant's spaces to a brand-new / unresolved member. Return empty.
  // Also fail closed when a non-enterprise client asks for tenant scope.
  if (isPersonalWorkbenchClient(client) || wantsTenantScope) {
    respond(true, { ...payload, spaces: [], archivedGroupIds }, undefined);
    return;
  }
  respond(
    true,
    { ...payload, spaces: withSpacesEffectivePolicy(payload.spaces ?? []), archivedGroupIds },
    undefined,
  );
}

/**
 * P1-A5 ⑤ (BP-20): every listed space carries the server-compiled, frozen EffectivePolicy
 * + provenance (`effectivePolicy`). The UI renders it instead of compiling its own.
 */
function withSpacesEffectivePolicy<T extends SpaceEffectivePolicySource>(spaces: readonly T[]) {
  return spaces.map((space) => withSpaceEffectivePolicy(space));
}

async function handleCollaborationSpaceMembersUpdate({
  params,
  client,
  respond,
  context,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpaceMembersUpdateParams, method, respond)) {
    return;
  }
  const mutateDenial = await resolveCollaborationSpaceMutateDenial({
    client,
    groupId: typeof params.groupId === "string" ? params.groupId : "",
  });
  if (mutateDenial) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, mutateDenial));
    return;
  }
  try {
    const { finalDecisionPolicy: rawFinalDecisionPolicy, ...spaceParams } = params;
    const finalDecisionPolicy = rawFinalDecisionPolicy
      ? resolveFinalDecisionPolicy(rawFinalDecisionPolicy)
      : undefined;
    const cfg = loadConfig();
    const resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
    // Track D fail-closed: member mutations use membership tenant only.
    const trustedTenantId = await resolveMembershipTenantIdForAcl(client);
    const payload = await updateGatewayCollaborationSpaceMembers({
      ...spaceParams,
      ...(trustedTenantId ? { tenantId: trustedTenantId } : {}),
      ...(finalDecisionPolicy ? { finalDecisionPolicy } : {}),
      actor: resolveClientActorId(client),
      resolveAgentStorePath,
    });
    const archivedPayload = readAutoArchivedNotice(payload);
    if (archivedPayload) {
      broadcastCollaborationSpaceDissolved(context, {
        groupId: params.groupId,
        title:
          archivedPayload.title ?? (typeof params.title === "string" ? params.title : undefined),
        message: archivedPayload.notificationMessage,
        dissolvedAtMs: archivedPayload.archivedAtMs,
      });
    }
    const space = isRecord(payload) && "space" in payload ? payload.space : undefined;
    const signalUserIds = collectCollaborationSignalsUserIds(space);
    const actorId = resolveClientActorId(client);
    if (actorId) {
      signalUserIds.push(actorId);
    }
    broadcastWorkbenchSignalsInvalidate({
      reason: "collaboration",
      ...(signalUserIds.length > 0 ? { userIds: signalUserIds } : {}),
    });
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationSpaceDissolve({
  params,
  client,
  respond,
  context,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpaceDissolveParams, method, respond)) {
    return;
  }
  try {
    const payload = await dissolveGatewayCollaborationSpace({
      ...params,
      actor: resolveClientActorId(client),
    });
    broadcastCollaborationSpaceDissolved(context, {
      groupId: payload.groupId,
      title: payload.title,
      message: payload.notificationMessage,
      notifiedUserIds: payload.notifiedUserIds,
      dissolvedAtMs: payload.dissolvedAtMs,
    });
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationSpaceReset({
  params,
  client,
  respond,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpaceResetParams, method, respond)) {
    return;
  }
  try {
    const cfg = loadConfig();
    const resolveAgentStorePath = await buildSessionStorePathResolver(client, cfg);
    const payload = await resetGatewayCollaborationSpace({
      ...params,
      actor: resolveClientActorId(client),
      resolveAgentStorePath,
    });
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationSpaceLeave({
  params,
  client,
  respond,
  context,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpaceLeaveParams, method, respond)) {
    return;
  }
  try {
    const payload = await leaveGatewayCollaborationSpace({
      ...params,
      actor: resolveClientActorId(client),
    });
    const archivedPayload = readAutoArchivedNotice(payload);
    if (archivedPayload) {
      broadcastCollaborationSpaceDissolved(context, {
        groupId: params.groupId,
        title: archivedPayload.title,
        message: archivedPayload.notificationMessage,
        dissolvedAtMs: archivedPayload.archivedAtMs,
      });
    }
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationSpaceOwnershipTransfer({
  params,
  client,
  respond,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (
    !assertValidParams(params, validateCollaborationSpaceOwnershipTransferParams, method, respond)
  ) {
    return;
  }
  try {
    const payload = await transferGatewayCollaborationSpaceOwnership({
      ...params,
      actor: resolveClientActorId(client),
    });
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationSpaceMissionAdvance({
  params,
  client,
  respond,
  method,
}: Parameters<GatewayRequestHandlers["spaces.members.update"]>[0] & { method: string }) {
  if (!assertValidParams(params, validateCollaborationSpaceMissionAdvanceParams, method, respond)) {
    return;
  }
  try {
    const payload = await advanceCollaborationGroupMissionFromOnboarding({
      groupId: params.groupId,
      actor: resolveClientActorId(client),
    });
    respond(true, payload, undefined);
  } catch (error) {
    respond(
      false,
      undefined,
      errorShape(
        ErrorCodes.INVALID_REQUEST,
        resolveCollaborationTransitionError(error) ?? String(error),
      ),
    );
  }
}

async function handleCollaborationOrgBotDirectoryList({
  respond,
  method,
  client,
}: Parameters<GatewayRequestHandlers["spaces.list"]>[0] & { method: string }) {
  if (!assertValidParams({}, validateCollaborationOrgBotDirectoryListParams, method, respond)) {
    return;
  }
  const actor = await resolveEmployeeWorkbenchActor(client);
  if (!actor?.tenantId) {
    // Soft-degrade: empty directory keeps UI online instead of TENANT_CONTEXT_REQUIRED
    // reconnect/offline loops (incident 2026-10-29 NIGHT collab).
    respond(
      true,
      {
        bots: [],
        degraded: true,
        reasonCode: "TENANT_CONTEXT_REQUIRED",
      },
      undefined,
    );
    return;
  }
  const bots = await listCollaborationOrgBotDirectoryForActor(actor, { client });
  respond(true, { bots }, undefined);
}

export const spacesHandlers: GatewayRequestHandlers = {
  "collaboration.directory.bots.list": async (ctx) =>
    handleCollaborationOrgBotDirectoryList({
      ...ctx,
      method: "collaboration.directory.bots.list",
    }),
  "collaboration.spaces.list": async (ctx) =>
    handleCollaborationSpacesList({ ...ctx, method: "collaboration.spaces.list" }),
  "spaces.list": async (ctx) => handleCollaborationSpacesList({ ...ctx, method: "spaces.list" }),
  "collaboration.spaces.members.update": async (ctx) =>
    handleCollaborationSpaceMembersUpdate({
      ...ctx,
      method: "collaboration.spaces.members.update",
    }),
  "collaboration.spaces.leave": async (ctx) =>
    handleCollaborationSpaceLeave({
      ...ctx,
      method: "collaboration.spaces.leave",
    }),
  "collaboration.spaces.transferOwnership": async (ctx) =>
    handleCollaborationSpaceOwnershipTransfer({
      ...ctx,
      method: "collaboration.spaces.transferOwnership",
    }),
  "spaces.members.update": async (ctx) =>
    handleCollaborationSpaceMembersUpdate({ ...ctx, method: "spaces.members.update" }),
  "collaboration.spaces.reset": async (ctx) =>
    handleCollaborationSpaceReset({ ...ctx, method: "collaboration.spaces.reset" }),
  "collaboration.spaces.dissolve": async (ctx) =>
    handleCollaborationSpaceDissolve({ ...ctx, method: "collaboration.spaces.dissolve" }),
  "spaces.reset": async (ctx) => handleCollaborationSpaceReset({ ...ctx, method: "spaces.reset" }),
  "collaboration.spaces.mission.advance": async (ctx) =>
    handleCollaborationSpaceMissionAdvance({
      ...ctx,
      method: "collaboration.spaces.mission.advance",
    }),
  "collaboration.spaces.charter.get": async ({ params, respond }) => {
    const groupId = typeof params.groupId === "string" ? params.groupId.trim() : "";
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId is required"));
      return;
    }
    const charter = await loadGroupCharterForRuntime(groupId);
    if (!charter) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `协作小组不存在：${groupId}`),
      );
      return;
    }
    respond(true, { groupId, charter }, undefined);
  },
};
