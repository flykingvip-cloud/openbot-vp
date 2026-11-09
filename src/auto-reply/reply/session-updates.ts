import crypto from "node:crypto";
import { resolveUserTimezone } from "../../agents/date-time.js";
import { buildWorkspaceSkillSnapshot } from "../../agents/skills.js";
import { matchesSkillFilter } from "../../agents/skills/filter.js";
import { ensureSkillsWatcher, getSkillsSnapshotVersion } from "../../agents/skills/refresh.js";
import type { OpenBotConfig } from "../../config/config.js";
import { isSharedTenantAddressingEnabled } from "../../config/data-space.js";
import { type SessionEntry, updateSessionStore } from "../../config/sessions.js";
import { rewriteTenantsVolumeUserPaths } from "../../gateway/workspace/operator-workspace-heal.js";
import { buildChannelSummary } from "../../infra/channel-summary.js";
import {
  resolveTimezone,
  formatUtcTimestamp,
  formatZonedTimestamp,
} from "../../infra/format-time/format-datetime.ts";
import { getRemoteSkillEligibility } from "../../infra/skills-remote.js";
import { drainSystemEventEntries } from "../../infra/system-events.js";

/** Drain queued system events, format as `System:` lines, return the block (or undefined). */
export async function drainFormattedSystemEvents(params: {
  cfg: OpenBotConfig;
  sessionKey: string;
  isMainSession: boolean;
  isNewSession: boolean;
}): Promise<string | undefined> {
  const compactSystemEvent = (line: string): string | null => {
    const trimmed = line.trim();
    if (!trimmed) {
      return null;
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes("reason periodic")) {
      return null;
    }
    // Filter out the actual heartbeat prompt, but not cron jobs that mention "heartbeat"
    // The heartbeat prompt starts with "Read HEARTBEAT.md" - cron payloads won't match this
    if (lower.startsWith("read heartbeat.md")) {
      return null;
    }
    // Also filter heartbeat poll/wake noise
    if (lower.includes("heartbeat poll") || lower.includes("heartbeat wake")) {
      return null;
    }
    if (trimmed.startsWith("Node:")) {
      return trimmed.replace(/ · last input [^·]+/i, "").trim();
    }
    return trimmed;
  };

  const resolveSystemEventTimezone = (cfg: OpenBotConfig) => {
    const raw = cfg.agents?.defaults?.envelopeTimezone?.trim();
    if (!raw) {
      return { mode: "local" as const };
    }
    const lowered = raw.toLowerCase();
    if (lowered === "utc" || lowered === "gmt") {
      return { mode: "utc" as const };
    }
    if (lowered === "local" || lowered === "host") {
      return { mode: "local" as const };
    }
    if (lowered === "user") {
      return {
        mode: "iana" as const,
        timeZone: resolveUserTimezone(cfg.agents?.defaults?.userTimezone),
      };
    }
    const explicit = resolveTimezone(raw);
    return explicit ? { mode: "iana" as const, timeZone: explicit } : { mode: "local" as const };
  };

  const formatSystemEventTimestamp = (ts: number, cfg: OpenBotConfig) => {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) {
      return "unknown-time";
    }
    const zone = resolveSystemEventTimezone(cfg);
    if (zone.mode === "utc") {
      return formatUtcTimestamp(date, { displaySeconds: true });
    }
    if (zone.mode === "local") {
      return formatZonedTimestamp(date, { displaySeconds: true }) ?? "unknown-time";
    }
    return (
      formatZonedTimestamp(date, { timeZone: zone.timeZone, displaySeconds: true }) ??
      "unknown-time"
    );
  };

  const systemLines: string[] = [];
  const queued = drainSystemEventEntries(params.sessionKey);
  systemLines.push(
    ...queued
      .map((event) => {
        const compacted = compactSystemEvent(event.text);
        if (!compacted) {
          return null;
        }
        return `[${formatSystemEventTimestamp(event.ts, params.cfg)}] ${compacted}`;
      })
      .filter((v): v is string => Boolean(v)),
  );
  if (params.isMainSession && params.isNewSession) {
    const summary = await buildChannelSummary(params.cfg);
    if (summary.length > 0) {
      systemLines.unshift(...summary);
    }
  }
  if (systemLines.length === 0) {
    return undefined;
  }

  // Format events as trusted System: lines for the system-role prompt.
  // Inbound sanitization rewrites any user-supplied "System:" to "System (untrusted):",
  // so these gateway-originated lines are distinguishable by the model.
  // Each sub-line of a multi-line event gets its own System: prefix so continuation
  // lines can't be mistaken for user content. Do not fuse this block into the
  // next user instruction — get-reply-run injects it via extraSystemPrompt.
  return systemLines
    .flatMap((line) => line.split("\n").map((subline) => `System: ${subline}`))
    .join("\n");
}

