/**
 * TEAM-REAL F3 — Member dispatch readiness before派工 (review A hardened).
 *
 * - not_registered → never dispatchable
 * - registered_no_session → report gap; session create is NOT done on read path
 * - ready → registered + session exists
 *
 * Registration / agentId / sessionKey are resolved from trusted runtime sources
 * when resolveMember is provided. Request body must not invent registration.
 */
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../config/config.js";
import {
  loadSessionStore,
  mergeSessionEntry,
  resolveStorePath,
  updateSessionStore,
} from "../../config/sessions.js";
import type { OpenBotConfig } from "../../config/types.js";
import { defaultConversationSessionKey } from "../../conversation-task/conversation-handoff.js";
import { normalizeAgentId } from "../../routing/session-key.js";

/**
 * Board claimants are often `bot:<agentId>` while gateway agents.list and some
 * OS rows use the bare agent id. The wake intersection must treat them as one bot.
 */
export function collaborationDispatchAgentNeedle(value: string | null | undefined): string {
  const id = value?.trim() ?? "";
  if (id.startsWith("bot:")) {
    return id.slice(4).trim();
  }
  if (id.startsWith("agent:")) {
    return id.slice("agent:".length).trim();
  }
  return id;
}

export function collaborationDispatchIdsMatch(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  const a = collaborationDispatchAgentNeedle(left);
  const b = collaborationDispatchAgentNeedle(right);
  if (!a || !b) {
    return false;
  }
  if (a === b) {
    return true;
  }
  // Gateway agents.list ids are normalizeAgentId'd (/ → -); OS/member ids may keep /.
  return normalizeAgentId(a) === normalizeAgentId(b);
}

export type MemberRegistrationStatus = "registered" | "not_registered";

export type DispatchReadinessCode =
  | "ready"
  | "registered_no_session"
  | "not_registered"
  | "session_ensure_failed"
  | "unresolved_member";

export type MemberDispatchCandidate = {
  memberId: string;
  agentId?: string;
  displayName?: string;
  /**
   * @deprecated Prefer resolveMember from trusted runtime. When resolveMember is
   * omitted, registration may be supplied for unit tests only.
   */
  registration?: MemberRegistrationStatus;
  sessionKey?: string;
};

export type TrustedMemberResolution = {
  memberId: string;
  agentId: string | null;
  displayName: string | null;
  registration: MemberRegistrationStatus;
  sessionKey: string | null;
  /** Optional structured gap hint from the trusted resolver (wake / RPC). */
  detail?: string | null;
};

export type MemberDispatchReadiness = {
  memberId: string;
  agentId: string | null;
  displayName: string | null;
  code: DispatchReadinessCode;
  dispatchable: boolean;
  sessionKey: string | null;
  sessionEnsured: boolean;
  detail?: string;
};

export type CheckMemberDispatchReadinessInput = {
  members: readonly MemberDispatchCandidate[];
  /**
   * Trusted resolver — registration/agent/session come from runtime roster,
   * not the request body. Required for production gateway handlers.
   */
  resolveMember?: (
    memberId: string,
  ) => TrustedMemberResolution | Promise<TrustedMemberResolution | null> | null;
  sessionExists?: (agentId: string, sessionKey: string) => boolean | Promise<boolean>;
  /**
   * Controlled session create. Must only be supplied on write-scoped entrypoints.
   * Read-scoped checkDispatchReadiness must omit this.
   */
  ensureSession?: (agentId: string, sessionKey: string) => Promise<void>;
  /** Default false — read checks must not write. */
  autoEnsureSession?: boolean;
  cfg?: OpenBotConfig;
};

export type CheckMemberDispatchReadinessResult = {
  members: MemberDispatchReadiness[];
  allDispatchable: boolean;
  gaps: Array<{ memberId: string; code: DispatchReadinessCode; detail?: string }>;
};

