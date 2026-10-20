import type { WorkbenchNoticesResult } from "./notices-read-model.js";
import type { WorkbenchPendingTasksResult } from "./pending-tasks-read-model.js";
import type { WorkbenchUpcomingCollaborationResult } from "./upcoming-collaboration-read-model.js";

/**
 * Which deterministic signal drove the steward suggestion. Drives the bar's
 * accent/icon on the UI; the priority order below is the suggestion priority.
 */
export type WorkbenchStewardSuggestionKind =
  | "ack"
  | "decision"
  | "review"
  | "task"
  | "conflict"
  | "response"
  | "attention";

/** Whether the wording came from the deterministic template or the LLM refine. */
export type WorkbenchStewardSuggestionSource = "template" | "llm";

export type WorkbenchStewardSuggestion = {
  /** Short, single-line Chinese suggestion text for the steward bar. */
  text: string;
  /** Which signal drove the suggestion. */
  kind: WorkbenchStewardSuggestionKind;
  /** Template (deterministic) vs llm (gated refine). */
  source: WorkbenchStewardSuggestionSource;
  /** When this suggestion text was produced (ms epoch). */
  generatedAtMs: number;
};

export type WorkbenchStewardSuggestionResult = {
  /** The single steward suggestion, or null when nothing is worth surfacing. */
  suggestion: WorkbenchStewardSuggestion | null;
  /** Stable fingerprint of the input signals (drives dedup). */
  signature: string;
  /** True when served from cache (signals unchanged → guaranteed 0 LLM call). */
  fromCache: boolean;
  /** True when the LLM seam produced this suggestion's text on this call. */
  llmUsed: boolean;
};

type SignalItemRef = { id: string };

/**
 * Structural view of the M1/M2/M3 read-model results the suggestion layer
 * consumes. Kept as `Pick`s (plus a minimal `items` ref) so the RPC handler can
 * pass the full results and tests can use light fixtures — only the fields that
 * affect the suggestion + its fingerprint are referenced.
 */
export type WorkbenchStewardSuggestionSignals = {
  pending: Pick<
    WorkbenchPendingTasksResult,
    "ackRequiredCount" | "taskCount" | "governanceCount" | "inviteCount" | "totalCount"
  > & { items?: ReadonlyArray<SignalItemRef> };
  notices: Pick<WorkbenchNoticesResult, "conflictCount" | "attentionCount" | "totalCount">;
  upcoming: Pick<
    WorkbenchUpcomingCollaborationResult,
    "decisionCount" | "reviewCount" | "needsResponseCount" | "activeCount"
  > & { items?: ReadonlyArray<SignalItemRef> };
};

/** Grounding passed to the M4b LLM refine seam. */
export type StewardSuggestionLlmContext = {
  signals: WorkbenchStewardSuggestionSignals;
  /** The deterministic template suggestion (the LLM may only re-word this). */
  template: { text: string; kind: WorkbenchStewardSuggestionKind };
  signature: string;
};

export type StewardSuggestionCacheEntry = {
  signature: string;
  suggestion: WorkbenchStewardSuggestion | null;
  /** When the LLM seam was last invoked for this actor; undefined = never. */
  lastLlmAtMs: number | undefined;
};

export type StewardSuggestionCache = {
  get: (key: string) => StewardSuggestionCacheEntry | undefined;
  set: (key: string, entry: StewardSuggestionCacheEntry) => void;
};

export type WorkbenchStewardSuggestionDeps = {
  /** Per-actor cache store. Default: module-level in-memory map. */
  cache: StewardSuggestionCache;
  now: () => number;
  /** Minimum interval between LLM regenerations per actor (ms). */
  throttleMs: number;
  /**
   * M4b LLM refine seam. When provided AND the signal signature changed AND the
   * per-actor throttle window has elapsed, used to re-word the template. The
   * seam itself MUST enforce the commercial gate and return `null` for the
   * non-enterprise path (decision B) — returning null/empty falls back to the
   * deterministic template. Absent by default (M4a → deterministic only).
   */
  generateSuggestionText?: (ctx: StewardSuggestionLlmContext) => Promise<string | null>;
};

/** Default per-actor throttle between gated LLM regenerations (10 minutes). */
export const DEFAULT_STEWARD_SUGGESTION_THROTTLE_MS = 10 * 60_000;

const moduleCache = new Map<string, StewardSuggestionCacheEntry>();

function defaultDeps(): WorkbenchStewardSuggestionDeps {
  return {
    cache: {
      get: (key) => moduleCache.get(key),
      set: (key, entry) => {
        moduleCache.set(key, entry);
      },
    },
    now: () => Date.now(),
    throttleMs: DEFAULT_STEWARD_SUGGESTION_THROTTLE_MS,
  };
}

export type WorkbenchStewardSuggestionParams = {
  /** Stable per-actor cache key (the resolved employee userId). */
  actorKey: string;
  signals: WorkbenchStewardSuggestionSignals;
  deps?: Partial<WorkbenchStewardSuggestionDeps>;
};

/**
 * Stable fingerprint of the deterministic signals. Combines the counts that can
 * change a suggestion with the top item ids (so the wording can refresh when the
 * specific lead item changes even if the counts are unchanged). String equality
 * on this value is the dedup key — unchanged signature ⇒ no recompute, no LLM.
 */