export async function ensureSkillSnapshot(params: {
  sessionEntry?: SessionEntry;
  sessionStore?: Record<string, SessionEntry>;
  sessionKey?: string;
  storePath?: string;
  sessionId?: string;
  isFirstTurnInSession: boolean;
  workspaceDir: string;
  cfg: OpenBotConfig;
  /** If provided, only load skills with these names (for per-channel skill filtering) */
  skillFilter?: string[];
  /** Names subtracted after the allow-list (or from the full catalog). */
  skillBlocklist?: string[];
  /** Turn-scoped names ranked into the prompt prefix; not an allow-list. */
  preferSkillNames?: string[];
}): Promise<{
  sessionEntry?: SessionEntry;
  skillsSnapshot?: SessionEntry["skillsSnapshot"];
  systemSent: boolean;
}> {
  if (process.env.OPENCLAW_TEST_FAST === "1") {
    // In fast unit-test runs we skip filesystem scanning, watchers, and session-store writes.
    // Dedicated skills tests cover snapshot generation behavior.
    return {
      sessionEntry: params.sessionEntry,
      skillsSnapshot: params.sessionEntry?.skillsSnapshot,
      systemSent: params.sessionEntry?.systemSent ?? false,
    };
  }

  const {
    sessionEntry,
    sessionStore,
    sessionKey,
    storePath,
    sessionId,
    isFirstTurnInSession,
    workspaceDir,
    cfg,
    skillFilter,
    skillBlocklist,
    preferSkillNames,
  } = params;

  let nextEntry = sessionEntry;
  let systemSent = sessionEntry?.systemSent ?? false;
  const remoteEligibility = getRemoteSkillEligibility();
  const snapshotVersion = getSkillsSnapshotVersion(workspaceDir);
  ensureSkillsWatcher({ workspaceDir, config: cfg });
  const policyChanged =
    !matchesSkillFilter(nextEntry?.skillsSnapshot?.skillFilter, skillFilter) ||
    !matchesSkillFilter(nextEntry?.skillsSnapshot?.skillBlocklist, skillBlocklist) ||
    !matchesSkillFilter(nextEntry?.skillsSnapshot?.preferSkillNames, preferSkillNames);
  const shouldRefreshSnapshot =
    (snapshotVersion > 0 && (nextEntry?.skillsSnapshot?.version ?? 0) < snapshotVersion) ||
    policyChanged;
  const snapshotOpts = {
    config: cfg,
    skillFilter,
    ...(skillBlocklist && skillBlocklist.length > 0 ? { skillBlocklist } : {}),
    ...(preferSkillNames && preferSkillNames.length > 0 ? { preferSkillNames } : {}),
    eligibility: { remote: remoteEligibility },
    snapshotVersion,
  };

  if (isFirstTurnInSession && sessionStore && sessionKey) {
    const current = nextEntry ??
      sessionStore[sessionKey] ?? {
        sessionId: sessionId ?? crypto.randomUUID(),
        updatedAt: Date.now(),
      };
    const skillSnapshot =
      isFirstTurnInSession || !current.skillsSnapshot || shouldRefreshSnapshot
        ? buildWorkspaceSkillSnapshot(workspaceDir, snapshotOpts)
        : current.skillsSnapshot;
    nextEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      systemSent: true,
      skillsSnapshot: skillSnapshot,
    };
    sessionStore[sessionKey] = { ...sessionStore[sessionKey], ...nextEntry };
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = { ...store[sessionKey], ...nextEntry };
      });
    }
    systemSent = true;
  }

  let skillsSnapshot = shouldRefreshSnapshot
    ? buildWorkspaceSkillSnapshot(workspaceDir, snapshotOpts)
    : (nextEntry?.skillsSnapshot ??
      (isFirstTurnInSession ? undefined : buildWorkspaceSkillSnapshot(workspaceDir, snapshotOpts)));
  if (skillsSnapshot && isSharedTenantAddressingEnabled(cfg)) {
    const healed = rewriteTenantsVolumeUserPaths(skillsSnapshot);
    if (healed !== skillsSnapshot) {
      skillsSnapshot = healed;
      if (nextEntry) {
        nextEntry = { ...nextEntry, updatedAt: Date.now(), skillsSnapshot };
      }
      if (sessionStore && sessionKey) {
        const current = nextEntry ??
          sessionStore[sessionKey] ?? {
            sessionId: sessionId ?? crypto.randomUUID(),
            updatedAt: Date.now(),
          };
        nextEntry = {
          ...current,
          sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
          updatedAt: Date.now(),
          skillsSnapshot,
        };
        sessionStore[sessionKey] = { ...sessionStore[sessionKey], ...nextEntry };
        if (storePath) {
          await updateSessionStore(storePath, (store) => {
            store[sessionKey] = { ...store[sessionKey], ...nextEntry };
          });
        }
      }
    }
  }
  if (
    skillsSnapshot &&
    sessionStore &&
    sessionKey &&
    !isFirstTurnInSession &&
    (!nextEntry?.skillsSnapshot || shouldRefreshSnapshot)
  ) {
    const current = nextEntry ?? {
      sessionId: sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    nextEntry = {
      ...current,
      sessionId: sessionId ?? current.sessionId ?? crypto.randomUUID(),
      updatedAt: Date.now(),
      skillsSnapshot,
    };
    sessionStore[sessionKey] = { ...sessionStore[sessionKey], ...nextEntry };
    if (storePath) {
      await updateSessionStore(storePath, (store) => {
        store[sessionKey] = { ...store[sessionKey], ...nextEntry };
      });
    }
  }

  return { sessionEntry: nextEntry, skillsSnapshot, systemSent };
}

export { incrementCompactionCount } from "../../agent-runtime/state/index.js";
