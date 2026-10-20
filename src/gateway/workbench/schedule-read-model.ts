import { computeNextRunAtMs } from "../../cron/schedule.js";
import { loadCronStore, resolveCronStorePath } from "../../cron/store.js";
import type { CronSchedule } from "../../cron/types.js";
import { resolveZonedDayBounds } from "./zoned-day.js";

/**
 * Schedule (Schedule) domain — Phase A0 "正名" read model for the employee home
 * 今日日程 card. Until now that card was a FRONT-END proxy signal
 * (`buildCronLabel(cronNext) + sessionCount`, assembled UI-side); this read model
 * makes it an actor-scoped, server-authoritative projection, matching the M1–M3
 * paradigm (pending-tasks / notices / upcoming-collaboration).
 *
 * A0 is deterministic and zero-LLM. It surfaces two tracks, merged ("cron 双轨"):
 *  1. Real `ScheduleEntry` rows (manual / meeting-derived) — Phase A1 store seam;
 *     the default `listEntries` returns none because the store does not exist yet.
 *  2. The actor's own cron jobs, projected as synthetic `cron-derived` entries
 *     (the server-side, actor-scoped replacement for the global front-end
 *     `cronNext`). The front-end `cronLabel` stays only as a fallback (the card
 *     prefers this projection when it has anything to show).
 *
 * Scope is bounded to the resolved actor: a cron job is included only when it is
 * owned by the actor (`ownership.ownerId`) or targets an agent the actor can see
 * (`agentId` ∈ `visibleAgentIds`), with a tenant-isolation guard. A brand-new
 * member with no owned cron / no entries resolves to an empty projection — never
 * an install-wide view (the HYB cross-tenant leak lesson).
 */

/** Minimal `ScheduleEntry` shape (design §3.1, trimmed to A0 essentials). */
export type WorkbenchScheduleEntryKind =
  | "personal"
  | "reminder"
  | "cron-derived"
  | "meeting"
  | "notice";
export type WorkbenchScheduleEntryStatus = "confirmed" | "cancelled" | "done";
export type WorkbenchScheduleSourceRef = {
  kind: "manual" | "meeting" | "cron" | "collab-dispatch";
  id: string;
};

/**
 * Stored schedule entry (Phase A1 store seam). `startAtMs`/`endAtMs` realize the
 * design's `startAt`/`endAt` as ms-epoch numbers (codebase `*Ms` convention).
 */
export type WorkbenchScheduleEntry = {
  id: string;
  ownerUserId: string;
  tenantId?: string;
  title: string;
  startAtMs: number;
  endAtMs?: number;
  timezone: string;
  kind: WorkbenchScheduleEntryKind;
  status: WorkbenchScheduleEntryStatus;
  sourceRef: WorkbenchScheduleSourceRef;
  /** Optional place label (meeting-derived). */
  location?: string;
  /** Optional join URL (meeting-derived). */
  joinUrl?: string;
};

/** Projected schedule item the card / steward signals consume. */
export type WorkbenchScheduleItem = {
  id: string;
  title: string;
  kind: WorkbenchScheduleEntryKind;
  startAtMs: number;
  endAtMs?: number;
  status: WorkbenchScheduleEntryStatus;
  /** True for a synthetic cron-derived item (double-track), not a stored entry. */
  cronDerived: boolean;
  location?: string;
  joinUrl?: string;
};

export type WorkbenchScheduleResult = {
  /** Items starting within the actor-local calendar day (00:00–24:00 in `timeZone`). */
  todayCount: number;
  /** Items within the upcoming window (now .. now+windowMs), including ongoing. */
  upcomingCount: number;
  /** Subset of items that are synthetic cron-derived (double-track). */
  cronDerivedCount: number;
  /** Earliest upcoming start (>= now) across included items, if any. */
  nextStartAtMs?: number;
  /** Title of the earliest upcoming item, if any. */
  nextTitle?: string;
  /** Whether any REAL (stored, non-cron-derived) item is present. */
  hasRealEntries: boolean;
  items: WorkbenchScheduleItem[];
};