export function computeStewardSignalSignature(signals: WorkbenchStewardSuggestionSignals): string {
  const { pending, notices, upcoming } = signals;
  const topIds = [
    ...(pending.items ?? []).slice(0, 3).map((item) => `p:${item.id}`),
    ...(upcoming.items ?? []).slice(0, 3).map((item) => `u:${item.id}`),
  ].join(",");
  return [
    pending.ackRequiredCount,
    pending.taskCount,
    pending.governanceCount,
    pending.inviteCount,
    pending.totalCount,
    notices.conflictCount,
    notices.attentionCount,
    notices.totalCount,
    upcoming.decisionCount,
    upcoming.reviewCount,
    upcoming.needsResponseCount,
    upcoming.activeCount,
    topIds,
  ].join("|");
}

/**
 * Deterministic "what should I look at first" template (design §7.4). Picks the
 * single most urgent signal by a fixed priority and returns a one-line Chinese
 * suggestion. All-zero signals return null — the steward bar then hides itself
 * (additive: never surfaces an empty/“all clear” nag).
 */
export function buildStewardTemplateSuggestion(
  signals: WorkbenchStewardSuggestionSignals,
): { text: string; kind: WorkbenchStewardSuggestionKind } | null {
  const { pending, notices, upcoming } = signals;
  if (pending.ackRequiredCount > 0) {
    return { kind: "ack", text: `有 ${pending.ackRequiredCount} 项待确认任务需要你先处理` };
  }
  if (upcoming.decisionCount > 0) {
    return { kind: "decision", text: `${upcoming.decisionCount} 个协作群在等你拍板` };
  }
  if (upcoming.reviewCount > 0) {
    return { kind: "review", text: `${upcoming.reviewCount} 个协作群等你复核` };
  }
  if (pending.taskCount > 0) {
    return { kind: "task", text: `你有 ${pending.taskCount} 项待处理任务` };
  }
  if (notices.conflictCount > 0) {
    return { kind: "conflict", text: `知识库有 ${notices.conflictCount} 处冲突待解决` };
  }
  if (upcoming.needsResponseCount > 0) {
    return { kind: "response", text: `${upcoming.needsResponseCount} 个协作群需要你回应` };
  }
  if (notices.attentionCount > 0) {
    return { kind: "attention", text: `${notices.attentionCount} 处知识待关注` };
  }
  return null;
}

/**
 * Build the single steward (大白) suggestion for the employee home from the
 * deterministic M1/M2/M3 signals (design §7).
 *
 * Flow:
 *  1. Fingerprint the signals.
 *  2. If unchanged since the last call for this actor → serve the cached
 *     suggestion (guaranteed 0 LLM calls / 0 tokens).
 *  3. Otherwise start from the deterministic template (null = hide the bar).
 *  4. M4b only: if an LLM seam is wired AND the throttle window has elapsed,
 *     let it re-word the template; the seam enforces the commercial gate and
 *     returns null for the non-enterprise path (decision B), falling back to the
 *     template. The seam never changes the underlying facts/counts.
 *
 * The core (signature/dedup/cache/template) is fully deterministic and testable
 * without any model; the LLM is a pure, gated, throttled enhancement.
 */
export async function buildWorkbenchStewardSuggestion(
  params: WorkbenchStewardSuggestionParams,
): Promise<WorkbenchStewardSuggestionResult> {
  const deps = { ...defaultDeps(), ...params.deps };
  const now = deps.now();
  const signature = computeStewardSignalSignature(params.signals);
  const template = buildStewardTemplateSuggestion(params.signals);

  const prev = deps.cache.get(params.actorKey);

  // Dedup: unchanged signals → serve the cached suggestion, never call the LLM.
  if (prev && prev.signature === signature) {
    return { suggestion: prev.suggestion, signature, fromCache: true, llmUsed: false };
  }

  // Signals changed (or first sight). Start from the deterministic template; a
  // null template means "nothing worth surfacing" → the bar hides itself.
  let suggestion: WorkbenchStewardSuggestion | null = template
    ? { text: template.text, kind: template.kind, source: "template", generatedAtMs: now }
    : null;
  let llmUsed = false;
  let lastLlmAtMs = prev?.lastLlmAtMs;

  // M4b refine: only when there IS something to say, a seam is wired, and the
  // per-actor throttle window has elapsed (never-run is always allowed). The
  // seam enforces the commercial gate (non-enterprise → null = template only).
  // A throw/null degrades to the template.
  const throttleElapsed = lastLlmAtMs === undefined || now - lastLlmAtMs >= deps.throttleMs;
  if (template && deps.generateSuggestionText && throttleElapsed) {
    let llmText: string | null = null;
    try {
      llmText = await deps.generateSuggestionText({
        signals: params.signals,
        template,
        signature,
      });
    } catch {
      llmText = null;
    }
    // Mark the attempt regardless of outcome so a denied/empty gate result does
    // not let the next signature change immediately re-hit the gate/model.
    lastLlmAtMs = now;
    const trimmed = llmText?.trim();
    if (trimmed) {
      suggestion = { text: trimmed, kind: template.kind, source: "llm", generatedAtMs: now };
      llmUsed = true;
    }
  }

  deps.cache.set(params.actorKey, { signature, suggestion, lastLlmAtMs });
  return { suggestion, signature, fromCache: false, llmUsed };
}

/** Test-only: reset the module-level cache between cases. */
export function __resetStewardSuggestionCacheForTests(): void {
  moduleCache.clear();
}
