/**
 * Phase P1: read-only weekly digest, pending decisions, automatic actions,
 * and Da Bai intent binding.
 *
 * Projects the Phase P0 timeline. It does not write Ledger, Proposal,
 * Application, or Verification, does not open a second fact store, and does
 * not change autonomy. Budget figures are copied from the caller snapshot
 * when that snapshot already carries them.
 *
 * Narration is template fill. A sentence that claims learning ("学会了")
 * without a ledger event id throws. `system` domain items stay in
 * `platformItems` and never use the learned template.
 *
 * Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §4–§5 Phase P1.
 * Phase P2 observation queue, trigger catalog, and delivery tiers live in `perception-p2.ts`.
 */
import { projectEvolutionTimeline, type EvolutionTimelineListInput } from "./timeline-list.js";
import {
  countEvolutionTimelineBuckets,
  emptyEvolutionTimelineBucketCounts,
  emptyEvolutionTimelineQueryResult,
  evolutionTimelineResultLabel,
  EVOLUTION_TIMELINE_BUCKETS,
  EVOLUTION_TIMELINE_INTENTS,
  denyEvolutionTimelineQuery,
  type EvolutionTimelineBucket,
  type EvolutionTimelineBucketCounts,
  type EvolutionTimelineCompleteness,
  type EvolutionTimelineIntent,
  type EvolutionTimelineItem,
  type EvolutionTimelineQueryDenial,
  type EvolutionTimelineQueryResult,
} from "./timeline.js";
import { evolutionTargetKey } from "./types.js";

/** Public P1 operations. All of them are read-only projections or template fills. */
export const EVOLUTION_PERCEPTION_OPERATIONS = [
  "projectWeeklyEvolutionDigest",
  "projectPendingDecisions",
  "projectAutomaticActions",
  "queryEvolutionPerception",
  "renderEvolutionNarration",
  "narrateDigitalHumanLearned",
  "assertLearnedNarrationHasFactId",
] as const;

export const EVOLUTION_PERCEPTION_ACCESS = "read-only" as const;

export const EVOLUTION_DIGEST_RELATIONS = ["entered", "advanced", "prior_only"] as const;
export type EvolutionDigestRelation = (typeof EVOLUTION_DIGEST_RELATIONS)[number];

/** Inclusive `[from, to]` on the current window. Compared with `Date.parse`. */
export type EvolutionPerceptionWindow = {
  from: string;
  to: string;
};

export type EvolutionPerceptionScope = {
  window: EvolutionPerceptionWindow;
  tenantScope?: string;
  agentId?: string;
};

export type EvolutionDigestDelta = {
  relation: EvolutionDigestRelation;
  item: EvolutionTimelineItem;
};

/**
 * Current window versus the immediately previous window of equal length.
 * Prior window is half-open `[priorFrom, from)` so the shared instant `from`
 * belongs only to the current window.
 */
export type EvolutionWeeklyDigest = {
  access: typeof EVOLUTION_PERCEPTION_ACCESS;
  window: EvolutionPerceptionWindow;
  priorWindow: EvolutionPerceptionWindow;
  items: readonly EvolutionTimelineItem[];
  priorItems: readonly EvolutionTimelineItem[];
  /**
   * Current-window half of the diff: items that entered this window or whose
   * decisive event advanced into it, including every `verified_effective` item
   * anchored here. Prior-only items are not included.
   */
  verifiedOrChanged: readonly EvolutionTimelineItem[];
  deltas: readonly EvolutionDigestDelta[];
  bucketCounts: EvolutionTimelineBucketCounts;
  priorBucketCounts: EvolutionTimelineBucketCounts;
  platformItems: readonly EvolutionTimelineItem[];
  completeness: EvolutionTimelineCompleteness;
};

export type EvolutionPendingDecisions = {
  access: typeof EVOLUTION_PERCEPTION_ACCESS;
  items: readonly EvolutionTimelineItem[];
  completeness: EvolutionTimelineCompleteness;
};

export type EvolutionAutonomyBudgetView =
  | {
      available: true;
      surfaceId: string;
      mode: "off" | "assist" | "auto";
      maxApplications: number;
      usedApplications: number;
      remainingApplications: number;
      expiresAt: string | null;
      killSwitch: boolean | null;
    }
  | {
      available: false;
      surfaceId: string;
    };

export type EvolutionAutomaticAction = {
  item: EvolutionTimelineItem;
  budget: EvolutionAutonomyBudgetView;
};

