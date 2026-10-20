/**
 * Floor Runtime v2.1 §5.8 P2-B — Shadow-B L2 bids.
 * Real model calls only for ambiguous candidates, sampled, capped at 2.5s,
 * under the parent AbortSignal (capability red line A3/A4).
 * Bids never enter admission and never rewrite a production decision.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { stripCollabEdgeDirectives } from "./collab-edge.js";
import { createFileFloorBidTokenLedger, type FloorBidTokenLedger } from "./floor-bid-budget.js";
import {
  calibrateFloorBidSamples,
  type FloorBidCalibrationRow,
  type FloorBidCalibrationSample,
} from "./floor-bid-calibration.js";
import { resolveEpisodeNeed, type EpisodeDecisionNeedSource } from "./need-resolver.js";
import { charNgramSet, classifyUsefulPosts, jaccardSimilarity } from "./quality-classifier.js";
import { routeL0, type FloorRouterInput } from "./router-l0.js";
import { routeL1 } from "./router-l1.js";
import type { RuntimeAuthority, RuntimeFacts } from "./runtime-authority.js";
import { resolveCollaborationRuntimeFactPaths } from "./runtime-namespace.js";
import { readCollabFloorShadowConfig } from "./shadow-stage-flag.js";

export const FLOOR_BID_DEADLINE_CAP_MS = 2_500;
export const FLOOR_BID_TOKEN_ESTIMATE = 128;
export const FLOOR_BID_INTENTS = [
  "answer",
  "supplement",
  "challenge",
  "evidence",
  "handoff_ack",
  "pass",
] as const;

export type FloorBidIntent = (typeof FLOOR_BID_INTENTS)[number];

export type FloorBidSkipReason = "sample" | "cap" | "timeout" | "aborted" | "error" | "max_bidders";

export type FloorBid = {
  bidId: string;
  agentId: string;
  intent: FloorBidIntent;
  selfAssessment: { novelty: number; confidence: number };
  admissionSignals: {
    novelty: number;
    duplicateSimilarity: number;
    capabilityFit: number;
  };
  evidenceRefs: string[];
  estimatedTokens: number;
  gist: string;
  producer: "model";
  costTokens: number;
  createdAt: number;
};

export type FloorBidModel = (params: {
  agentId: string;
  message: string;
  capabilityFit: number;
  signal: AbortSignal;
}) => Promise<{ text: string; costTokens: number } | null>;

export type FloorBidCollectResult = {
  bids: FloorBid[];
  skipped: Array<{ agentId: string; reason: FloorBidSkipReason }>;
  tokensUsed: number;
};

export type FloorBidJoinResult = FloorBidCollectResult & {
  calibration: FloorBidCalibrationRow[];
  /** Always false until a later phase reviews driving production. */
  drivesProductionDecision: false;
};

type CollectedShadow = FloorBidCollectResult & {
  intent: string;
  needSource: EpisodeDecisionNeedSource;
  message: string;
  enabled: boolean;
  shadowDir: string | null;
};

let modelOverride: FloorBidModel | null = null;

/** Tests inject a model so Shadow-B does not call a provider. */
export function setFloorBidModelForTest(model: FloorBidModel | null): void {
  modelOverride = model;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(clamp01(value) * 10_000) / 10_000;
}

export function resolveFloorBidDeadlineMs(deadlineMs: number): number {
  const policy = Number.isFinite(deadlineMs) ? deadlineMs : FLOOR_BID_DEADLINE_CAP_MS;
  return Math.min(FLOOR_BID_DEADLINE_CAP_MS, Math.max(1, Math.floor(policy)));
}

/** A3: parent signal plus a policy-bounded timeout. No AbortController. */
export function bindFloorBidSignal(
  parent: AbortSignal | undefined,
  deadlineMs: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(deadlineMs);
  if (!parent) {
    return timeout;
  }
  return AbortSignal.any([parent, timeout]);
}

function abortKind(signal: AbortSignal): "timeout" | "aborted" {
  const reason = signal.reason as { name?: string } | undefined;
  if (reason && typeof reason === "object" && reason.name === "TimeoutError") {
    return "timeout";
  }
  return "aborted";
}

