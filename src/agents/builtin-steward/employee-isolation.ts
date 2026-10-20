/**
 * Employee-domain isolation for builtin steward (大白管家).
 *
 * Each platform-auth employee gets a dedicated steward session key and workspace
 * under agent `main`, separate from the operator/global `agent:main:main` session.
 */

import path from "node:path";
import type { OpenBotConfig } from "../../config/config.js";
import { resolveStateDir } from "../../config/paths.js";
import {
  canonicalizeMainSessionAlias,
  resolveMainSessionKey,
} from "../../config/sessions/main-session.js";
import {
  buildAgentMainSessionKey,
  normalizeAgentId,
  normalizeMainKey,
} from "../../routing/session-key.js";
import {
  isOrganizationAgentSessionKey,
  parseAgentSessionKey,
} from "../../sessions/session-key-utils.js";
import { BUILTIN_STEWARD_AGENT_ID, isBuiltinStewardAgent } from "./identity.js";
export { isBuiltinStewardAgent };

export const EMPLOYEE_STEWARD_SESSION_SEGMENT = "employee" as const;

const EMPLOYEE_STEWARD_ID_RE = /^[a-z0-9][a-z0-9_-]{0,127}$/;

export function sanitizeEmployeeStewardIdentity(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const normalized = trimmed
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  if (!normalized || !EMPLOYEE_STEWARD_ID_RE.test(normalized)) {
    return trimmed.slice(0, 128).replace(/[^a-z0-9_-]+/g, "-");
  }
  return normalized;
}

export function buildEmployeeBuiltinStewardSessionKey(platformUserId: string): string {
  const owner = sanitizeEmployeeStewardIdentity(platformUserId);
  return buildAgentMainSessionKey({
    agentId: BUILTIN_STEWARD_AGENT_ID,
    mainKey: `${EMPLOYEE_STEWARD_SESSION_SEGMENT}:${owner}`,
  });
}

export function extractEmployeeStewardUserIdFromSessionKey(
  sessionKey: string | null | undefined,
): string | null {
  const parsed = parseAgentSessionKey(sessionKey?.trim() ?? "");
  if (!parsed || !isBuiltinStewardAgent(parsed.agentId)) {
    return null;
  }
  const prefix = `${EMPLOYEE_STEWARD_SESSION_SEGMENT}:`;
  if (!parsed.rest.startsWith(prefix)) {
    return null;
  }
  const owner = parsed.rest.slice(prefix.length).trim();
  return owner || null;
}

export function isGlobalBuiltinStewardSessionKey(
  sessionKey: string,
  cfg?: Pick<OpenBotConfig, "session" | "agents">,
): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return false;
  }
  const lower = raw.toLowerCase();
  // Two-part nav shorthand (`?session=agent:main`) is the same alias as `main`.
  if (raw === "main" || lower === "global" || lower === "agent:main") {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  if (!parsed || !isBuiltinStewardAgent(parsed.agentId)) {
    return false;
  }
  if (extractEmployeeStewardUserIdFromSessionKey(raw)) {
    return false;
  }
  if (cfg) {
    const canonical = canonicalizeMainSessionAlias({
      cfg,
      agentId: parsed.agentId,
      sessionKey: raw,
    });
    const globalMain = resolveMainSessionKey(cfg);
    return canonical === globalMain || parsed.rest === normalizeMainKey(cfg.session?.mainKey);
  }
  return parsed.rest === "main" || parsed.rest === normalizeMainKey(undefined);
}

export function isEmployeeBuiltinStewardSessionAlias(
  sessionKey: string,
  cfg?: Pick<OpenBotConfig, "session" | "agents">,
): boolean {
  const raw = sessionKey.trim();
  if (!raw) {
    return true;
  }
  if (extractEmployeeStewardUserIdFromSessionKey(raw)) {
    return true;
  }
  return isGlobalBuiltinStewardSessionKey(raw, cfg);
}

/**
 * Transcript loaders return this instead of `agent:main:main` when an
 * employee/enterprise client asked for the global steward and the remap to
 * `agent:main:employee:<id>` could not finish.
 */
export const EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED = "denied:employee-global-steward";