export type EvolutionPerceptionQuery = {
  tenantScope: string;
  agentId?: string;
  window: EvolutionPerceptionWindow;
  intent: string;
  /** Omitted means the caller already enforced the read. `false` denies. */
  permitted?: boolean;
};

export type EvolutionNarration = {
  learned: readonly string[];
  platform: readonly string[];
  other: readonly string[];
};

export class EvolutionNarrationGuardError extends Error {
  readonly code: "missing_fact_id" | "system_domain";

  constructor(code: "missing_fact_id" | "system_domain", message: string) {
    super(message);
    this.name = "EvolutionNarrationGuardError";
    this.code = code;
  }
}

const LEARNED_CLAIM = /学会了/;
const AUTONOMY_MODES = new Set(["off", "assist", "auto"]);

type PlacedItem = {
  item: EvolutionTimelineItem;
  at: number;
};

/**
 * Weekly digest. Items are the final timeline snapshot placed by the anchor
 * ledger event. An item with no traceable anchor id is omitted.
 */
export function projectWeeklyEvolutionDigest(
  input: EvolutionTimelineListInput,
  scope: EvolutionPerceptionScope,
): EvolutionWeeklyDigest {
  const span = parseWindow(scope.window);
  if (!span) {
    return emptyDigest(scope.window, { from: scope.window.from, to: scope.window.from });
  }
  const priorWindow = priorWindowOf(scope.window, span.durationMs);
  const projected = projectEvolutionTimeline(input).items.filter((item) =>
    matchesTenant(item, scope.tenantScope),
  );
  const agentFiltered = scope.agentId
    ? projected.filter((item) => matchesAgent(item, scope.agentId))
    : projected;
  const placed = placeItems(agentFiltered, input.events);
  const current = placed.filter((row) => row.at >= span.fromMs && row.at <= span.toMs);
  const prior = placed.filter(
    (row) => row.at >= span.fromMs - span.durationMs && row.at < span.fromMs,
  );
  const items = current.map((row) => row.item);
  const priorItems = prior.map((row) => row.item);
  const deltas = [
    ...current.map((row) => ({
      relation: (hasEarlierEvent(row.item, input.events, span.fromMs)
        ? "advanced"
        : "entered") as EvolutionDigestRelation,
      item: row.item,
    })),
    ...prior.map((row) => ({
      relation: "prior_only" as const,
      item: row.item,
    })),
  ];
  const relationByKey = new Map(
    deltas
      .filter((delta) => delta.relation !== "prior_only")
      .map((delta) => [changeKey(delta.item), delta.relation] as const),
  );
  const verifiedOrChanged = items.filter((item) => {
    const relation = relationByKey.get(changeKey(item));
    return (
      item.result === "verified_effective" || relation === "entered" || relation === "advanced"
    );
  });
  const platformItems = items.filter((item) => isPlatformItem(item));
  return {
    access: EVOLUTION_PERCEPTION_ACCESS,
    window: { from: scope.window.from, to: scope.window.to },
    priorWindow,
    items,
    priorItems,
    verifiedOrChanged,
    deltas,
    bucketCounts: countEvolutionTimelineBuckets(items),
    priorBucketCounts: countEvolutionTimelineBuckets(priorItems),
    platformItems,
    completeness: completenessOf([...items, ...priorItems]),
  };
}

/** Pending bucket only. v1 and v2 items share this queue. */
export function projectPendingDecisions(
  input: EvolutionTimelineListInput,
  scope?: {
    tenantScope?: string;
    agentId?: string;
    window?: EvolutionPerceptionWindow;
  },
): EvolutionPendingDecisions {
  const span = scope?.window ? parseWindow(scope.window) : null;
  if (scope?.window && !span) {
    return { access: EVOLUTION_PERCEPTION_ACCESS, items: [], completeness: "empty" };
  }
  const placed = placeItems(
    projectEvolutionTimeline(input).items.filter(
      (item) =>
        item.bucket === "pending" &&
        matchesTenant(item, scope?.tenantScope) &&
        matchesAgent(item, scope?.agentId),
    ),
    input.events,
  );
  const items = placed
    .filter((row) => !span || (row.at >= span.fromMs && row.at <= span.toMs))
    .map((row) => row.item);
  return {
    access: EVOLUTION_PERCEPTION_ACCESS,
    items,
    completeness: completenessOf(items),
  };
}

/**
 * Automatic bucket plus the autonomy budget already present on `input`.
 * Missing policy stays `available: false`. This does not evaluate a new grant
 * and does not change `usedApplications`.
 */
