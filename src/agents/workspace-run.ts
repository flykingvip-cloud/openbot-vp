import type { OpenBotConfig } from "../config/config.js";
import { resolveStateDir } from "../config/paths.js";
import {
  resolveCanonicalRobotWriteRoot,
  type CanonicalWriteOwnership,
} from "../gateway/workspace-resolver/canonical-write-root.js";
import { alignFormalRootForManagedAddressing } from "../gateway/workspace-resolver/formal-deliverable-root.js";
import { pathBelongsToBot } from "../gateway/workspace-resolver/workspace-write-contract.js";
import {
  resolveLiveRobotWriteRoot,
  resolveRobotWriteRoot,
} from "../gateway/workspace-resolver/write-roots.js";
import { logWarn } from "../logger.js";
import { redactIdentifier } from "../logging/redact-identifier.js";
import {
  classifySessionKeyShape,
  DEFAULT_AGENT_ID,
  normalizeAgentId,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { resolveUserPath } from "../utils.js";
import { resolveDefaultAgentId } from "./agent-scope.js";
import { extractEmployeeStewardUserIdFromSessionKey } from "./builtin-steward/employee-isolation.js";
import { sanitizeForPromptLiteral } from "./sanitize-for-prompt.js";

export type WorkspaceFallbackReason = "missing" | "blank" | "invalid_type";
type AgentIdSource = "explicit" | "session_key" | "default";

export type ResolveRunWorkspaceResult = {
  workspaceDir: string;
  usedFallback: boolean;
  fallbackReason?: WorkspaceFallbackReason;
  agentId: string;
  agentIdSource: AgentIdSource;
};

function resolveRunAgentId(params: {
  sessionKey?: string;
  agentId?: string;
  config?: OpenBotConfig;
}): {
  agentId: string;
  agentIdSource: AgentIdSource;
} {
  const rawSessionKey = params.sessionKey?.trim() ?? "";
  const shape = classifySessionKeyShape(rawSessionKey);
  if (shape === "malformed_agent") {
    throw new Error("Malformed agent session key; refusing workspace resolution.");
  }

  const explicit =
    typeof params.agentId === "string" && params.agentId.trim()
      ? normalizeAgentId(params.agentId)
      : undefined;
  if (explicit) {
    return { agentId: explicit, agentIdSource: "explicit" };
  }

  const defaultAgentId = resolveDefaultAgentId(params.config ?? {});
  if (shape === "missing" || shape === "legacy_or_alias") {
    return {
      agentId: defaultAgentId || DEFAULT_AGENT_ID,
      agentIdSource: "default",
    };
  }

  const parsed = parseAgentSessionKey(rawSessionKey);
  if (parsed?.agentId) {
    return {
      agentId: normalizeAgentId(parsed.agentId),
      agentIdSource: "session_key",
    };
  }

  // Defensive fallback, should be unreachable for non-malformed shapes.
  return {
    agentId: defaultAgentId || DEFAULT_AGENT_ID,
    agentIdSource: "default",
  };
}

export function redactRunIdentifier(value: string | undefined): string {
  return redactIdentifier(value, { len: 12 });
}

/**
 * Under managed shared addressing, remount tenants user trees onto operators SoT.
 * Must stay identical to preview-side alignFormalRootForManagedAddressing so
 * write cwd and steward-file.read open the same bytes.
 */
function alignManagedWorkspaceDir(workspaceDir: string, config?: OpenBotConfig): string {
  return alignFormalRootForManagedAddressing(workspaceDir, { config, env: process.env });
}

export function resolveRunWorkspaceDir(params: {
  workspaceDir: unknown;
  sessionKey?: string;
  agentId?: string;
  config?: OpenBotConfig;
  /** Authenticated platform user. Wins over a shared or foreign workspaceDir. */
  userId?: string | null;
  tenantId?: string | null;
  /** Seat/shared ownership hint — when seat_owned, chatting userId does not fork the root. */
  writeOwnership?: CanonicalWriteOwnership;
}): ResolveRunWorkspaceResult {
  const requested = params.workspaceDir;
  const { agentId, agentIdSource } = resolveRunAgentId({
    sessionKey: params.sessionKey,
    agentId: params.agentId,
    config: params.config,
  });
  const userId =
    params.userId?.trim() ||
    extractEmployeeStewardUserIdFromSessionKey(params.sessionKey ?? "") ||
    "";
  const seatOwned = params.writeOwnership?.kind === "seat_owned";
  const robotOwn =
    resolveCanonicalRobotWriteRoot({
      agentId,
      sessionKey: params.sessionKey,
      chattingUserId: userId || null,
      tenantId: params.tenantId,
      stateDir: resolveStateDir(process.env),
      ownership: params.writeOwnership,
    }) ??
    (seatOwned
      ? null
      : resolveRobotWriteRoot({
          agentId,
          sessionKey: params.sessionKey,
          userId: userId || null,
          tenantId: params.tenantId,
          stateDir: resolveStateDir(process.env),
        }));
  if (seatOwned && !robotOwn) {
    throw new Error(
      "seat formal root missing sticky/host binding; refusing operators/chatting-user fallback",
    );
  }
  if (robotOwn) {
    const sanitizedRobot = sanitizeForPromptLiteral(robotOwn);
    if (sanitizedRobot !== robotOwn) {
      logWarn("Control/format characters stripped from robot workspaceDir (OC-19 hardening).");
    }
    const canonical = alignManagedWorkspaceDir(resolveUserPath(sanitizedRobot), params.config);
    const requestedTrimmed = typeof requested === "string" ? requested.trim() : "";
    const requestedResolved = requestedTrimmed
      ? resolveUserPath(sanitizeForPromptLiteral(requestedTrimmed))
      : "";
    // Seat/shared formal root is sticky: chatting login must not keep a forked
    // operators/<chattingUser>/… remount over the seat host binding.
    // Personal bots may keep a Path B operators remount for the same owner+agent.
    if (
      !seatOwned &&
      userId &&
      requestedResolved &&
      pathBelongsToBot(requestedResolved, userId, agentId)
    ) {
      const kept = alignManagedWorkspaceDir(requestedResolved, params.config);
      return {
        workspaceDir: kept,
        usedFallback: false,
        agentId,
        agentIdSource,
      };
    }
    const alignedRequested = requestedResolved
      ? alignManagedWorkspaceDir(requestedResolved, params.config)
      : "";
    return {
      workspaceDir: canonical,
      usedFallback: alignedRequested !== canonical,
      fallbackReason:
        alignedRequested && alignedRequested !== canonical
          ? "invalid_type"
          : requested == null
            ? "missing"
            : typeof requested === "string" && !requestedTrimmed
              ? "blank"
              : undefined,
      agentId,
      agentIdSource,
    };
  }
  if (typeof requested === "string") {
    const trimmed = requested.trim();
    if (trimmed) {
      const sanitized = sanitizeForPromptLiteral(trimmed);
      if (sanitized !== trimmed) {
        logWarn("Control/format characters stripped from workspaceDir (OC-19 hardening).");
      }
      return {
        workspaceDir: alignManagedWorkspaceDir(resolveUserPath(sanitized), params.config),
        usedFallback: false,
        agentId,
        agentIdSource,
      };
    }
  }

  const fallbackReason: WorkspaceFallbackReason =
    requested == null ? "missing" : typeof requested === "string" ? "blank" : "invalid_type";
  if (extractEmployeeStewardUserIdFromSessionKey(params.sessionKey ?? "")) {
    throw new Error("robot own workspace requires tenant-user identity; refusing leftover path");
  }
  const fallbackWorkspace = resolveLiveRobotWriteRoot({
    agentId,
    configuredDefaultWorkspace: params.config?.agents?.defaults?.workspace,
    stateDir: resolveStateDir(process.env),
  });
  const sanitizedFallback = sanitizeForPromptLiteral(fallbackWorkspace);
  if (sanitizedFallback !== fallbackWorkspace) {
    logWarn("Control/format characters stripped from fallback workspaceDir (OC-19 hardening).");
  }
  return {
    workspaceDir: alignManagedWorkspaceDir(resolveUserPath(sanitizedFallback), params.config),
    usedFallback: true,
    fallbackReason,
    agentId,
    agentIdSource,
  };
}