function isolateGist(text: string): string {
  const stripped = stripCollabEdgeDirectives(text).replace(/\s+/g, " ").trim();
  return Array.from(stripped).slice(0, 120).join("");
}

const SAFE_EVIDENCE_REF = /^[A-Za-z0-9:_-]{1,80}$/;

export function parseFloorBidModelText(text: string): {
  intent: FloorBidIntent;
  novelty: number;
  confidence: number;
  gist: string;
  estimatedTokens: number;
  evidenceRefs: string[];
} | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  if (typeof record.novelty !== "number" || typeof record.confidence !== "number") {
    return null;
  }
  const intent = FLOOR_BID_INTENTS.find((candidate) => candidate === record.intent) ?? "pass";
  const gist = isolateGist(typeof record.gist === "string" ? record.gist : "");
  const estimatedTokens =
    typeof record.estimatedTokens === "number" &&
    Number.isFinite(record.estimatedTokens) &&
    record.estimatedTokens >= 0
      ? Math.floor(record.estimatedTokens)
      : 0;
  const evidenceRefs = Array.isArray(record.evidenceRefs)
    ? record.evidenceRefs.filter(
        (value): value is string => typeof value === "string" && SAFE_EVIDENCE_REF.test(value),
      )
    : [];
  return {
    intent,
    novelty: round4(record.novelty),
    confidence: round4(record.confidence),
    gist,
    estimatedTokens,
    evidenceRefs,
  };
}

function textSimilarity(left: string, right: string): number {
  if (!left.trim() || !right.trim()) {
    return 0;
  }
  return jaccardSimilarity(charNgramSet(left), charNgramSet(right));
}

function admissionSignalsFor(
  gist: string,
  message: string,
  otherGists: readonly string[],
  capabilityFit: number,
): FloorBid["admissionSignals"] {
  let maxSimilarity = textSimilarity(gist, message);
  for (const other of otherGists) {
    maxSimilarity = Math.max(maxSimilarity, textSimilarity(gist, other));
  }
  return {
    novelty: round4(1 - maxSimilarity),
    duplicateSimilarity: round4(maxSimilarity),
    capabilityFit: round4(capabilityFit),
  };
}

function bidPrompt(agentId: string, message: string): string {
  const excerpt = message.replace(/\s+/g, " ").trim().slice(0, 500);
  return [
    `你是协作小组成员 ${agentId}。只输出一行 JSON，不要解释，不要提及其他成员的发言。`,
    "字段：intent（answer|supplement|challenge|evidence|handoff_ack|pass）、novelty（0到1）、confidence（0到1）、gist（不超过120字）、estimatedTokens（整数）。",
    `人类消息：${excerpt}`,
  ].join("\n");
}

async function invokeBounded(
  model: FloorBidModel,
  params: { agentId: string; message: string; capabilityFit: number; signal: AbortSignal },
): Promise<{ text: string; costTokens: number } | null> {
  if (params.signal.aborted) {
    return null;
  }
  return await new Promise((resolve, reject) => {
    const onAbort = () => {
      reject(new Error(abortKind(params.signal)));
    };
    params.signal.addEventListener("abort", onAbort, { once: true });
    model(params)
      .then(resolve, reject)
      .finally(() => {
        params.signal.removeEventListener("abort", onAbort);
      });
  });
}

