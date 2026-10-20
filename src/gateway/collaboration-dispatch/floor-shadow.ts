/**
 * Floor Runtime v2.1 §5.7 P1-C — shadow sink.
 *
 * Flag `collaboration.floor.protocol` (plan `collab.floor.protocol`).
 * Only the exact value "shadow" records. Unset / legacy / floor are no-ops.
 * `floor` is reserved and is not wired. P0 G1 refuses to treat it as the
 * live speaker source; the cutover default stays off.
 * Shadow writes never change decide / dispatch / visible posts. Throws are
 * caught by the round hook (fail-closed).
 *
 * Sink: `<ns>/shadow/floor-shadow.jsonl` (sibling of the rounds dir the beat
 * actually used, which is `<groupLocator>/runtime/shadow` when rounds live
 * under `runtime/rounds`).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { getRuntimeConfigSnapshot, loadConfig } from "../../config/config.js";
import type { OpenBotConfig } from "../../config/types.js";
import { beatIdForEpisode, episodeIdForClientRun } from "./collaboration-event-key.js";
import { classifyPlaceholderReply } from "./completion-contract.js";
import {
  classifyEpisodeIntent,
  type CollaborationIntentKind,
  type EpisodeIntentInput,
} from "./episode-intent.js";
import {
  registerFloorShadowBeatFiller,
  registerFloorShadowDecisionSink,
  type FloorShadowBeatFill,
} from "./floor-shadow-bridge.js";
import { resolveEpisodeNeed, type EpisodeNeed, type NeedResolverInput } from "./need-resolver.js";
import {
  classifyUsefulPosts,
  isNoReplyText,
  QUALITY_CLASSIFIER_VERSION,
  type QualityPost,
} from "./quality-classifier.js";
import type { PersistedRound } from "./round-state.js";
import { appendJsonlDurable, withRoundLock } from "./round-store-io.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";

export {
  recordFloorShadowStageAAfterRound,
  recordFloorShadowStageBAfterRound,
} from "./episode-decision-record.js";

export const FLOOR_SHADOW_SCHEMA_VERSION = 1 as const;
export const FLOOR_SHADOW_FILE_NAME = "floor-shadow.jsonl";
export const HUMAN_INTERRUPT_WINDOW_MS = 120_000;

export const HUMAN_INTERRUPT_PHRASES = [
  "其他人呢",
  "还有谁",
  "继续",
  "怎么没人",
  "还有吗",
  "剩下的呢",
  "其他成员呢",
  "都说说",
] as const;

export type FloorShadowCallOutcome =
  | "visible"
  | "no_reply"
  | "duplicate"
  | "placeholder"
  | "timeout"
  | "other";

export type FloorShadowCall = {
  agentId: string;
  outcome: FloorShadowCallOutcome;
};

export type FloorShadowFollowUp = {
  atMs: number;
  text: string;
};

export type FloorShadowSignals = {
  intentInput: EpisodeIntentInput;
  need?: Omit<NeedResolverInput, "intent">;
  posts?: readonly QualityPost[];
  admittedAgentIds?: readonly string[];
  calls?: readonly FloorShadowCall[];
  humanMessageAtMs?: number;
  humanFollowUps?: readonly FloorShadowFollowUp[];
  roundId: string;
  triggerText?: string;
  taskRefs?: readonly string[];
  artifactRefs?: readonly string[];
};

export type FloorShadowRecord = {
  schemaVersion: typeof FLOOR_SHADOW_SCHEMA_VERSION;
  kind: "floor_shadow";
  qualityClassifierVersion: typeof QUALITY_CLASSIFIER_VERSION;
  protocol: "shadow";
  at: number;
  recordId: string;
  groupId: string;
  tenantId: string | null;
  episodeId: string;
  beatId: string;
  roundId: string;
  intent: CollaborationIntentKind;
  need: EpisodeNeed;
  admittedAgentIds: string[];
  respondedAgentIds: string[];
  usefulAgentIds: string[];
  noReply: string[];
  duplicates: string[];
  timeouts: string[];
  visiblePostCount: number;
  usefulPostCount: number;
  completeCallCount: number;
  wasteCallCount: number;
  humanInterrupted: boolean;
  firstUsefulAtMs?: number;
  humanMessageAtMs?: number;
  ttfuMs?: number;
};

export type FloorShadowAppend = (filePath: string, record: FloorShadowRecord) => Promise<void>;

let appendOverride: FloorShadowAppend | null = null;

/** Test-only sink. Pass null to restore the file append. */
export function setFloorShadowAppendForTest(append: FloorShadowAppend | null): void {
  appendOverride = append;
}

