/**
 * Desktop Takeover Learning (ROADMAP v3 M5).
 *
 * Bridge Account Computer takeover episodes into a small, testable learning
 * module + draft skill curation hook. Does NOT rebuild collaboration-learning
 * and does NOT change ownership FSM semantics.
 *
 * Causality inputs (already exist upstream): session phase, stall, ownership,
 * agent-action summary, human takeover / hand-back.
 *
 * Iron rules:
 * - No location.reload / DPR / chrome pile-on
 * - streamUrl ≠ FIRST_FRAME ≠ INTERACTIVE
 * - No tokens / full URLs in stored summaries (host + path OK)
 * - Ownership reduce stays authoritative; this module only observes
 */

import type { DesktopSessionPhase } from "./desktop-session-state.ts";
import type {
  InteractionLeasePhase,
  InteractionOwnershipSnapshot,
} from "./interaction-ownership.ts";

/** Loom landing stream id for M5. */
export const DESKTOP_TAKEOVER_LEARNING_LANDING = "DESKTOP_TAKEOVER_LEARNING_M5" as const;

/** Follow-up: siteHost wiring + draft skill persist hook. */
export const DESKTOP_TAKEOVER_SITEHOST_SKILL_LANDING =
  "DESKTOP_TAKEOVER_SITEHOST_SKILL_M1" as const;

export type TakeoverTriggerReason =
  | "uncertain_decision"
  | "user_preempt"
  | "stall_recover"
  | "other";

export type TakeoverOutcome = "resolved" | "abandoned" | "unknown";

export type TakeoverEpisode = {
  episodeId: string;
  accountKey: string;
  /** Normalized hostname only (no credentials / query / fragment). */
  siteHost: string | null;
  sessionPhase: DesktopSessionPhase | null;
  ownershipBefore: InteractionLeasePhase | null;
  ownershipDuring: InteractionLeasePhase;
  ownershipAfter: InteractionLeasePhase | null;
  triggerReason: TakeoverTriggerReason;
  /** Short redacted string — no tokens / no full URLs. */
  agentActionSummary: string;
  outcome: TakeoverOutcome;
  humanSessionKey: string | null;
  holderAgentId: string | null;
  startedAt: number;
  endedAt: number | null;
};

export type SiteSkillDraft = {
  siteHost: string;
  title: string;
  lesson: string;
  capabilities: string[];
};

export type BeginTakeoverEpisodeInput = {
  accountKey: string;
  humanSessionKey?: string | null;
  holderAgentId?: string | null;
  /** Raw page URL or host; normalized via normalizeSiteHost. */
  pageUrl?: string | null;
  siteHost?: string | null;
  sessionPhase?: DesktopSessionPhase | null;
  ownershipBefore?: InteractionLeasePhase | null;
  triggerReason?: TakeoverTriggerReason;
  agentActionSummary?: string | null;
  now?: number;
  episodeId?: string;
};

export type CompleteTakeoverEpisodeInput = {
  episodeId?: string;
  accountKey?: string;
  outcome?: TakeoverOutcome;
  ownershipAfter?: InteractionLeasePhase | null;
  now?: number;
};