export async function collectFloorBids(params: {
  authority: RuntimeAuthority;
  ambiguous: ReadonlyArray<{ agentId: string; capabilityFit: number }>;
  message: string;
  signal?: AbortSignal;
  sampleRate: number;
  ledger: FloorBidTokenLedger;
  model: FloorBidModel;
  nowMs?: number;
  random?: () => number;
  tokenEstimate?: number;
  deadlineMs?: number;
  maxBidders?: number;
}): Promise<FloorBidCollectResult> {
  const rate = clamp01(params.sampleRate);
  const random = params.random ?? Math.random;
  const maxBidders = Math.max(
    0,
    params.maxBidders ?? params.authority.policy.effective.dispatch.tuning.floor.bid.maxBidders,
  );
  const estimate = Math.max(1, Math.floor(params.tokenEstimate ?? FLOOR_BID_TOKEN_ESTIMATE));
  const deadlineMs = resolveFloorBidDeadlineMs(
    params.deadlineMs ?? params.authority.policy.effective.dispatch.tuning.floor.bid.deadlineMs,
  );
  const skipped: FloorBidCollectResult["skipped"] = [];
  const picked: Array<{ agentId: string; capabilityFit: number }> = [];
  for (const candidate of params.ambiguous) {
    if (!candidate.agentId.trim()) {
      continue;
    }
    if (picked.length >= maxBidders) {
      skipped.push({ agentId: candidate.agentId, reason: "max_bidders" });
      continue;
    }
    if (random() >= rate) {
      skipped.push({ agentId: candidate.agentId, reason: "sample" });
      continue;
    }
    picked.push(candidate);
  }
  if (picked.length === 0) {
    return { bids: [], skipped, tokensUsed: 0 };
  }
  const signal = bindFloorBidSignal(params.signal, deadlineMs);
  const nowMs = params.nowMs ?? Date.now();
  const settled = await Promise.allSettled(
    picked.map(async (candidate, index) => {
      if (signal.aborted) {
        return { agentId: candidate.agentId, reason: abortKind(signal) } as const;
      }
      const reserved = await params.ledger.tryReserve(estimate);
      if (!reserved) {
        return { agentId: candidate.agentId, reason: "cap" as const };
      }
      try {
        const raw = await invokeBounded(params.model, {
          agentId: candidate.agentId,
          message: bidPrompt(candidate.agentId, params.message),
          capabilityFit: candidate.capabilityFit,
          signal,
        });
        if (!raw?.text) {
          await params.ledger.release(estimate);
          return {
            agentId: candidate.agentId,
            reason: signal.aborted ? abortKind(signal) : ("error" as const),
          };
        }
        const parsed = parseFloorBidModelText(raw.text);
        if (!parsed) {
          await params.ledger.release(estimate);
          return { agentId: candidate.agentId, reason: "error" as const };
        }
        const charged = await params.ledger.commit(
          estimate,
          Math.max(0, Math.floor(raw.costTokens)),
        );
        return {
          bid: {
            bidId: `${params.authority.episodeId}:${candidate.agentId}:${index}`,
            agentId: candidate.agentId,
            intent: parsed.intent,
            selfAssessment: { novelty: parsed.novelty, confidence: parsed.confidence },
            admissionSignals: { novelty: 0, duplicateSimilarity: 0, capabilityFit: 0 },
            evidenceRefs: parsed.evidenceRefs,
            estimatedTokens: parsed.estimatedTokens,
            gist: parsed.gist,
            producer: "model" as const,
            costTokens: charged,
            createdAt: nowMs,
          },
        };
      } catch {
        await params.ledger.release(estimate);
        return {
          agentId: candidate.agentId,
          reason: signal.aborted ? abortKind(signal) : ("error" as const),
        };
      }
    }),
  );
  const drafts: FloorBid[] = [];
  for (const entry of settled) {
    if (entry.status === "rejected") {
      continue;
    }
    const value = entry.value;
    if ("bid" in value && value.bid) {
      drafts.push(value.bid);
      continue;
    }
    if ("agentId" in value && "reason" in value) {
      skipped.push({ agentId: value.agentId, reason: value.reason });
    }
  }
  const bids = drafts.map((bid, index) => ({
    ...bid,
    admissionSignals: admissionSignalsFor(
      bid.gist,
      params.message,
      drafts.filter((_, other) => other !== index).map((other) => other.gist),
      picked.find((candidate) => candidate.agentId === bid.agentId)?.capabilityFit ?? 0,
    ),
  }));
  return {
    bids,
    skipped,
    tokensUsed: bids.reduce((sum, bid) => sum + bid.costTokens, 0),
  };
}