export function isCollabFloorShadowEnabled(cfg?: OpenBotConfig): boolean {
  try {
    const resolved = cfg ?? getRuntimeConfigSnapshot() ?? loadConfig();
    return resolved.collaboration?.floor?.protocol === "shadow";
  } catch {
    return false;
  }
}

export function floorShadowRecordId(episodeId: string, beatId: string, roundId: string): string {
  return `${episodeId}:${beatId}:${roundId}`;
}

export function resolveFloorShadowFile(params: {
  groupId: string;
  tenantId?: string | null;
  /** Rounds directory this beat actually wrote. Shadow is its sibling `shadow/`. */
  roundsDir?: string;
  cfg?: OpenBotConfig;
}): string {
  const roundsDir = params.roundsDir?.trim();
  if (roundsDir) {
    return path.join(path.dirname(roundsDir), "shadow", FLOOR_SHADOW_FILE_NAME);
  }
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: params.groupId,
    tenantId: params.tenantId,
    cfg: params.cfg,
  });
  const shadowDir =
    facts.namespace?.shadowDir ?? path.join(path.dirname(facts.roundsDir), "shadow");
  return path.join(shadowDir, FLOOR_SHADOW_FILE_NAME);
}

export function humanInterruptHit(text: string): boolean {
  const compact = text.replace(/\s+/g, "");
  return HUMAN_INTERRUPT_PHRASES.some((phrase) => compact.includes(phrase));
}

export function isHumanInterrupt(params: {
  humanMessageAtMs?: number;
  followUps?: readonly FloorShadowFollowUp[];
}): boolean {
  const anchor = params.humanMessageAtMs;
  if (typeof anchor !== "number") {
    return false;
  }
  for (const followUp of params.followUps ?? []) {
    const delta = followUp.atMs - anchor;
    if (delta >= 0 && delta <= HUMAN_INTERRUPT_WINDOW_MS && humanInterruptHit(followUp.text)) {
      return true;
    }
  }
  return false;
}

