import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { defaultConversationSessionKey } from "../../conversation-task/conversation-handoff.js";
import { listAgentAssets } from "../agent-registry/registry.js";
import { loadAgentRegistryStore } from "../agent-registry/store.js";
/**
 * TEAM-REAL F1–F3 gateway handlers — activation, NL confirm, team deliverable, readiness.
 * Pack-owned; review A: resource ACL + membership tenant; read readiness never writes.
 */
import { activateCollaborationTask } from "../collaboration-learning/activate-collaboration-task.js";
import { tryConfirmPlanFromChat } from "../collaboration-learning/chat-plan-confirm.js";
import { resolveDeliveryAclActor } from "../collaboration-learning/delivery-actor-binding.js";
import {
  checkMemberDispatchReadiness,
  ensureRegisteredMemberMainSession,
  type TrustedMemberResolution,
} from "../collaboration-learning/member-dispatch-readiness.js";
import { readGroupOperatingState } from "../collaboration-learning/shared.js";
import {
  readTeamDeliverable,
  submitTeamDeliverable,
} from "../collaboration-learning/team-deliverable-submit.js";
import {
  authorizeTeamGroupResourceAccess,
  createTrustedGroupStores,
  resolveTeamDeliverableStores,
} from "../collaboration-learning/team-resource-auth.js";
import {
  resolveCollaborationTenantResolution,
  resolveMembershipTenantIdForAcl,
} from "../collaboration-learning/trusted-tenant.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { resolveSecurityProfile } from "../security-profile.js";
import { loadAuthoritativeGroupMembers } from "../workspace/group-acl.js";
import { resolveTrustedGroupLocator } from "../workspace/group-locator.js";
import type { GatewayRequestHandlers } from "./types.js";

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.map((row) => (typeof row === "string" ? row.trim() : "")).filter(Boolean);
  return out.length ? out : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

async function resolveTrustedMembersForGroup(params: {
  groupId: string;
  client: Parameters<typeof resolveDeliveryAclActor>[0];
}): Promise<(memberId: string) => Promise<TrustedMemberResolution | null>> {
  const cfg = loadConfig();
  const profile = resolveSecurityProfile(cfg).profile;
  const tenantId = await resolveMembershipTenantIdForAcl(params.client as never);
  const members = await loadAuthoritativeGroupMembers({
    groupId: params.groupId,
    tenantId,
    profile,
    cfg,
  });
  // Team OS read: trusted locator only (never host ~/.openbot/collaboration fallthrough).
  let osFileStore = null as ReturnType<typeof createTrustedGroupStores>["fileStore"] | null;
  try {
    if (profile === "managed_enterprise" && tenantId) {
      const groupLocator = resolveTrustedGroupLocator({
        groupId: params.groupId,
        tenantId,
        profile,
        cfg,
      });
      osFileStore = createTrustedGroupStores({
        groupsRoot: path.dirname(groupLocator),
        groupLocator,
      }).fileStore;
    } else if (profile === "personal_local") {
      const resolved = resolveTeamDeliverableStores({
        groupId: params.groupId,
        cfg,
        tenantId: null,
      });
      if (resolved.ok) {
        osFileStore = resolved.fileStore;
      }
    }
  } catch {
    osFileStore = null;
  }
  const os = osFileStore
    ? await readGroupOperatingState({
        fileStore: osFileStore,
        groupId: params.groupId,
      }).catch(() => null)
    : null;
  const roleMap = new Map(
    (os?.memberRoleMap ?? [])
      .map((row) => {
        const id = typeof row.memberId === "string" ? row.memberId.trim() : "";
        return id ? ([id, row] as const) : null;
      })
      .filter((row): row is readonly [string, (typeof os.memberRoleMap)[number]] => Boolean(row)),
  );

  // Enterprise agent registry (managed). Personal_local may have no registry —
  // then bot members with an agentId field still count as registered bots.
  const registryAgentIds = new Set<string>();
  if (profile === "managed_enterprise" && tenantId) {
    try {
      const store = await loadAgentRegistryStore();
      for (const asset of listAgentAssets(store, tenantId)) {
        if (asset.status !== "active") {
          continue;
        }
        if (asset.legacyAgentId?.trim()) {
          registryAgentIds.add(asset.legacyAgentId.trim());
        }
        if (asset.agentSlug?.trim()) {
          registryAgentIds.add(asset.agentSlug.trim());
        }
      }
    } catch {
      // Registry unavailable → no bot will be treated as registered under managed.
    }
  }

  return async (memberId: string): Promise<TrustedMemberResolution | null> => {
    const id = memberId.trim();
    if (!id) {
      return null;
    }
    const fromMembers = members.find((m) => {
      const candidates = [m.userId, m.memberId, m.agentId]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean);
      return candidates.includes(id);
    });
    const fromRole = roleMap.get(id);

    const notRegistered = (): TrustedMemberResolution => ({
      memberId: id,
      agentId: null,
      displayName: fromMembers?.name?.trim() || null,
      registration: "not_registered",
      sessionKey: null,
    });

    if (!fromMembers && !fromRole) {
      return notRegistered();
    }

    const status = fromMembers?.status ?? fromRole?.status;
    if (status === "removed" || status === "revoked" || status === "paused") {
      return notRegistered();
    }

    const memberKind = fromMembers?.memberKind ?? fromRole?.memberKind;
    // Only active/invited BOTS are session-ensure candidates. Never treat a human
    // userId as an agentId for main-session creation.
    if (memberKind !== "bot") {
      return notRegistered();
    }

    const agentId = fromMembers?.agentId?.trim() || fromRole?.memberId?.trim() || "";
    if (!agentId) {
      return notRegistered();
    }

    if (profile === "managed_enterprise") {
      if (!registryAgentIds.has(agentId)) {
        return {
          memberId: id,
          agentId,
          displayName: fromMembers?.name?.trim() || null,
          registration: "not_registered",
          sessionKey: null,
        };
      }
    }

    return {
      memberId: id,
      agentId,
      displayName: fromMembers?.name?.trim() || null,
      registration: "registered",
      sessionKey: defaultConversationSessionKey(agentId),
    };
  };
}