function shadowDirFor(params: { authority: RuntimeAuthority; roundsDir?: string }): string {
  const roundsDir = params.roundsDir?.trim();
  if (roundsDir) {
    return path.join(path.dirname(roundsDir), "shadow");
  }
  const facts = resolveCollaborationRuntimeFactPaths({
    groupId: params.authority.groupId,
    tenantId: params.authority.tenantId,
  });
  return facts.namespace?.shadowDir ?? path.join(path.dirname(facts.roundsDir), "shadow");
}

function emptyCollected(): CollectedShadow {
  return {
    bids: [],
    skipped: [],
    tokensUsed: 0,
    intent: "discussion",
    needSource: "none",
    message: "",
    enabled: false,
    shadowDir: null,
  };
}

async function resolveModel(): Promise<FloorBidModel | null> {
  if (modelOverride) {
    return modelOverride;
  }
  try {
    const loaded = await import("./floor-bid-model.js");
    return loaded.createProductionFloorBidModel();
  } catch {
    return null;
  }
}

function samplesFor(
  collected: CollectedShadow,
  posts: ReadonlyArray<{ agentId: string; text: string; atMs?: number }> | undefined,
): FloorBidCalibrationSample[] {
  const list = posts ?? [];
  const verdicts =
    list.length === 0
      ? []
      : classifyUsefulPosts({
          posts: list.map((post) => ({
            agentId: post.agentId,
            text: post.text,
            ...(post.atMs !== undefined ? { atMs: post.atMs } : {}),
          })),
          needSource: collected.needSource,
          triggerText: collected.message,
        });
  const usefulByAgent = new Map(verdicts.map((verdict) => [verdict.agentId, verdict.useful]));
  const postsKnown = list.length > 0;
  return collected.bids.map((bid) => ({
    agentId: bid.agentId,
    intent: collected.intent,
    selfNovelty: bid.selfAssessment.novelty,
    admissionNovelty: bid.admissionSignals.novelty,
    confidence: bid.selfAssessment.confidence,
    useful: postsKnown ? (usefulByAgent.get(bid.agentId) ?? false) : null,
  }));
}

async function readHistoricalSamples(filePath: string): Promise<FloorBidCalibrationSample[]> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    return [];
  }
  const samples: FloorBidCalibrationSample[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { samples?: FloorBidCalibrationSample[] };
      if (Array.isArray(parsed.samples)) {
        samples.push(...parsed.samples);
      }
    } catch {
      // Skip a corrupt line. The new beat still appends.
    }
  }
  return samples;
}

export type FloorBidHandle = {
  join(params?: {
    posts?: ReadonlyArray<{ agentId: string; text: string; atMs?: number }>;
  }): Promise<FloorBidJoinResult>;
};

/**
 * Beat start. The returned promise runs beside the round.
 * join() at round end waits for it and never throws.
 */