/** Structural cron-job shape needed for the cron-derived projection. */
export type WorkbenchScheduleCronJob = {
  id: string;
  name?: string;
  enabled?: boolean;
  agentId?: string;
  schedule?: CronSchedule;
  state?: { nextRunAtMs?: number };
  ownership?: { tenantId?: string; ownerId?: string };
};

/**
 * Injected data sources — defaults read real stores; tests override. All
 * deterministic (no LLM).
 */
export type WorkbenchScheduleDeps = {
  /** Phase A1 store seam: real ScheduleEntries for the actor. Default: none. */
  listEntries: (params: {
    userId: string;
    userEmail?: string | null;
    tenantId?: string;
  }) => Promise<WorkbenchScheduleEntry[]>;
  /** Cron double-track source. Default: the on-disk cron store. */
  listCronJobs: () => Promise<WorkbenchScheduleCronJob[]>;
  /** "now" injection for tests. Default: Date.now. */
  now: () => number;
};

export type WorkbenchScheduleParams = {
  userId: string;
  userEmail?: string | null;
  tenantId?: string;
  /** IANA timezone for the actor-local "today" day bounds (default UTC). */
  timeZone?: string;
  /** Agent ids visible to the actor (cron-derived scoping by `agentId`). */
  visibleAgentIds?: string[];
  /** Upcoming window (ms) from now; default 7 days. Counts are NOT capped. */
  windowMs?: number;
  /** Max items returned (counts NOT capped). */
  limit?: number;
  deps?: Partial<WorkbenchScheduleDeps>;
};

const DEFAULT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_ITEM_LIMIT = 12;

function defaultDeps(): WorkbenchScheduleDeps {
  return {
    listEntries: async () => [],
    listCronJobs: async () => {
      try {
        const store = await loadCronStore(resolveCronStorePath());
        return (store.jobs ?? []) as WorkbenchScheduleCronJob[];
      } catch {
        return [];
      }
    },
    now: () => Date.now(),
  };
}

function normalizeIdentity(value: string | null | undefined): string {
  return value?.trim().toLowerCase() ?? "";
}

/**
 * Conservative actor scoping for a cron job: include only when owned by the actor
 * or targeting a visible agent, and never across a known tenant boundary. Jobs
 * with neither an owner match nor an agent match are platform-global and excluded.
 */
function cronJobBelongsToActor(
  job: WorkbenchScheduleCronJob,
  actorIdentities: Set<string>,
  visibleAgentIds: Set<string>,
  actorTenantId: string,
): boolean {
  const jobTenantId = normalizeIdentity(job.ownership?.tenantId);
  // Tenant isolation: if both tenants are known and differ, never include.
  if (jobTenantId && actorTenantId && jobTenantId !== actorTenantId) {
    return false;
  }
  const ownerId = normalizeIdentity(job.ownership?.ownerId);
  if (ownerId && actorIdentities.has(ownerId)) {
    return true;
  }
  const agentId = normalizeIdentity(job.agentId);
  if (agentId && visibleAgentIds.has(agentId)) {
    return true;
  }
  return false;
}

function resolveCronNextRunAtMs(job: WorkbenchScheduleCronJob, nowMs: number): number | undefined {
  const stored = job.state?.nextRunAtMs;
  if (typeof stored === "number" && Number.isFinite(stored) && stored >= nowMs) {
    return stored;
  }
  // Stale or unset (service not armed yet): recompute deterministically.
  if (job.schedule) {
    return computeNextRunAtMs(job.schedule, nowMs);
  }
  return typeof stored === "number" && Number.isFinite(stored) ? stored : undefined;
}

/**
 * Deterministic, actor-scoped "today schedule" projection (Phase A0). Merges real
 * ScheduleEntries (none until A1) with the actor's cron-derived entries, bounded
 * to an upcoming window. No actor data ever falls through to an install-wide view.
 */