export function isEmployeeGlobalStewardHistoryDenied(
  sessionKey: string | null | undefined,
): boolean {
  return (sessionKey ?? "").trim() === EMPLOYEE_GLOBAL_STEWARD_HISTORY_DENIED;
}

/**
 * Keys `chat.history` may use to adopt an in-flight run (#530).
 * The employee's own session is included. A global steward alias is not,
 * once the read has already been scoped to a non-global key — otherwise a
 * reconnect would attach the operator `agent:main:main` run.
 */
export function sessionKeysForChatHistoryActiveRun(params: {
  resolvedSessionKey: string;
  rawSessionKey: string;
  cfg?: Pick<OpenBotConfig, "session" | "agents">;
}): string[] {
  const resolved = params.resolvedSessionKey.trim();
  const raw = params.rawSessionKey.trim();
  const keys: string[] = [];
  const push = (key: string) => {
    if (!key || keys.includes(key)) {
      return;
    }
    if (
      resolved &&
      !isGlobalBuiltinStewardSessionKey(resolved, params.cfg) &&
      isGlobalBuiltinStewardSessionKey(key, params.cfg)
    ) {
      return;
    }
    keys.push(key);
  };
  push(resolved);
  push(raw);
  return keys;
}

/** Collaboration rooms live on `space:` / `agent:<id>:…:space:<group>` keys, not the steward thread. */
function isCollaborationSpaceSessionKey(sessionKey: string): boolean {
  const raw = sessionKey.trim().toLowerCase();
  if (!raw) {
    return false;
  }
  if (raw.startsWith("space:")) {
    return true;
  }
  const parsed = parseAgentSessionKey(raw);
  if (!parsed) {
    return false;
  }
  const rest = parsed.rest;
  return rest === "space" || rest.startsWith("space:") || rest.includes(":space:");
}

export function resolveEmployeeBuiltinStewardSessionKey(params: {
  rawSessionKey: string;
  platformUserId: string;
  cfg?: Pick<OpenBotConfig, "session" | "agents">;
}): string {
  const ownKey = buildEmployeeBuiltinStewardSessionKey(params.platformUserId);
  const raw = params.rawSessionKey.trim();
  // Group transcripts are stored on the space key. Rewriting them to the
  // employee steward session makes every room show 大白's chat and checkpoints.
  if (isCollaborationSpaceSessionKey(raw) || isOrganizationAgentSessionKey(raw)) {
    return raw;
  }
  const foreignOwner = extractEmployeeStewardUserIdFromSessionKey(raw);
  if (foreignOwner) {
    const ownOwner = sanitizeEmployeeStewardIdentity(params.platformUserId);
    // A foreign 大白管家 key is not the caller's thread. Rewriting it to
    // ownKey looks like a successful open and skips confirmation.
    return foreignOwner === ownOwner ? ownKey : raw;
  }
  if (!raw || isEmployeeBuiltinStewardSessionAlias(raw, params.cfg)) {
    return ownKey;
  }
  if (isBuiltinStewardAgent(parseAgentSessionKey(raw)?.agentId)) {
    return ownKey;
  }
  return raw;
}

export type StewardDispatchRank = "platform_admin" | "enterprise_admin" | "member";

export type StewardCallRoleLabel = "平台管理员" | "企业管理员";

export const STEWARD_CROSS_CALL_ACTIONS = ["同意", "不同意"] as const;

export type StewardCrossCallAction = (typeof STEWARD_CROSS_CALL_ACTIONS)[number];

/**
 * Rank for a 大白管家 cross-call.
 * `sessionDomain` and `sessionKind` are accepted and ignored: a stamped session
 * is not a role. `platformRole` is `resolvePlatformRole` (`admin` =
 * platform-admin, `super-admin` = platform-super-admin). Enterprise admin is
 * only a real enterprise-admin membership for the relevant tenant.
 */
export function resolveStewardDispatchRank(input: {
  sessionDomain?: string | null;
  sessionKind?: string | null;
  platformRole?: "super-admin" | "admin" | null;
  enterpriseAdminMembership?: boolean;
}): StewardDispatchRank {
  if (input.platformRole === "super-admin" || input.platformRole === "admin") {
    return "platform_admin";
  }
  if (input.enterpriseAdminMembership === true) {
    return "enterprise_admin";
  }
  return "member";
}