export function startFloorBidShadow(params: {
  authority: RuntimeAuthority;
  facts: RuntimeFacts;
  message: string;
  signal?: AbortSignal;
  roundsDir?: string;
  routerInput?: FloorRouterInput;
  nowMs?: number;
  random?: () => number;
  tokenEstimate?: number;
}): FloorBidHandle {
  const config = readCollabFloorShadowConfig();
  const collected = (async (): Promise<CollectedShadow> => {
    if (config.stage !== "B") {
      return emptyCollected();
    }
    const input = params.routerInput ?? { message: params.message };
    let ambiguous: Array<{ agentId: string; capabilityFit: number }> = [];
    let intent = "discussion";
    let needSource: EpisodeDecisionNeedSource = "none";
    try {
      const l0 = routeL0(params.authority, params.facts, input);
      const l1 = routeL1(params.authority, params.facts, l0, input);
      ambiguous = l1.ambiguous.map((candidate) => ({
        agentId: candidate.agentId,
        capabilityFit: candidate.capabilityFit,
      }));
      intent = l0.intent;
      needSource = resolveEpisodeNeed({
        intent: l0.intent,
        mentionedAgentIds: l0.mustAdmit
          .filter((row) => row.reason === "mention")
          .map((row) => row.agentId),
        eligibleAgentIds: l0.mustAdmit.map((row) => row.agentId),
        taskOwnerAgentId: l0.mustAdmit.find((row) => row.reason === "task_owner")?.agentId ?? null,
        handoffReceiverAgentIds: l0.mustAdmit
          .filter((row) => row.reason === "handoff_receiver")
          .map((row) => row.agentId),
      }).source;
    } catch {
      return emptyCollected();
    }
    const shadowDir = shadowDirFor(params);
    if (config.bidSampleRate <= 0 || config.bidDailyTokenCap <= 0 || ambiguous.length === 0) {
      const reason: FloorBidSkipReason = config.bidDailyTokenCap <= 0 ? "cap" : "sample";
      return {
        bids: [],
        skipped:
          config.bidSampleRate <= 0 || config.bidDailyTokenCap <= 0
            ? ambiguous.map((candidate) => ({ agentId: candidate.agentId, reason }))
            : [],
        tokensUsed: 0,
        intent,
        needSource,
        message: params.message,
        enabled: true,
        shadowDir,
      };
    }
    const model = await resolveModel();
    if (!model) {
      return {
        bids: [],
        skipped: ambiguous.map((candidate) => ({ agentId: candidate.agentId, reason: "error" })),
        tokensUsed: 0,
        intent,
        needSource,
        message: params.message,
        enabled: true,
        shadowDir,
      };
    }
    try {
      const result = await collectFloorBids({
        authority: params.authority,
        ambiguous,
        message: params.message,
        signal: params.signal,
        sampleRate: config.bidSampleRate,
        ledger: createFileFloorBidTokenLedger({
          filePath: path.join(shadowDir, "floor-bid-tokens.json"),
          cap: config.bidDailyTokenCap,
          nowMs: () => params.nowMs ?? Date.now(),
        }),
        model,
        ...(params.nowMs !== undefined ? { nowMs: params.nowMs } : {}),
        ...(params.random ? { random: params.random } : {}),
        ...(params.tokenEstimate !== undefined ? { tokenEstimate: params.tokenEstimate } : {}),
      });
      return {
        ...result,
        intent,
        needSource,
        message: params.message,
        enabled: true,
        shadowDir,
      };
    } catch {
      return {
        bids: [],
        skipped: ambiguous.map((candidate) => ({ agentId: candidate.agentId, reason: "error" })),
        tokensUsed: 0,
        intent,
        needSource,
        message: params.message,
        enabled: true,
        shadowDir,
      };
    }
  })();
  return {
    async join(extra) {
      const row = await collected.catch(() => emptyCollected());
      const samples = row.enabled ? samplesFor(row, extra?.posts) : [];
      let calibration: FloorBidCalibrationRow[] = [];
      if (row.enabled && row.shadowDir) {
        const filePath = path.join(row.shadowDir, "floor-bid-calibration.jsonl");
        try {
          const prior = await readHistoricalSamples(filePath);
          calibration = calibrateFloorBidSamples([...prior, ...samples]);
          await fs.mkdir(row.shadowDir, { recursive: true });
          await fs.appendFile(
            filePath,
            `${JSON.stringify({
              kind: "floor_bid_calibration",
              schemaVersion: 1,
              at: params.nowMs ?? Date.now(),
              groupId: params.authority.groupId,
              episodeId: params.authority.episodeId,
              intent: row.intent,
              tokensUsed: row.tokensUsed,
              sampleRate: config.bidSampleRate,
              dailyTokenCap: config.bidDailyTokenCap,
              bids: row.bids.map((bid) => ({
                agentId: bid.agentId,
                intent: bid.intent,
                selfAssessment: bid.selfAssessment,
                admissionSignals: bid.admissionSignals,
                producer: bid.producer,
                costTokens: bid.costTokens,
              })),
              skipped: row.skipped,
              samples,
              calibration,
              drivesProductionDecision: false,
            })}\n`,
            "utf8",
          );
        } catch {
          calibration = calibrateFloorBidSamples(samples);
        }
      }
      return {
        bids: row.bids,
        skipped: row.skipped,
        tokensUsed: row.tokensUsed,
        calibration,
        drivesProductionDecision: false,
      };
    },
  };
}
