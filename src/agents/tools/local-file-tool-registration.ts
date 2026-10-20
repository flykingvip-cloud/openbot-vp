/**
 * Deciding whether the `local_file.*` / `local_archive.*` tools are offered at all.
 *
 * Two gates, both fail closed:
 *
 * 1. The gateway runtime must exist in this process. These tools reach the user's
 *    machine through `LocalFilesService`, which lives on the gateway. An agent
 *    running outside that process (a CLI run, for instance) cannot use them.
 * 2. A trusted turn identity must be present. Tenant, user, digital human and
 *    session all have to come from the validated session, never from tool
 *    arguments — that binding is the whole point of the capability.
 *
 * When either gate fails the tools are OMITTED rather than registered-and-failing.
 * Advertising a capability that can never succeed teaches a model to keep retrying
 * it and burns turns on a guaranteed refusal.
 */

import type { ExecutionIdentityContext } from "../../gateway/execution-identity-context.js";
import { getLocalFilesRuntime } from "../../gateway/local-files/runtime.js";
import type { LocalFilesNodeView } from "../../gateway/local-files/service.js";
import { declaresLocalFilesCommands } from "../../local-files/capability-profile.js";
import type { AnyAgentTool } from "./common.js";
import {
  createLocalFileTools,
  type LocalFileToolIdentity,
  type LocalFileToolOptions,
} from "./local-file-tool.js";

export type LocalFileToolRegistrationInput = {
  executionIdentity?: ExecutionIdentityContext;
  agentId?: string;
  sessionKey?: string;
  /** Stable run identifier; used as the turn id the capability binds to. */
  runId?: string;
  /** Inbound message that opened this turn, for audit correlation. */
  currentMessageId?: string | number;
};

export type IdentityResolution =
  | { ok: true; identity: LocalFileToolIdentity }
  | {
      ok: false;
      reason:
        | "no-execution-identity"
        | "no-tenant"
        | "no-user"
        | "no-agent"
        | "no-session"
        | "no-turn";
    };

/**
 * Build the turn identity from trusted sources only.
 *
 * `enterpriseId` is documented as "pinned by the validated session; never a
 * client-supplied hint", which is exactly the property a tenant binding needs.
 * Anything missing is a refusal, not a default.
 */
export function resolveLocalFileToolIdentity(
  input: LocalFileToolRegistrationInput,
): IdentityResolution {
  const identity = input.executionIdentity;
  if (!identity) {
    return { ok: false, reason: "no-execution-identity" };
  }
  const tenantId = identity.enterpriseId?.trim();
  if (!tenantId) {
    return { ok: false, reason: "no-tenant" };
  }
  // Prefer the platform user id: it is the stable tenant-control-plane identifier,
  // where the login email can change.
  const userId = identity.platformUserId?.trim() || identity.user?.trim();
  if (!userId) {
    return { ok: false, reason: "no-user" };
  }
  const agentId = (identity.agentId ?? input.agentId)?.trim();
  if (!agentId) {
    return { ok: false, reason: "no-agent" };
  }
  const sessionKey = (identity.sessionKey ?? input.sessionKey)?.trim();
  if (!sessionKey) {
    return { ok: false, reason: "no-session" };
  }
  const turnId = input.runId?.trim();
  if (!turnId) {
    // Without a turn id a capability could not be scoped to this turn, and a grant
    // would outlive the intent that produced it.
    return { ok: false, reason: "no-turn" };
  }

  const resolved: LocalFileToolIdentity = { tenantId, userId, agentId, sessionKey, turnId };
  const inboundMessageId =
    typeof input.currentMessageId === "string"
      ? input.currentMessageId.trim()
      : typeof input.currentMessageId === "number"
        ? String(input.currentMessageId)
        : "";
  if (inboundMessageId) {
    resolved.inboundMessageId = inboundMessageId;
  }
  return { ok: true, identity: resolved };
}

/**
 * Build the tools, or an empty list when they cannot work here.
 *
 * `resolveNodeId` returns null when the user has no active binding or has several
 * and has not chosen one; requests are never broadcast across a user's devices
 * (design 4.3).
 */
export function createLocalFileToolsIfAvailable(
  input: LocalFileToolRegistrationInput,
): AnyAgentTool[] {
  const runtime = getLocalFilesRuntime();
  if (!runtime) {
    return [];
  }
  const resolved = resolveLocalFileToolIdentity(input);
  if (!resolved.ok) {
    return [];
  }

  const options: LocalFileToolOptions = {
    service: runtime.service,
    identity: resolved.identity,
    resolveNodeId: async (identity) => {
      const candidates = runtime.bindings.listActiveForUser({
        tenantId: identity.tenantId,
        userId: identity.userId,
      });
      const allowed = candidates.filter((binding) =>
        binding.allowedAgentIds.includes(identity.agentId),
      );
      if (allowed.length === 1) {
        const binding = allowed[0];
        return { nodeId: binding.nodeId, devicePublicKey: binding.devicePublicKey };
      }
      if (candidates.length > 0) {
        // Several devices, or the only binding names a different digital human.
        // Do not guess, and do not widen someone else's grant.
        return null;
      }
      const live = selectSolePairedLocalFilesNode(runtime.nodes?.list() ?? []);
      if (!live?.devicePublicKey) {
        return null;
      }
      return { nodeId: live.nodeId, devicePublicKey: live.devicePublicKey };
    },
  };
  return createLocalFileTools(options);
}

/**
 * The one paired computer that can serve a signed local-file read.
 *
 * Zero matches and several matches are both null: a missing computer is not
 * invented, and two computers are not guessed between.
 */
export function selectSolePairedLocalFilesNode(
  nodes: readonly LocalFilesNodeView[],
): LocalFilesNodeView | null {
  const eligible = nodes.filter(
    (node) => Boolean(node.devicePublicKey?.trim()) && declaresLocalFilesCommands(node.commands),
  );
  return eligible.length === 1 ? eligible[0] : null;
}