export function projectAutomaticActions(
  input: EvolutionTimelineListInput,
  scope?: {
    tenantScope?: string;
    agentId?: string;
    window?: EvolutionPerceptionWindow;
  },
): EvolutionAutomaticAction[] {
  const span = scope?.window ? parseWindow(scope.window) : null;
  if (scope?.window && !span) {
    return [];
  }
  const placed = placeItems(
    projectEvolutionTimeline(input).items.filter(
      (item) =>
        item.bucket === "automatic" &&
        matchesTenant(item, scope?.tenantScope) &&
        matchesAgent(item, scope?.agentId),
    ),
    input.events,
  );
  return placed
    .filter((row) => !span || (row.at >= span.fromMs && row.at <= span.toMs))
    .map((row) => ({
      item: row.item,
      budget: budgetView(input, row.item.changeObject.surfaceId),
    }));
}

/**
 * §4 intent binding. Returns the structured answer or a denial.
 * Does not invent items for an empty window or an unknown intent.
 */
export function queryEvolutionPerception(
  input: EvolutionTimelineListInput,
  query: EvolutionPerceptionQuery,
): EvolutionTimelineQueryResult | EvolutionTimelineQueryDenial {
  if (query.permitted === false || query.tenantScope.trim().length === 0) {
    return denyEvolutionTimelineQuery();
  }
  if (!isEvolutionTimelineIntent(query.intent)) {
    return {
      ...emptyEvolutionTimelineQueryResult(),
      unresolvedIntents: [query.intent],
    };
  }
  const digest = projectWeeklyEvolutionDigest(input, {
    window: query.window,
    tenantScope: query.tenantScope,
  });
  if (digest.items.length === 0) {
    return emptyEvolutionTimelineQueryResult();
  }
  return answerForIntent(query.intent, digest.items, query.agentId);
}

/** Fixed templates. Learning claims go through `narrateDigitalHumanLearned`. */
export function renderEvolutionNarration(
  result: EvolutionTimelineQueryResult,
  intent: EvolutionTimelineIntent,
): EvolutionNarration {
  const platform = result.platformItems.map((item) => factSentence("平台可追溯变化", item));
  if (intent === "learned_this_week") {
    // Empty windows return no sentences; employee UI owns success_empty copy with the window.
    const learned = result.items.map((item) => narrateDigitalHumanLearned(item));
    const narration = { learned, platform, other: [] as string[] };
    assertNarration(narration, [...result.items, ...result.platformItems]);
    return narration;
  }
  const prefix = INTENT_PREFIX[intent];
  const other = result.items.map((item) => factSentence(prefix, item));
  const narration = { learned: [] as string[], platform, other };
  assertNarration(narration, [...result.items, ...result.platformItems]);
  return narration;
}

/**
 * Learned template. Fails closed without a ledger event id, and for `system`.
 */
export function narrateDigitalHumanLearned(item: EvolutionTimelineItem): string {
  if (isPlatformItem(item)) {
    throw new EvolutionNarrationGuardError(
      "system_domain",
      "system domain cannot use the learned template",
    );
  }
  const id = requireFactId(item);
  const sentence = `数字人学会了可追溯变化 ${id}（${item.changeObject.domainDisplayName}，${evolutionTimelineResultLabel(item.result)}）。`;
  assertLearnedNarrationHasFactId(sentence, [item]);
  return sentence;
}

/**
 * User-visible learning claims must contain an item fact id from `items`.
 * Sentences that do not claim learning are ignored.
 */
export function assertLearnedNarrationHasFactId(
  sentence: string,
  items: readonly Pick<EvolutionTimelineItem, "factIds">[],
): void {
  if (!LEARNED_CLAIM.test(sentence)) {
    return;
  }
  const ids = items.map((item) => item.factIds.ledgerEventId.trim()).filter((id) => id.length > 0);
  if (!ids.some((id) => sentence.includes(id))) {
    throw new EvolutionNarrationGuardError(
      "missing_fact_id",
      "learned narration cannot be emitted without an item fact id",
    );
  }
}

export function partitionEvolutionTimelineBuckets(
  items: readonly EvolutionTimelineItem[],
): Record<EvolutionTimelineBucket, EvolutionTimelineItem[]> {
  const partitions: Record<EvolutionTimelineBucket, EvolutionTimelineItem[]> = {
    automatic: [],
    user_approved: [],
    pending: [],
    observing: [],
    rolled_back: [],
  };
  for (const item of items) {
    if (item.bucket) {
      partitions[item.bucket].push(item);
    }
  }
  return partitions;
}