const TOKENISH = /(?:token|access_token|refresh_token|password|grant|authorization)=[^&\s#]+/gi;
const FULL_URL = /https?:\/\/[^\s"'<>]+/gi;
const BEARERISH = /\b(?:bearer|api[_-]?key|secret)[=:\s]+[^\s"'<>]+/gi;

const MAX_SUMMARY_CHARS = 240;

/**
 * Normalize a page URL (or bare host) to a hostname.
 * Strips credentials, port is kept only when non-default is not required —
 * MVP keeps hostname only (no port / path / query).
 */
export function normalizeSiteHost(pageUrlOrHost: string | null | undefined): string | null {
  const raw = (pageUrlOrHost ?? "").trim();
  if (!raw) {
    return null;
  }
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    const host = u.hostname.trim().toLowerCase();
    if (!host || host === "localhost" || host === "127.0.0.1" || host === "::1") {
      // Still allow localhost for tests / local desktops — return it.
      return host || null;
    }
    return host || null;
  } catch {
    // Bare "example.com/path?x=1" without inventable URL — strip path/query manually.
    const noCred = raw.includes("@") ? raw.slice(raw.lastIndexOf("@") + 1) : raw;
    const hostPart = noCred.split(/[/?#]/)[0]?.split(":")[0]?.trim().toLowerCase() ?? "";
    return hostPart || null;
  }
}

/**
 * Redact tokens and absolute URLs from an agent-action blurb.
 * Host + path fragments are OK; query secrets become REDACTED.
 */
export function redactAgentActionSummary(summary: string | null | undefined): string {
  const raw = (summary ?? "").trim();
  if (!raw) {
    return "";
  }
  const cleaned = raw
    .replace(TOKENISH, (m) => {
      const eq = m.indexOf("=");
      return eq >= 0 ? `${m.slice(0, eq)}=REDACTED` : "REDACTED";
    })
    .replace(BEARERISH, (m) => {
      const cut = m.search(/[=:\s]/);
      const head = cut >= 0 ? m.slice(0, cut + 1) : "";
      return `${head}REDACTED`;
    })
    .replace(FULL_URL, (m) => {
      try {
        const u = new URL(m);
        const path = u.pathname && u.pathname !== "/" ? u.pathname : "";
        return `${u.hostname}${path}`;
      } catch {
        return "[url]";
      }
    })
    .replace(/[a-f0-9]{40,}/gi, "[hash]");
  return cleaned.slice(0, MAX_SUMMARY_CHARS);
}

export type TakeoverLearningStore = {
  begin: (input: BeginTakeoverEpisodeInput) => TakeoverEpisode;
  complete: (input?: CompleteTakeoverEpisodeInput) => TakeoverEpisode | null;
  abandon: (input?: CompleteTakeoverEpisodeInput) => TakeoverEpisode | null;
  getActive: (accountKey?: string) => TakeoverEpisode | null;
  list: () => readonly TakeoverEpisode[];
  clear: () => void;
};

function newEpisodeId(now: number): string {
  return `tle-${now.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Pure in-memory store (session-local). Injectable for hermetic vitest;
 * gateway may later ingest completed episodes via list()/export.
 */
export function createTakeoverLearningStore(): TakeoverLearningStore {
  const episodes: TakeoverEpisode[] = [];
  /** accountKey → active episodeId */
  const activeByAccount = new Map<string, string>();

  function findActive(accountKey: string): TakeoverEpisode | null {
    const id = activeByAccount.get(accountKey);
    if (!id) {
      return null;
    }
    return episodes.find((e) => e.episodeId === id && e.endedAt == null) ?? null;
  }

  function resolveTarget(input?: CompleteTakeoverEpisodeInput): TakeoverEpisode | null {
    if (input?.episodeId) {
      return episodes.find((e) => e.episodeId === input.episodeId && e.endedAt == null) ?? null;
    }
    const key = (input?.accountKey ?? "").trim();
    if (key) {
      return findActive(key);
    }
    // Fall back to the sole active episode when only one account is in takeover.
    if (activeByAccount.size === 1) {
      const onlyKey = activeByAccount.keys().next().value as string;
      return findActive(onlyKey);
    }
    return null;
  }

  function finish(
    ep: TakeoverEpisode,
    outcome: TakeoverOutcome,
    ownershipAfter: InteractionLeasePhase | null,
    now: number,
  ): TakeoverEpisode {
    ep.outcome = outcome;
    ep.ownershipAfter = ownershipAfter;
    ep.endedAt = now;
    activeByAccount.delete(ep.accountKey);
    return ep;
  }

  return {
    begin(input: BeginTakeoverEpisodeInput): TakeoverEpisode {
      const accountKey = input.accountKey.trim() || "\0pending";
      const now = input.now ?? Date.now();
      // One active episode per account — complete prior as abandoned if still open.
      const prior = findActive(accountKey);
      if (prior) {
        finish(prior, "abandoned", null, now);
      }
      const siteHost =
        (input.siteHost != null && input.siteHost.trim() !== ""
          ? normalizeSiteHost(input.siteHost)
          : null) ?? normalizeSiteHost(input.pageUrl);
      const ep: TakeoverEpisode = {
        episodeId: input.episodeId?.trim() || newEpisodeId(now),
        accountKey,
        siteHost,
        sessionPhase: input.sessionPhase ?? null,
        ownershipBefore: input.ownershipBefore ?? null,
        ownershipDuring: "HUMAN_TAKEOVER",
        ownershipAfter: null,
        triggerReason: input.triggerReason ?? "user_preempt",
        agentActionSummary: redactAgentActionSummary(input.agentActionSummary),
        outcome: "unknown",
        humanSessionKey: input.humanSessionKey?.trim() || null,
        holderAgentId: input.holderAgentId?.trim() || null,
        startedAt: now,
        endedAt: null,
      };
      episodes.push(ep);
      activeByAccount.set(accountKey, ep.episodeId);
      return ep;
    },

    complete(input: CompleteTakeoverEpisodeInput = {}): TakeoverEpisode | null {
      const ep = resolveTarget(input);
      if (!ep) {
        return null;
      }
      const outcome = input.outcome ?? "resolved";
      return finish(ep, outcome, input.ownershipAfter ?? "GRACE", input.now ?? Date.now());
    },

    abandon(input: CompleteTakeoverEpisodeInput = {}): TakeoverEpisode | null {
      const ep = resolveTarget(input);
      if (!ep) {
        return null;
      }
      return finish(
        ep,
        input.outcome ?? "abandoned",
        input.ownershipAfter ?? null,
        input.now ?? Date.now(),
      );
    },

    getActive(accountKey?: string): TakeoverEpisode | null {
      const key = (accountKey ?? "").trim();
      if (key) {
        return findActive(key);
      }
      if (activeByAccount.size === 1) {
        const onlyKey = activeByAccount.keys().next().value as string;
        return findActive(onlyKey);
      }
      return null;
    },

    list(): readonly TakeoverEpisode[] {
      return episodes.slice();
    },

    clear(): void {
      episodes.length = 0;
      activeByAccount.clear();
    },
  };
}

export type CompletedTakeoverSkillDraft = {
  draft: SiteSkillDraft;
  episodeId: string;
  completedAt: number;
};

export type TakeoverSkillDraftHost = {
  /** Optional Control UI / gateway hook — persist without blocking preview. */
  onTakeoverSkillDraft?: (draft: SiteSkillDraft) => void;
};

const completedDrafts: CompletedTakeoverSkillDraft[] = [];
let draftHost: TakeoverSkillDraftHost | null = null;

export function setTakeoverSkillDraftHost(host: TakeoverSkillDraftHost | null): void {
  draftHost = host;
}

export function listTakeoverSkillDrafts(): readonly CompletedTakeoverSkillDraft[] {
  return completedDrafts.slice();
}

/** Return and clear buffered drafts (for host flush). */
export function consumeTakeoverSkillDrafts(): CompletedTakeoverSkillDraft[] {
  const out = completedDrafts.splice(0, completedDrafts.length);
  return out;
}

/**
 * When a resolved episode yields a SiteSkillDraft, buffer it and notify the host hook.
 * Never auto-approves; persist is host/gateway responsibility via persistTakeoverSiteSkillDraft.
 */
export function maybeRecordTakeoverSkillDraft(
  episode: TakeoverEpisode | null | undefined,
): SiteSkillDraft | null {
  if (!episode || episode.outcome !== "resolved" || episode.endedAt == null) {
    return null;
  }
  const draft = deriveSiteSkillDraft(episode);
  if (!draft) {
    return null;
  }
  if (completedDrafts.some((e) => e.episodeId === episode.episodeId)) {
    return draft;
  }
  completedDrafts.push({
    draft,
    episodeId: episode.episodeId,
    completedAt: episode.endedAt,
  });
  try {
    draftHost?.onTakeoverSkillDraft?.(draft);
  } catch {
    // Host must not break the preview path.
  }
  return draft;
}

/** Default session-local store used by preview wiring. */
const defaultStore = createTakeoverLearningStore();

export function getDefaultTakeoverLearningStore(): TakeoverLearningStore {
  return defaultStore;
}

export function resetTakeoverLearningForTests(): void {
  defaultStore.clear();
  completedDrafts.length = 0;
  draftHost = null;
}

export function beginTakeoverEpisode(input: BeginTakeoverEpisodeInput): TakeoverEpisode {
  return defaultStore.begin(input);
}

export function completeTakeoverEpisode(
  input: CompleteTakeoverEpisodeInput = {},
): TakeoverEpisode | null {
  const ep = defaultStore.complete(input);
  maybeRecordTakeoverSkillDraft(ep);
  return ep;
}

export function abandonTakeoverEpisode(
  input: CompleteTakeoverEpisodeInput = {},
): TakeoverEpisode | null {
  return defaultStore.abandon(input);
}

export function getActiveTakeoverEpisode(accountKey?: string): TakeoverEpisode | null {
  return defaultStore.getActive(accountKey);
}

/**
 * Draft a per-site skill only when the episode resolved and has a siteHost.
 * Deferred: auto-publish, video demo ingest, collaboration-capsule promotion.
 */
export function deriveSiteSkillDraft(episode: TakeoverEpisode): SiteSkillDraft | null {
  if (episode.outcome !== "resolved") {
    return null;
  }
  const host = episode.siteHost?.trim() || null;
  if (!host) {
    return null;
  }
  const reasonLabel =
    episode.triggerReason === "uncertain_decision"
      ? "uncertain decision"
      : episode.triggerReason === "stall_recover"
        ? "stall recovery"
        : episode.triggerReason === "user_preempt"
          ? "user preempt"
          : "takeover";
  const summary = episode.agentActionSummary.trim();
  const lesson = summary
    ? `Human resolved a ${reasonLabel} on ${host}: ${summary}`
    : `Human resolved a ${reasonLabel} on ${host} and handed control back.`;
  const capabilities: string[] = ["desktop.takeover", "desktop.hand_back"];
  if (episode.sessionPhase === "STREAM_STALLED" || episode.triggerReason === "stall_recover") {
    capabilities.push("desktop.stall_recover");
  }
  if (summary) {
    capabilities.push("desktop.agent_action_context");
  }
  return {
    siteHost: host,
    title: `Takeover lesson · ${host}`,
    lesson: redactAgentActionSummary(lesson),
    capabilities,
  };
}

export type OwnershipLearningContext = {
  accountKey: string;
  pageUrl?: string | null;
  siteHost?: string | null;
  sessionPhase?: DesktopSessionPhase | null;
  triggerReason?: TakeoverTriggerReason;
  agentActionSummary?: string | null;
  now?: number;
  store?: TakeoverLearningStore;
};

/**
 * Thin observer for ownership transitions. Does not mutate ownership snapshots.
 * - → HUMAN_TAKEOVER: begin episode
 * - HUMAN_TAKEOVER → GRACE (hand-back): complete resolved
 * - GRACE → BACKGROUND_AGENT: complete resolved if still active
 * - RESET / leave takeover without hand-back: abandon
 */
export function observeOwnershipTransitionForLearning(
  prev: InteractionOwnershipSnapshot,
  next: InteractionOwnershipSnapshot,
  ctx: OwnershipLearningContext,
): TakeoverEpisode | null {
  const store = ctx.store ?? defaultStore;
  const accountKey = ctx.accountKey.trim() || "\0pending";
  const now = ctx.now ?? Date.now();

  if (prev.phase !== "HUMAN_TAKEOVER" && next.phase === "HUMAN_TAKEOVER") {
    return store.begin({
      accountKey,
      humanSessionKey: next.humanSessionKey,
      holderAgentId: next.holderAgentId,
      pageUrl: ctx.pageUrl,
      siteHost: ctx.siteHost,
      sessionPhase: ctx.sessionPhase ?? null,
      ownershipBefore: prev.phase,
      triggerReason: ctx.triggerReason ?? inferTriggerReason(prev, ctx),
      agentActionSummary: ctx.agentActionSummary,
      now,
    });
  }

  if (prev.phase === "HUMAN_TAKEOVER" && next.phase === "GRACE") {
    const ep = store.complete({
      accountKey,
      outcome: "resolved",
      ownershipAfter: "GRACE",
      now,
    });
    maybeRecordTakeoverSkillDraft(ep);
    return ep;
  }

  if (prev.phase === "GRACE" && next.phase === "BACKGROUND_AGENT") {
    // Safety: complete if hand-back path somehow left episode open.
    const active = store.getActive(accountKey);
    if (active) {
      const ep = store.complete({
        accountKey,
        outcome: "resolved",
        ownershipAfter: "BACKGROUND_AGENT",
        now,
      });
      maybeRecordTakeoverSkillDraft(ep);
      return ep;
    }
    return null;
  }

  if (
    prev.phase === "HUMAN_TAKEOVER" &&
    next.phase !== "HUMAN_TAKEOVER" &&
    next.phase !== "GRACE"
  ) {
    return store.abandon({
      accountKey,
      ownershipAfter: next.phase,
      now,
    });
  }

  return null;
}

function inferTriggerReason(
  prev: InteractionOwnershipSnapshot,
  ctx: OwnershipLearningContext,
): TakeoverTriggerReason {
  if (ctx.triggerReason) {
    return ctx.triggerReason;
  }
  if (ctx.sessionPhase === "STREAM_STALLED" || ctx.sessionPhase === "RECONNECTING") {
    return "stall_recover";
  }
  if (prev.phase === "INTERACTIVE" || prev.phase === "LEASE_REQUEST") {
    return "user_preempt";
  }
  return "other";
}

/** Observability attributes for accept / DOM. */
export function takeoverLearningDataAttrs(episode: TakeoverEpisode | null | undefined): {
  "data-takeover-learning": "active" | "idle";
  "data-takeover-site-host": string;
} {
  const host = episode?.siteHost?.trim() || "";
  return {
    "data-takeover-learning": episode && episode.endedAt == null ? "active" : "idle",
    "data-takeover-site-host": host,
  };
}