function uniqueIds(values: readonly (string | null | undefined)[] | undefined): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values ?? []) {
    const id = value?.trim() ?? "";
    if (!id || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

const WASTE_OUTCOMES = new Set<FloorShadowCallOutcome>([
  "no_reply",
  "duplicate",
  "placeholder",
  "timeout",
]);

export function deriveFloorShadowBeat(signals: FloorShadowSignals): FloorShadowBeatFill & {
  recordParts: Omit<
    FloorShadowRecord,
    | "schemaVersion"
    | "kind"
    | "protocol"
    | "at"
    | "recordId"
    | "groupId"
    | "tenantId"
    | "episodeId"
    | "beatId"
  >;
} {
  const intent = classifyEpisodeIntent(signals.intentInput);
  const need = resolveEpisodeNeed({ intent, ...signals.need });
  const posts = signals.posts ?? [];
  const verdicts = classifyUsefulPosts({
    posts,
    needSource: need.source,
    triggerText: signals.triggerText ?? signals.intentInput.message,
    taskRefs: signals.taskRefs,
    artifactRefs: signals.artifactRefs,
  });
  const usefulAgentIds = uniqueIds(
    verdicts.filter((verdict) => verdict.useful).map((verdict) => verdict.agentId),
  );
  const calls = signals.calls ?? [];
  const noReply = uniqueIds(
    calls.filter((call) => call.outcome === "no_reply").map((call) => call.agentId),
  );
  const duplicates = uniqueIds(
    calls.filter((call) => call.outcome === "duplicate").map((call) => call.agentId),
  );
  const timeouts = uniqueIds(
    calls.filter((call) => call.outcome === "timeout").map((call) => call.agentId),
  );
  const respondedAgentIds = uniqueIds(
    calls
      .filter((call) => call.outcome === "visible" || call.outcome === "placeholder")
      .map((call) => call.agentId),
  );
  const orderedPosts = posts
    .map((post, index) => ({ post, index }))
    .toSorted((left, right) => {
      const leftAt = left.post.atMs ?? left.index;
      const rightAt = right.post.atMs ?? right.index;
      if (leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return left.index - right.index;
    });
  let firstUsefulAtMs: number | undefined;
  orderedPosts.forEach((entry, index) => {
    if (
      firstUsefulAtMs === undefined &&
      verdicts[index]?.useful &&
      typeof entry.post.atMs === "number"
    ) {
      firstUsefulAtMs = entry.post.atMs;
    }
  });
  const visiblePostCount = posts.filter(
    (post) =>
      !post.noReply && !post.duplicateSuppressed && !isNoReplyText(post.text) && post.text.trim(),
  ).length;
  const usefulPostCount = verdicts.filter((verdict) => verdict.useful).length;
  const completeCallCount = calls.length;
  const wasteCallCount = calls.filter((call) => WASTE_OUTCOMES.has(call.outcome)).length;
  const humanMessageAtMs = signals.humanMessageAtMs;
  const ttfuMs =
    typeof firstUsefulAtMs === "number" && typeof humanMessageAtMs === "number"
      ? firstUsefulAtMs - humanMessageAtMs
      : undefined;
  const outcome: FloorShadowBeatFill["outcome"] = {
    roundId: signals.roundId,
    respondedAgentIds,
    usefulAgentIds,
    noReply,
    duplicates,
    timeouts,
    qualityClassifierVersion: QUALITY_CLASSIFIER_VERSION,
    ...(typeof firstUsefulAtMs === "number" ? { firstUsefulAtMs } : {}),
  };
  return {
    intent,
    need,
    outcome,
    recordParts: {
      qualityClassifierVersion: QUALITY_CLASSIFIER_VERSION,
      roundId: signals.roundId,
      intent,
      need,
      admittedAgentIds: uniqueIds(signals.admittedAgentIds),
      respondedAgentIds,
      usefulAgentIds,
      noReply,
      duplicates,
      timeouts,
      visiblePostCount,
      usefulPostCount,
      completeCallCount,
      wasteCallCount,
      humanInterrupted: isHumanInterrupt({
        humanMessageAtMs,
        followUps: signals.humanFollowUps,
      }),
      ...(typeof firstUsefulAtMs === "number" ? { firstUsefulAtMs } : {}),
      ...(typeof humanMessageAtMs === "number" ? { humanMessageAtMs } : {}),
      ...(typeof ttfuMs === "number" ? { ttfuMs } : {}),
    },
  };
}

export function buildFloorShadowRecord(params: {
  signals: FloorShadowSignals;
  groupId: string;
  tenantId?: string | null;
  episodeId: string;
  beatId: string;
  at?: number;
}): FloorShadowRecord {
  const at = params.at ?? Date.now();
  const derived = deriveFloorShadowBeat(params.signals);
  return {
    schemaVersion: FLOOR_SHADOW_SCHEMA_VERSION,
    kind: "floor_shadow",
    protocol: "shadow",
    at,
    recordId: floorShadowRecordId(params.episodeId, params.beatId, params.signals.roundId),
    groupId: params.groupId,
    tenantId: params.tenantId ?? null,
    episodeId: params.episodeId,
    beatId: params.beatId,
    ...derived.recordParts,
  };
}

async function shadowRecordExists(filePath: string, recordId: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { recordId?: unknown };
      if (parsed.recordId === recordId) {
        return true;
      }
    } catch {
      // Skip unknown / corrupt lines (same posture as the ledger reader).
    }
  }
  return false;
}

export async function appendFloorShadowRecord(params: {
  filePath: string;
  record: FloorShadowRecord;
}): Promise<{ wrote: boolean }> {
  if (appendOverride) {
    await appendOverride(params.filePath, params.record);
    return { wrote: true };
  }
  const dir = path.dirname(params.filePath);
  return await withRoundLock(dir, "floor-shadow", async () => {
    if (await shadowRecordExists(params.filePath, params.record.recordId)) {
      return { wrote: false };
    }
    await appendJsonlDurable(params.filePath, params.record);
    return { wrote: true };
  });
}

export async function recordFloorShadow(params: {
  signals: FloorShadowSignals;
  groupId: string;
  tenantId?: string | null;
  episodeId: string;
  beatId: string;
  roundsDir?: string;
  cfg?: OpenBotConfig;
  at?: number;
}): Promise<{ enabled: boolean; wrote: boolean; filePath: string | null }> {
  const cfg = params.cfg;
  if (!isCollabFloorShadowEnabled(cfg)) {
    return { enabled: false, wrote: false, filePath: null };
  }
  const filePath = resolveFloorShadowFile({
    groupId: params.groupId,
    tenantId: params.tenantId,
    roundsDir: params.roundsDir,
    cfg,
  });
  const record = buildFloorShadowRecord(params);
  const result = await appendFloorShadowRecord({ filePath, record });
  return { enabled: true, wrote: result.wrote, filePath };
}

type RoundDecisionSlice = {
  responseMode?: string;
  primaryQueue?: readonly string[];
  mentionMode?: EpisodeIntentInput["mentionMode"];
  roundPlan?: {
    mentionAll?: boolean;
    alerts?: ReadonlyArray<{ kind: string }>;
  };
};

function callsFromRound(
  round: PersistedRound,
  posts: readonly { agentId: string; text: string }[],
): FloorShadowCall[] {
  const calls: FloorShadowCall[] = [];
  for (const post of posts) {
    if (isNoReplyText(post.text)) {
      calls.push({ agentId: post.agentId, outcome: "no_reply" });
      continue;
    }
    if (classifyPlaceholderReply(post.text)) {
      calls.push({ agentId: post.agentId, outcome: "placeholder" });
      continue;
    }
    calls.push({ agentId: post.agentId, outcome: "visible" });
  }
  for (const dispatch of round.dispatches) {
    if (dispatch.status === "skipped_duplicate") {
      calls.push({ agentId: dispatch.agentId, outcome: "duplicate" });
    }
  }
  const primaryId = round.primaryAgentId;
  const primaryHasText = posts.some((post) => post.agentId === primaryId && post.text.trim());
  const status = round.completion?.responseStatus;
  if (primaryId && !primaryHasText && (status === "placeholder" || status === "failed")) {
    calls.push({
      agentId: primaryId,
      outcome: status === "placeholder" ? "placeholder" : "timeout",
    });
  }
  return calls;
}

/**
 * After a beat/round settles. No-op unless protocol === "shadow".
 * Does not mutate `round`. Callers must catch: a throw must not abort the round.
 */
export async function observeFloorShadowAfterRound(params: {
  round: PersistedRound;
  message?: string;
  inboundDepth?: EpisodeIntentInput["inboundDepth"];
  decision?: RoundDecisionSlice;
  posts?: readonly { agentId: string; text: string; atMs?: number }[];
  roundsDir?: string;
  cfg?: OpenBotConfig;
  humanFollowUps?: readonly FloorShadowFollowUp[];
}): Promise<{ enabled: boolean; wrote: boolean }> {
  if (!isCollabFloorShadowEnabled(params.cfg)) {
    return { enabled: false, wrote: false };
  }
  const round = params.round;
  const groupId = round.groupId?.trim() || "";
  if (!groupId) {
    return { enabled: false, wrote: false };
  }
  const episodeId = round.episodeRef?.episodeId || episodeIdForClientRun(round.roundId);
  const beatId =
    round.episodeRef?.beatId && round.episodeRef.beatId.trim()
      ? round.episodeRef.beatId
      : beatIdForEpisode(episodeId, 0);
  const mentionMode = params.decision?.mentionMode ?? round.mentionMode;
  const posts = params.posts ?? [];
  const signals: FloorShadowSignals = {
    roundId: round.roundId,
    intentInput: {
      message: params.message,
      mentionMode,
      mentionAll: params.decision?.roundPlan?.mentionAll,
      mentionedAgentIds:
        mentionMode === "single_primary" || mentionMode === "explicit_multi"
          ? (params.decision?.primaryQueue ?? round.primaryQueue)
          : [],
      responseMode: params.decision?.responseMode,
      alertKinds: params.decision?.roundPlan?.alerts?.map((alert) => alert.kind),
      inboundDepth: params.inboundDepth,
    },
    need: {
      mentionedAgentIds:
        mentionMode === "single_primary" || mentionMode === "explicit_multi"
          ? (params.decision?.primaryQueue ?? round.primaryQueue)
          : [],
      eligibleAgentIds: params.decision?.primaryQueue ?? round.primaryQueue,
      answeredAgentIds: posts
        .filter((post) => post.text.trim() && !isNoReplyText(post.text))
        .map((post) => post.agentId),
    },
    posts: posts.map((post) => ({
      agentId: post.agentId,
      text: post.text,
      atMs: post.atMs,
    })),
    admittedAgentIds: params.decision?.primaryQueue ?? round.primaryQueue,
    calls: callsFromRound(round, posts),
    humanMessageAtMs: round.createdAt,
    humanFollowUps: params.humanFollowUps,
    triggerText: params.message,
  };
  const result = await recordFloorShadow({
    signals,
    groupId,
    tenantId: round.tenantId,
    episodeId,
    beatId,
    roundsDir: params.roundsDir,
    cfg: params.cfg,
    at: round.updatedAt || round.createdAt,
  });
  return { enabled: result.enabled, wrote: result.wrote };
}

function asSignals(value: unknown): FloorShadowSignals | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as FloorShadowSignals;
  if (!record.intentInput || typeof record.roundId !== "string") {
    return null;
  }
  return record;
}

