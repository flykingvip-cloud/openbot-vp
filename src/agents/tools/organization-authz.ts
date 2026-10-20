import type { OpenBotConfig } from "../../config/config.js";
import {
  readRuntimeSelfMemberStatus,
  resolveRuntimeOrganizationContext,
  type RuntimeOrganizationContext,
} from "../../organization/runtime.js";
import { normalizeAgentId, parseAgentSessionKey } from "../../routing/session-key.js";
import { toOrganizationAgentSessionKey } from "../../sessions/session-key-utils.js";
import { ToolAuthorizationError, ToolInputError } from "./common.js";

/**
 * Fail-closed organization scoping for organization_* agent tools (P0-S).
 *
 * The effective organization is always derived from the runtime (calling
 * agent + session), never from model-supplied parameters:
 * - Session resolves an organization: an explicit `organizationId` must equal
 *   it, otherwise the call is rejected (no cross-organization access, even if
 *   the agent also belongs to the other organization).
 * - Session resolves no organization (e.g. a DM/main session): an explicit
 *   `organizationId` is honored only when the requester is an `active` bot
 *   member of that organization's registry (`members.json`).
 * The returned context (coordinator, permissions, membership) belongs to the
 * TARGET organization, so callers authorize against the org they read/write.
 */
export type AuthorizedOrganization = {
  requesterAgentId: string;
  organizationId: string;
  /** Runtime context of the target organization. */
  context: RuntimeOrganizationContext;
  coordinatorAgentId?: string;
  permissions: string[];
  /** Requester's bot-member status in the target organization registry. */
  selfMemberStatus?: string;
  /** How the organization was authorized. */
  source: "session" | "membership";
};

/**
 * Trusted requester identity: runtime override, else the agent parsed from the
 * session key. Never falls back to a default agent such as "main".
 */
export function resolveOrganizationToolRequester(params: {
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
}): string {
  const override = params.requesterAgentIdOverride?.trim();
  if (override) {
    return override;
  }
  const parsed = parseAgentSessionKey(params.agentSessionKey);
  if (parsed?.agentId) {
    return normalizeAgentId(parsed.agentId);
  }
  throw new ToolAuthorizationError(
    "Cannot resolve the requesting agent for this session; organization tools require an agent session.",
  );
}

export async function resolveAuthorizedOrganization(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  agentSessionKey?: string;
  requesterAgentIdOverride?: string;
  explicitOrganizationId?: string;
}): Promise<AuthorizedOrganization> {
  const requesterAgentId = resolveOrganizationToolRequester(params);
  const explicit = params.explicitOrganizationId?.trim() || undefined;
  const sessionContext = await resolveRuntimeOrganizationContext({
    cfg: params.cfg,
    agentId: requesterAgentId,
    workspaceDir: params.workspaceDir,
    sessionKey: params.agentSessionKey,
  });
  const sessionOrganizationId = sessionContext.organization?.id?.trim() || undefined;

  if (sessionOrganizationId) {
    if (explicit && explicit !== sessionOrganizationId) {
      throw new ToolAuthorizationError(
        `Cross-organization access denied: organizationId "${explicit}" does not match this session's organization "${sessionOrganizationId}". Omit organizationId to use the current organization.`,
      );
    }
    const selfMemberStatus = await readRuntimeSelfMemberStatus({
      cfg: params.cfg,
      agentId: requesterAgentId,
      workspaceDir: params.workspaceDir,
      sessionKey: params.agentSessionKey,
    });
    return buildResult({
      requesterAgentId,
      organizationId: sessionOrganizationId,
      context: sessionContext,
      selfMemberStatus,
      source: "session",
    });
  }

  if (!explicit) {
    throw new ToolInputError("organizationId required outside an organization session");
  }
  const targetSessionKey = toOrganizationAgentSessionKey({
    agentId: requesterAgentId,
    organizationId: explicit,
  });
  const denied = new ToolAuthorizationError(
    `Cross-organization access denied: agent "${requesterAgentId}" is not an active member of organization "${explicit}".`,
  );
  if (!targetSessionKey) {
    throw denied;
  }
  const selfMemberStatus = await readRuntimeSelfMemberStatus({
    cfg: params.cfg,
    agentId: requesterAgentId,
    workspaceDir: params.workspaceDir,
    sessionKey: targetSessionKey,
  });
  if (selfMemberStatus !== "active") {
    throw denied;
  }
  const targetContext = await resolveRuntimeOrganizationContext({
    cfg: params.cfg,
    agentId: requesterAgentId,
    workspaceDir: params.workspaceDir,
    sessionKey: targetSessionKey,
  });
  if (targetContext.organization?.id?.trim() !== explicit) {
    throw denied;
  }
  return buildResult({
    requesterAgentId,
    organizationId: explicit,
    context: targetContext,
    selfMemberStatus,
    source: "membership",
  });
}

function buildResult(params: {
  requesterAgentId: string;
  organizationId: string;
  context: RuntimeOrganizationContext;
  selfMemberStatus?: string;
  source: AuthorizedOrganization["source"];
}): AuthorizedOrganization {
  const coordinatorAgentId = params.context.coordinator?.agentId;
  return {
    requesterAgentId: params.requesterAgentId,
    organizationId: params.organizationId,
    context: params.context,
    ...(coordinatorAgentId ? { coordinatorAgentId } : {}),
    permissions: params.context.self.permissions,
    ...(params.selfMemberStatus ? { selfMemberStatus: params.selfMemberStatus } : {}),
    source: params.source,
  };
}