export function stewardCrossCallPrompt(roleLabel: StewardCallRoleLabel): string {
  return `${roleLabel}需要与你发起对话，是否同意？`;
}

export function assessForeignStewardCall(input: {
  callerUserId: string;
  targetUserId: string;
  rank: StewardDispatchRank;
  callerTenantId?: string | null;
  targetTenantIds?: readonly string[];
}):
  | { disposition: "own" }
  | { disposition: "forbidden" }
  | {
      disposition: "needs_authorization";
      roleLabel: StewardCallRoleLabel;
      prompt: string;
      actions: typeof STEWARD_CROSS_CALL_ACTIONS;
    } {
  const caller = sanitizeEmployeeStewardIdentity(input.callerUserId);
  const target = sanitizeEmployeeStewardIdentity(input.targetUserId);
  if (!caller || !target) {
    return { disposition: "forbidden" };
  }
  if (caller === target) {
    return { disposition: "own" };
  }
  if (input.rank === "platform_admin") {
    const roleLabel = "平台管理员" as const;
    return {
      disposition: "needs_authorization",
      roleLabel,
      prompt: stewardCrossCallPrompt(roleLabel),
      actions: STEWARD_CROSS_CALL_ACTIONS,
    };
  }
  if (input.rank === "enterprise_admin") {
    const callerTenant = input.callerTenantId?.trim() ?? "";
    const targets = new Set(
      (input.targetTenantIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
    );
    if (!callerTenant || !targets.has(callerTenant)) {
      return { disposition: "forbidden" };
    }
    const roleLabel = "企业管理员" as const;
    return {
      disposition: "needs_authorization",
      roleLabel,
      prompt: stewardCrossCallPrompt(roleLabel),
      actions: STEWARD_CROSS_CALL_ACTIONS,
    };
  }
  return { disposition: "forbidden" };
}

export function isEmployeeBuiltinStewardSessionOwnedByUser(params: {
  sessionKey: string;
  platformUserId: string;
}): boolean {
  const owner = extractEmployeeStewardUserIdFromSessionKey(params.sessionKey);
  if (!owner) {
    return false;
  }
  return owner === sanitizeEmployeeStewardIdentity(params.platformUserId);
}

export function resolveEmployeeBuiltinStewardWorkspaceDir(
  platformUserId: string,
  options?: {
    /**
     * Phase 1.1 cutover: when provided, use this root instead of the legacy
     * `{stateDir}/agents/main/employees/<user>/workspace` path (e.g. D1e target after
     * `resolver_write_cutover`). Callers with tenant context should resolve via
     * `resolveEmployeeStewardWritableWorkspaceDir` first.
     */
    workspaceDirOverride?: string;
    stateDir?: string;
  },
): string {
  if (options?.workspaceDirOverride?.trim()) {
    return path.resolve(options.workspaceDirOverride.trim());
  }
  const owner = sanitizeEmployeeStewardIdentity(platformUserId);
  const stateDir = options?.stateDir ?? resolveStateDir(process.env);
  return path.join(
    stateDir,
    "agents",
    normalizeAgentId(BUILTIN_STEWARD_AGENT_ID),
    "employees",
    owner,
    "workspace",
  );
}

/** True for employee steward chat sessions (`agent:main:employee:<owner>`). */
export function isEmployeeBuiltinStewardSession(params: {
  sessionKey?: string | null;
  agentId?: string | null;
}): boolean {
  const employeeOwnerId = extractEmployeeStewardUserIdFromSessionKey(params.sessionKey);
  if (!employeeOwnerId) {
    return false;
  }
  const agentId = params.agentId?.trim();
  if (agentId && !isBuiltinStewardAgent(agentId)) {
    return false;
  }
  return true;
}

/** Mode A (Appendix B): employee steward self-serve runs stay inside per-user workspace. */
export function shouldForceEmployeeStewardToolFsWorkspaceOnly(params: {
  sessionKey?: string | null;
  agentId?: string | null;
}): boolean {
  return isEmployeeBuiltinStewardSession(params);
}