registerFloorShadowBeatFiller({
  isEnabled: (cfg) => isCollabFloorShadowEnabled(cfg),
  fill: (signals) => {
    const parsed = asSignals(signals);
    if (!parsed) {
      throw new Error("floor shadow fill: signals are incomplete");
    }
    const derived = deriveFloorShadowBeat(parsed);
    return { intent: derived.intent, need: derived.need, outcome: derived.outcome };
  },
});

registerFloorShadowDecisionSink({
  isEnabled: (cfg) => isCollabFloorShadowEnabled(cfg),
  record: async (value, cfg) => {
    if (!value || typeof value !== "object") {
      return;
    }
    const edr = value as {
      key?: { groupId?: string; tenantId?: string | null; episodeId?: string; beatId?: string };
      intent?: CollaborationIntentKind;
      need?: EpisodeNeed;
      outcome?: FloorShadowBeatFill["outcome"];
      legacy?: { admitted?: string[] };
      at?: number;
    };
    const key = edr.key;
    if (!key?.groupId || !key.episodeId || !key.beatId || !edr.need || !edr.intent) {
      return;
    }
    const roundId = edr.outcome?.roundId || key.episodeId;
    const record: FloorShadowRecord = {
      schemaVersion: FLOOR_SHADOW_SCHEMA_VERSION,
      kind: "floor_shadow",
      qualityClassifierVersion: QUALITY_CLASSIFIER_VERSION,
      protocol: "shadow",
      at: edr.at ?? Date.now(),
      recordId: floorShadowRecordId(key.episodeId, key.beatId, roundId),
      groupId: key.groupId,
      tenantId: key.tenantId ?? null,
      episodeId: key.episodeId,
      beatId: key.beatId,
      roundId,
      intent: edr.intent,
      need: edr.need,
      admittedAgentIds: uniqueIds(edr.legacy?.admitted),
      respondedAgentIds: uniqueIds(edr.outcome?.respondedAgentIds),
      usefulAgentIds: uniqueIds(edr.outcome?.usefulAgentIds),
      noReply: uniqueIds(edr.outcome?.noReply),
      duplicates: uniqueIds(edr.outcome?.duplicates),
      timeouts: uniqueIds(edr.outcome?.timeouts),
      visiblePostCount: edr.outcome?.respondedAgentIds.length ?? 0,
      usefulPostCount: edr.outcome?.usefulAgentIds.length ?? 0,
      completeCallCount:
        (edr.outcome?.respondedAgentIds.length ?? 0) +
        (edr.outcome?.noReply.length ?? 0) +
        (edr.outcome?.duplicates.length ?? 0) +
        (edr.outcome?.timeouts.length ?? 0),
      wasteCallCount:
        (edr.outcome?.noReply.length ?? 0) +
        (edr.outcome?.duplicates.length ?? 0) +
        (edr.outcome?.timeouts.length ?? 0),
      humanInterrupted: false,
      ...(typeof edr.outcome?.firstUsefulAtMs === "number"
        ? { firstUsefulAtMs: edr.outcome.firstUsefulAtMs }
        : {}),
    };
    const filePath = resolveFloorShadowFile({
      groupId: key.groupId,
      tenantId: key.tenantId,
      cfg,
    });
    await appendFloorShadowRecord({ filePath, record });
  },
});