export const collaborationTaskActivationHandlers: GatewayRequestHandlers = {
  "collaboration.task.activate": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const taskId = readString(params?.taskId);
    const title = readString(params?.title);
    const message = readString(params?.message);
    if (!groupId || !taskId || !title || !message) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, title, message are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const auth = await authorizeTeamGroupResourceAccess({
        groupId,
        actor,
        client,
        tenant,
        action: "write",
      });
      if (!auth.ok) {
        respond(
          true,
          {
            status: "blocked",
            reason: auth.reason,
            detail: auth.detail,
            boardPublished: false,
            dispatched: false,
            taskEnsured: false,
            taskId,
            activationKey: "",
          },
          undefined,
        );
        return;
      }
      const result = await activateCollaborationTask({
        groupId,
        taskId,
        title,
        message,
        actor,
        goal: readString(params?.goal),
        acceptanceCriteria: readStringArray(params?.acceptanceCriteria),
        constraints: readStringArray(params?.constraints),
        suggestedClaimantIds: readStringArray(params?.suggestedClaimantIds),
        suggestedRole: readString(params?.suggestedRole),
        dueAtMs: readNumber(params?.dueAtMs),
        humanConfirmed: readBoolean(params?.humanConfirmed) === true,
        requireHumanConfirm: readBoolean(params?.requireHumanConfirm),
        tenant,
        auth,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.confirmPlanFromChat": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const message = readString(params?.message);
    const taskId = readString(params?.taskId);
    if (!groupId || !message || !taskId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, message are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const auth = await authorizeTeamGroupResourceAccess({
        groupId,
        actor,
        client,
        tenant,
        action: "write",
      });
      if (!auth.ok) {
        respond(
          true,
          { status: "blocked", confirmed: false, reason: auth.reason, detail: auth.detail },
          undefined,
        );
        return;
      }
      const stores = createTrustedGroupStores({
        groupsRoot: auth.groupsRoot,
        groupLocator: auth.groupLocator,
      });
      const result = await tryConfirmPlanFromChat({
        groupId,
        message,
        actor,
        taskId,
        boardItemId: readString(params?.boardItemId),
        todolistId: readString(params?.todolistId),
        expectedVersion: readNumber(params?.expectedVersion),
        tenant,
        auth,
        stores,
        trusted: { groupsRoot: auth.groupsRoot, groupLocator: auth.groupLocator },
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.submitTeamDeliverable": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const taskId = readString(params?.taskId);
    const title = readString(params?.title);
    const content = typeof params?.content === "string" ? params.content : undefined;
    if (!groupId || !taskId || !title || content === undefined) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, taskId, title, content are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const result = await submitTeamDeliverable({
        groupId,
        taskId,
        actor,
        title,
        content,
        logicalId: readString(params?.logicalId),
        contentType: readString(params?.contentType),
        previousDeliverableId: readString(params?.previousDeliverableId),
        relativePath: readString(params?.relativePath),
        tenant,
        client,
        enforceAcl: true,
        identityAliases: [client?.user ?? ""].map((v) => String(v).trim()).filter(Boolean),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  "collaboration.task.readTeamDeliverable": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const deliverableId = readString(params?.deliverableId);
    if (!groupId || !deliverableId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, deliverableId are required"),
      );
      return;
    }
    try {
      const tenant = await resolveCollaborationTenantResolution(client);
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const result = await readTeamDeliverable({
        groupId,
        deliverableId,
        actor,
        tenant,
        client,
        enforceAcl: true,
        identityAliases: [client?.user ?? ""].map((v) => String(v).trim()).filter(Boolean),
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  /** Read-only readiness: never creates sessions; registration from trusted roster. */
  "collaboration.task.checkDispatchReadiness": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const rawMembers = Array.isArray(params?.members) ? params.members : null;
    if (!groupId) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "groupId is required"));
      return;
    }
    if (!rawMembers || rawMembers.length === 0) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "members array is required"),
      );
      return;
    }
    const memberIds: string[] = [];
    for (const row of rawMembers) {
      if (!row || typeof row !== "object") {
        continue;
      }
      const memberId = readString((row as { memberId?: unknown }).memberId);
      if (memberId) {
        memberIds.push(memberId);
      }
    }
    if (memberIds.length === 0) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "no valid members"));
      return;
    }
    try {
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const tenant = await resolveCollaborationTenantResolution(client);
      const auth = await authorizeTeamGroupResourceAccess({
        groupId,
        actor,
        client,
        tenant,
        action: "read",
      });
      if (!auth.ok) {
        respond(
          true,
          {
            members: [],
            allDispatchable: false,
            gaps: [{ memberId: "*", code: "not_registered", detail: auth.reason }],
          },
          undefined,
        );
        return;
      }
      const resolveMember = await resolveTrustedMembersForGroup({ groupId, client });
      const result = await checkMemberDispatchReadiness({
        members: memberIds.map((memberId) => ({ memberId })),
        resolveMember,
        // Read scope: never write sessions.
        autoEnsureSession: false,
      });
      respond(true, result, undefined);
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },

  /**
   * Write-scoped: controlled ensure of a registered member main session.
   * Does not prove model/tool readiness — only creates a session store record.
   */
  "collaboration.task.ensureMemberSession": async ({ params, respond, client }) => {
    const groupId = readString(params?.groupId);
    const memberId = readString(params?.memberId);
    if (!groupId || !memberId) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "groupId, memberId are required"),
      );
      return;
    }
    try {
      const actor = await resolveDeliveryAclActor(client, groupId);
      if (!actor) {
        respond(
          false,
          undefined,
          errorShape(ErrorCodes.INVALID_REQUEST, "actor_not_authenticated"),
        );
        return;
      }
      const tenant = await resolveCollaborationTenantResolution(client);
      const auth = await authorizeTeamGroupResourceAccess({
        groupId,
        actor,
        client,
        tenant,
        action: "write",
      });
      if (!auth.ok) {
        respond(true, { ok: false, reason: auth.reason, detail: auth.detail }, undefined);
        return;
      }
      const resolveMember = await resolveTrustedMembersForGroup({ groupId, client });
      const resolved = await resolveMember(memberId);
      if (!resolved || resolved.registration !== "registered" || !resolved.agentId) {
        respond(true, { ok: false, reason: "not_registered", memberId }, undefined);
        return;
      }
      const ensured = await ensureRegisteredMemberMainSession({
        agentId: resolved.agentId,
        sessionKey: resolved.sessionKey ?? undefined,
        expectAgentBoundSession: true,
      });
      respond(
        true,
        {
          ok: true,
          memberId,
          agentId: resolved.agentId,
          sessionKey: ensured.sessionKey,
          created: ensured.created,
          capabilityProof: false,
        },
        undefined,
      );
    } catch (error) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.UNAVAILABLE, error instanceof Error ? error.message : String(error)),
      );
    }
  },
};