export function isEvolutionTimelineIntent(value: string): value is EvolutionTimelineIntent {
  return (EVOLUTION_TIMELINE_INTENTS as readonly string[]).includes(value);
}

const INTENT_PREFIX: Record<EvolutionTimelineIntent, string> = {
  learned_this_week: "数字人可追溯变化",
  diff_from_last_week: "相对上一窗口，可追溯变化",
  automatic: "自动执行的可追溯变化",
  user_approved: "经批准的可追溯变化",
  observing: "观察中的可追溯变化",
  rolled_back: "已回滚的可追溯变化",
  platform_upgrades_this_week: "平台可追溯变化",
};

/** Soft empty copy for callers that still want a sentence; UI owns dated empty state. */
const EMPTY_INTENT: Record<EvolutionTimelineIntent, string> = {
  learned_this_week: "这一周还没有可查看的数字人变化。",
  diff_from_last_week: "相对上周还没有可查看的变化。",
  automatic: "这一周还没有自动执行的变化。",
  user_approved: "这一周还没有经批准的变化。",
  observing: "这一周还没有观察中的变化。",
  rolled_back: "这一周还没有已回滚的变化。",
  platform_upgrades_this_week: "这一周还没有平台升级相关变化。",
};

export function evolutionEmptyIntentCopy(intent: EvolutionTimelineIntent): string {
  return EMPTY_INTENT[intent];
}

function answerForIntent(
  intent: EvolutionTimelineIntent,
  current: readonly EvolutionTimelineItem[],
  agentId: string | undefined,
): EvolutionTimelineQueryResult {
  if (intent === "platform_upgrades_this_week") {
    const platformItems = current.filter((item) => isPlatformItem(item));
    return buildAnswer([], platformItems, "platform");
  }
  const platformItems = current.filter((item) => isPlatformItem(item));
  const digital = current.filter((item) => !isPlatformItem(item) && matchesAgent(item, agentId));
  if (intent === "learned_this_week") {
    return buildAnswer(
      digital.filter((item) => item.result === "verified_effective"),
      platformItems,
      "items",
    );
  }
  if (intent === "diff_from_last_week") {
    return buildAnswer(digital, platformItems, "items");
  }
  if (isBucketIntent(intent)) {
    return buildAnswer(
      digital.filter((item) => item.bucket === intent),
      platformItems.filter((item) => item.bucket === intent),
      "items",
    );
  }
  return {
    ...emptyEvolutionTimelineQueryResult(),
    unresolvedIntents: [intent],
  };
}

function isBucketIntent(
  intent: EvolutionTimelineIntent,
): intent is Extract<EvolutionTimelineIntent, EvolutionTimelineBucket> {
  return (EVOLUTION_TIMELINE_BUCKETS as readonly string[]).includes(intent);
}

function buildAnswer(
  items: readonly EvolutionTimelineItem[],
  platformItems: readonly EvolutionTimelineItem[],
  countsFrom: "items" | "platform",
): EvolutionTimelineQueryResult {
  if (items.length === 0 && platformItems.length === 0) {
    return emptyEvolutionTimelineQueryResult();
  }
  const counted = countsFrom === "platform" ? platformItems : items;
  return {
    items: [...items],
    bucketCounts: countEvolutionTimelineBuckets(counted),
    platformItems: [...platformItems],
    unresolvedIntents: [],
    completeness: completenessOf([...items, ...platformItems]),
  };
}

function budgetView(
  input: EvolutionTimelineListInput,
  surfaceId: string,
): EvolutionAutonomyBudgetView {
  const record = input.autonomyBySurfaceId?.[surfaceId];
  const policy = record?.policy;
  if (
    !policy ||
    policy.surfaceId !== surfaceId ||
    !AUTONOMY_MODES.has(policy.mode) ||
    !Number.isFinite(policy.maxApplications) ||
    !Number.isFinite(policy.usedApplications)
  ) {
    return { available: false, surfaceId };
  }
  return {
    available: true,
    surfaceId,
    mode: policy.mode,
    maxApplications: policy.maxApplications,
    usedApplications: policy.usedApplications,
    remainingApplications: Math.max(0, policy.maxApplications - policy.usedApplications),
    expiresAt:
      typeof policy.expiresAt === "string" && policy.expiresAt.trim() ? policy.expiresAt : null,
    killSwitch: typeof record.killSwitch === "boolean" ? record.killSwitch : null,
  };
}