function compact(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Default ensure: create a minimal main session entry in the agent session store.
 * Does not invent registration — caller must already mark the member registered.
 * Must not be invoked from operator.read handlers.
 */
/** Strict agent↔sessionKey binding using the canonical conversation key helper. */
export function assertAgentBoundSessionKey(agentId: string, sessionKey: string): void {
  const id = compact(agentId);
  const key = compact(sessionKey);
  const expected = defaultConversationSessionKey(id);
  if (!id || !key || key !== expected) {
    throw new Error(`sessionKey not bound to agentId=${id}: expected ${expected}`);
  }
}

export async function ensureRegisteredMemberMainSession(params: {
  agentId: string;
  sessionKey?: string;
  /** Required binding check — sessionKey must belong to this agent. */
  expectAgentBoundSession?: boolean;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ sessionKey: string; created: boolean }> {
  const agentId = compact(params.agentId);
  if (!agentId) {
    throw new Error("agentId is required");
  }
  const expected = defaultConversationSessionKey(agentId);
  const sessionKey = compact(params.sessionKey) || expected;
  if (params.expectAgentBoundSession !== false) {
    // Strict binding via the canonical session-key helper — no substring includes().
    if (sessionKey !== expected) {
      throw new Error(`sessionKey not bound to agentId=${agentId}: expected ${expected}`);
    }
  }
  const cfg = params.cfg ?? loadConfig();
  const storePath = resolveStorePath(cfg.session?.store, { agentId });
  const now = params.nowMs ?? Date.now();
  let created = false;
  await updateSessionStore(storePath, (store) => {
    const existing = store[sessionKey];
    if (existing?.sessionId) {
      return;
    }
    created = true;
    store[sessionKey] = mergeSessionEntry(existing, {
      sessionId: randomUUID(),
      updatedAt: now,
    });
  });
  return { sessionKey, created };
}

function defaultSessionExistsFactory(cfg: OpenBotConfig) {
  return (agentId: string, sessionKey: string): boolean => {
    const storePath = resolveStorePath(cfg.session?.store, { agentId });
    try {
      const store = loadSessionStore(storePath, { skipCache: true });
      return Boolean(store[sessionKey]?.sessionId);
    } catch {
      return false;
    }
  };
}

/**
 * Evaluate dispatch readiness for each candidate. not_registered never becomes ready.
 * Empty session create is never treated as proof of model/tool readiness — only
 * that a session record exists when ensureSession was explicitly provided.
 */
export async function checkMemberDispatchReadiness(
  params: CheckMemberDispatchReadinessInput,
): Promise<CheckMemberDispatchReadinessResult> {
  const cfg = params.cfg ?? loadConfig();
  const sessionExists = params.sessionExists ?? defaultSessionExistsFactory(cfg);
  const autoEnsure = params.autoEnsureSession === true;
  const results: MemberDispatchReadiness[] = [];

  for (const member of params.members) {
    const requestedId = compact(member.memberId);
    if (!requestedId) {
      continue;
    }

    let registration: MemberRegistrationStatus = "not_registered";
    let agentId = "";
    let displayName: string | null = null;
    let sessionKey = "";
    let resolutionDetail: string | null = null;

    if (params.resolveMember) {
      const resolved = await params.resolveMember(requestedId);
      if (!resolved) {
        results.push({
          memberId: requestedId,
          agentId: null,
          displayName: null,
          code: "unresolved_member",
          dispatchable: false,
          sessionKey: null,
          sessionEnsured: false,
          detail: "member not found in trusted roster",
        });
        continue;
      }
      registration = resolved.registration;
      agentId = compact(resolved.agentId ?? undefined) || compact(resolved.memberId);
      displayName = compact(resolved.displayName ?? undefined) || null;
      sessionKey =
        compact(resolved.sessionKey ?? undefined) ||
        (agentId ? defaultConversationSessionKey(agentId) : "");
      resolutionDetail = compact(resolved.detail ?? undefined) || null;
    } else {
      // Test / internal path only — still refuse invented registration when omitted.
      registration = member.registration === "registered" ? "registered" : "not_registered";
      agentId = compact(member.agentId) || requestedId;
      displayName = compact(member.displayName) || null;
      sessionKey =
        compact(member.sessionKey) || (agentId ? defaultConversationSessionKey(agentId) : "");
    }

    if (registration === "not_registered" || !agentId) {
      results.push({
        memberId: requestedId,
        agentId: agentId || null,
        displayName,
        code: "not_registered",
        dispatchable: false,
        sessionKey: null,
        sessionEnsured: false,
        detail: resolutionDetail || "not_registered cannot be dispatched",
      });
      continue;
    }

    const exists = await sessionExists(agentId, sessionKey);
    if (exists) {
      results.push({
        memberId: requestedId,
        agentId,
        displayName,
        code: "ready",
        dispatchable: true,
        sessionKey,
        sessionEnsured: false,
        detail: "session record present — not a model/tool capability proof",
      });
      continue;
    }

    if (!autoEnsure || !params.ensureSession) {
      results.push({
        memberId: requestedId,
        agentId,
        displayName,
        code: "registered_no_session",
        dispatchable: false,
        sessionKey,
        sessionEnsured: false,
        detail: "registered but main session missing; read check does not create sessions",
      });
      continue;
    }

    try {
      await params.ensureSession(agentId, sessionKey);
      const after = await sessionExists(agentId, sessionKey);
      if (!after) {
        results.push({
          memberId: requestedId,
          agentId,
          displayName,
          code: "session_ensure_failed",
          dispatchable: false,
          sessionKey,
          sessionEnsured: false,
          detail: "ensureSession returned but session still missing",
        });
        continue;
      }
      results.push({
        memberId: requestedId,
        agentId,
        displayName,
        code: "ready",
        dispatchable: true,
        sessionKey,
        sessionEnsured: true,
        detail: "session record ensured — not a model/tool capability proof",
      });
    } catch (error) {
      results.push({
        memberId: requestedId,
        agentId,
        displayName,
        code: "session_ensure_failed",
        dispatchable: false,
        sessionKey,
        sessionEnsured: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const gaps = results
    .filter((row) => !row.dispatchable)
    .map((row) => ({
      memberId: row.memberId,
      code: row.code,
      detail: row.detail,
    }));

  return {
    members: results,
    allDispatchable: gaps.length === 0,
    gaps,
  };
}
