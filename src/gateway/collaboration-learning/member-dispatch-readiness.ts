/**
 * TEAM-REAL F3 — Member dispatch readiness before派工.
 *
 * - not_registered → never dispatchable
 * - registered_no_session → may controlled-create a main session when ensureSession works
 * - ready → registered + session exists (or just ensured)
 *
 * Does not treat oral "已送达" as success when a member is unavailable.
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

export type MemberRegistrationStatus = "registered" | "not_registered";

export type DispatchReadinessCode =
  | "ready"
  | "registered_no_session"
  | "not_registered"
  | "session_ensure_failed";

export type MemberDispatchCandidate = {
  memberId: string;
  agentId?: string;
  displayName?: string;
  /** Caller-supplied registration fact (from enterprise roster / group members). */
  registration: MemberRegistrationStatus;
  /** When omitted for registered bots, sessionKey defaults to agent:id:main. */
  sessionKey?: string;
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
  /** Returns whether the main session already exists. */
  sessionExists?: (agentId: string, sessionKey: string) => boolean | Promise<boolean>;
  /**
   * Controlled session create for registered_no_session.
   * When omitted, registered_no_session stays non-dispatchable (gap recorded).
   */
  ensureSession?: (agentId: string, sessionKey: string) => Promise<void>;
  /** When true (default), call ensureSession for registered_no_session. */
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

function resolveAgentId(member: MemberDispatchCandidate): string {
  return compact(member.agentId) || compact(member.memberId);
}

/**
 * Default ensure: create a minimal main session entry in the agent session store.
 * Does not invent registration — caller must already mark the member registered.
 */
export async function ensureRegisteredMemberMainSession(params: {
  agentId: string;
  sessionKey?: string;
  cfg?: OpenBotConfig;
  nowMs?: number;
}): Promise<{ sessionKey: string; created: boolean }> {
  const agentId = compact(params.agentId);
  if (!agentId) {
    throw new Error("agentId is required");
  }
  const sessionKey = compact(params.sessionKey) || defaultConversationSessionKey(agentId);
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
 */
export async function checkMemberDispatchReadiness(
  params: CheckMemberDispatchReadinessInput,
): Promise<CheckMemberDispatchReadinessResult> {
  const cfg = params.cfg ?? loadConfig();
  const sessionExists = params.sessionExists ?? defaultSessionExistsFactory(cfg);
  const autoEnsure = params.autoEnsureSession !== false;
  const results: MemberDispatchReadiness[] = [];

  for (const member of params.members) {
    const memberId = compact(member.memberId) || resolveAgentId(member);
    const agentId = resolveAgentId(member);
    const displayName = compact(member.displayName) || null;
    const sessionKey =
      compact(member.sessionKey) || (agentId ? defaultConversationSessionKey(agentId) : "");

    if (member.registration === "not_registered" || !agentId) {
      results.push({
        memberId,
        agentId: agentId || null,
        displayName,
        code: "not_registered",
        dispatchable: false,
        sessionKey: null,
        sessionEnsured: false,
        detail: "not_registered cannot be dispatched",
      });
      continue;
    }

    const exists = await sessionExists(agentId, sessionKey);
    if (exists) {
      results.push({
        memberId,
        agentId,
        displayName,
        code: "ready",
        dispatchable: true,
        sessionKey,
        sessionEnsured: false,
      });
      continue;
    }

    if (!autoEnsure || !params.ensureSession) {
      results.push({
        memberId,
        agentId,
        displayName,
        code: "registered_no_session",
        dispatchable: false,
        sessionKey,
        sessionEnsured: false,
        detail: "registered but main session missing; ensureSession not applied",
      });
      continue;
    }

    try {
      await params.ensureSession(agentId, sessionKey);
      const after = await sessionExists(agentId, sessionKey);
      if (!after) {
        results.push({
          memberId,
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
        memberId,
        agentId,
        displayName,
        code: "ready",
        dispatchable: true,
        sessionKey,
        sessionEnsured: true,
      });
    } catch (error) {
      results.push({
        memberId,
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