function placeItems(
  items: readonly EvolutionTimelineItem[],
  events: EvolutionTimelineListInput["events"],
): PlacedItem[] {
  const placed: PlacedItem[] = [];
  for (const item of items) {
    const at = anchorMillis(item, events);
    if (at == null || item.factIds.ledgerEventId.trim().length === 0) {
      continue;
    }
    placed.push({ item, at });
  }
  placed.sort(
    (left, right) =>
      left.at - right.at ||
      left.item.factIds.ledgerEventId.localeCompare(right.item.factIds.ledgerEventId),
  );
  return placed;
}

function anchorMillis(
  item: EvolutionTimelineItem,
  events: EvolutionTimelineListInput["events"],
): number | null {
  const id = item.factIds.ledgerEventId.trim();
  if (!id) {
    return null;
  }
  const event = events.find((candidate) => candidate.eventId === id);
  if (!event) {
    return null;
  }
  const at = Date.parse(event.timestamp);
  return Number.isFinite(at) ? at : null;
}

function hasEarlierEvent(
  item: EvolutionTimelineItem,
  events: EvolutionTimelineListInput["events"],
  fromMs: number,
): boolean {
  const proposalId = item.factIds.proposalId;
  const targetKey = evolutionTargetKey(item.changeObject.target);
  const anchorId = item.factIds.ledgerEventId;
  return events.some((event) => {
    if (!event.target || event.eventId === anchorId) {
      return false;
    }
    if (evolutionTargetKey(event.target) !== targetKey) {
      return false;
    }
    const eventProposal = event.proposalId.trim();
    if (!proposalId || eventProposal !== proposalId) {
      return false;
    }
    const at = Date.parse(event.timestamp);
    return Number.isFinite(at) && at < fromMs;
  });
}

function parseWindow(
  window: EvolutionPerceptionWindow,
): { fromMs: number; toMs: number; durationMs: number } | null {
  const fromMs = Date.parse(window.from);
  const toMs = Date.parse(window.to);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
    return null;
  }
  return { fromMs, toMs, durationMs: toMs - fromMs };
}

function priorWindowOf(
  window: EvolutionPerceptionWindow,
  durationMs: number,
): EvolutionPerceptionWindow {
  return {
    from: new Date(Date.parse(window.from) - durationMs).toISOString(),
    to: window.from,
  };
}

function emptyDigest(
  window: EvolutionPerceptionWindow,
  priorWindow: EvolutionPerceptionWindow,
): EvolutionWeeklyDigest {
  return {
    access: EVOLUTION_PERCEPTION_ACCESS,
    window,
    priorWindow,
    items: [],
    priorItems: [],
    verifiedOrChanged: [],
    deltas: [],
    bucketCounts: emptyEvolutionTimelineBucketCounts(),
    priorBucketCounts: emptyEvolutionTimelineBucketCounts(),
    platformItems: [],
    completeness: "empty",
  };
}

function completenessOf(items: readonly EvolutionTimelineItem[]): EvolutionTimelineCompleteness {
  if (items.length === 0) {
    return "empty";
  }
  return items.some((item) => item.completeness === "partial") ? "partial" : "complete";
}

function matchesTenant(item: EvolutionTimelineItem, tenantScope: string | undefined): boolean {
  if (!tenantScope) {
    return true;
  }
  return item.impactScope.tenantScope === tenantScope;
}

function matchesAgent(item: EvolutionTimelineItem, agentId: string | undefined): boolean {
  if (!agentId) {
    return true;
  }
  return (
    item.changeObject.target.domain === "agent" && item.changeObject.target.agentId === agentId
  );
}

function isPlatformItem(item: EvolutionTimelineItem): boolean {
  return item.audience === "platform" || item.changeObject.domain === "system";
}

function changeKey(item: EvolutionTimelineItem): string {
  const proposalId = item.factIds.proposalId ?? item.factIds.ledgerEventId;
  return `${proposalId}::${evolutionTargetKey(item.changeObject.target)}`;
}

function factSentence(prefix: string, item: EvolutionTimelineItem): string {
  const id = requireFactId(item);
  return `${prefix} ${id}（${item.changeObject.domainDisplayName}，${evolutionTimelineResultLabel(item.result)}）。`;
}

function requireFactId(item: EvolutionTimelineItem): string {
  const id = item.factIds.ledgerEventId.trim();
  if (!id) {
    throw new EvolutionNarrationGuardError(
      "missing_fact_id",
      "narration requires a ledger event id",
    );
  }
  return id;
}

function assertNarration(
  narration: EvolutionNarration,
  items: readonly EvolutionTimelineItem[],
): void {
  for (const sentence of [...narration.learned, ...narration.platform, ...narration.other]) {
    assertLearnedNarrationHasFactId(sentence, items);
  }
}