export async function buildWorkbenchSchedule(
  params: WorkbenchScheduleParams,
): Promise<WorkbenchScheduleResult> {
  const deps = { ...defaultDeps(), ...params.deps };
  const nowMs = deps.now();
  const windowMs = Math.max(0, params.windowMs ?? DEFAULT_WINDOW_MS);
  const windowEndMs = nowMs + windowMs;
  const limit = Math.max(1, Math.min(params.limit ?? DEFAULT_ITEM_LIMIT, 100));
  const actorTenantId = normalizeIdentity(params.tenantId);
  const actorIdentities = new Set(
    [params.userId, params.userEmail].map((value) => normalizeIdentity(value)).filter(Boolean),
  );
  const visibleAgentIds = new Set(
    (params.visibleAgentIds ?? []).map((id) => normalizeIdentity(id)).filter(Boolean),
  );

  const items: WorkbenchScheduleItem[] = [];

  // Track 1 — real stored entries (Phase A1 store seam; empty by default in A0).
  let realEntries: WorkbenchScheduleEntry[] = [];
  try {
    realEntries = await deps.listEntries({
      userId: params.userId,
      userEmail: params.userEmail,
      tenantId: params.tenantId,
    });
  } catch {
    realEntries = [];
  }
  for (const entry of realEntries) {
    if (entry.status === "cancelled") {
      continue;
    }
    // Defensive re-scoping: the store seam must already scope to the actor, but
    // never trust it to (HYB lesson). Owner identity must match.
    if (!actorIdentities.has(normalizeIdentity(entry.ownerUserId))) {
      continue;
    }
    const entryTenantId = normalizeIdentity(entry.tenantId);
    if (entryTenantId && actorTenantId && entryTenantId !== actorTenantId) {
      continue;
    }
    const startAtMs = entry.startAtMs;
    if (typeof startAtMs !== "number" || !Number.isFinite(startAtMs)) {
      continue;
    }
    const endOrStart = entry.endAtMs ?? startAtMs;
    // Included when it starts within the window and has not already ended.
    if (startAtMs > windowEndMs || endOrStart < nowMs) {
      continue;
    }
    items.push({
      id: entry.id,
      title: entry.title,
      kind: entry.kind,
      startAtMs,
      endAtMs: entry.endAtMs,
      status: entry.status,
      cronDerived: false,
      ...(entry.location ? { location: entry.location } : {}),
      ...(entry.joinUrl ? { joinUrl: entry.joinUrl } : {}),
    });
  }

  // Track 2 — cron jobs projected as synthetic cron-derived entries (double-track).
  let cronJobs: WorkbenchScheduleCronJob[] = [];
  try {
    cronJobs = await deps.listCronJobs();
  } catch {
    cronJobs = [];
  }
  for (const job of cronJobs) {
    if (job.enabled === false) {
      continue;
    }
    if (!cronJobBelongsToActor(job, actorIdentities, visibleAgentIds, actorTenantId)) {
      continue;
    }
    const nextRunAtMs = resolveCronNextRunAtMs(job, nowMs);
    if (typeof nextRunAtMs !== "number" || !Number.isFinite(nextRunAtMs)) {
      continue;
    }
    if (nextRunAtMs < nowMs || nextRunAtMs > windowEndMs) {
      continue;
    }
    items.push({
      id: `cron:${job.id}`,
      title: job.name?.trim() || job.id,
      kind: "cron-derived",
      startAtMs: nextRunAtMs,
      status: "confirmed",
      cronDerived: true,
    });
  }

  items.sort((left, right) => left.startAtMs - right.startAtMs);

  const timeZone = params.timeZone?.trim() || "UTC";
  const dayBounds = resolveZonedDayBounds(nowMs, timeZone);
  const todayCount = items.filter(
    (item) => item.startAtMs >= dayBounds.startMs && item.startAtMs < dayBounds.endMs,
  ).length;
  const cronDerivedCount = items.filter((item) => item.cronDerived).length;
  const hasRealEntries = items.some((item) => !item.cronDerived);
  const nextItem = items.find((item) => item.startAtMs >= nowMs);

  return {
    todayCount,
    upcomingCount: items.length,
    cronDerivedCount,
    nextStartAtMs: nextItem?.startAtMs,
    nextTitle: nextItem?.title,
    hasRealEntries,
    items: items.slice(0, limit),
  };
}
