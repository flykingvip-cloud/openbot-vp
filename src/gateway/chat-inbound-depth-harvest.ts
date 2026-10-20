/**
 * Durable short-retention JSONL harvest for inbound depth shadow samples.
 *
 * Why: `emitChatInboundStage` only fans out via `emitAgentEvent` (lifecycle).
 * LIVE docker logs / session JSON do not retain `chat.depth_decided`, so
 * operators cannot build a wouldDepth scorecard before enabling ROUTER.
 *
 * Default-safe: follows SHADOW/ROUTER (see `isChatInboundDepthHarvestEnabled`).
 * No remote I/O. Never records user text. Failures never enter the chat path.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import {
  isChatInboundDepthHarvestEnabled,
  listEnabledChatInboundFlags,
} from "./chat-inbound-flags.js";

function hashSessionKey(sessionKey: string): string {
  return createHash("sha256").update(sessionKey).digest("hex").slice(0, 16);
}

export const INBOUND_DEPTH_HARVEST_DIR = "inbound-depth-harvest";
export const INBOUND_DEPTH_HARVEST_RETENTION_DAYS_DEFAULT = 14;
export const INBOUND_DEPTH_HARVEST_RETENTION_DAYS_MAX = 90;

export type InboundDepthHarvestRecord = {
  ts: string;
  event: "chat.depth_decided";
  runId: string;
  sessionKeyHash?: string;
  wouldDepth?: string;
  mode?: string;
  routeMs?: number;
  routeStrength?: string;
  classifierVersion?: string;
  reasons?: string[];
  flags?: string[];
};

type HarvestClock = {
  now: () => number;
  rootDir?: string;
  enabled?: boolean;
  retentionDays?: number;
};

let clock: HarvestClock = { now: Date.now };

const FORBIDDEN_EXTRA_KEYS = new Set([
  "text",
  "body",
  "content",
  "prompt",
  "message",
  "attachment",
  "attachments",
  "token",
  "secret",
  "password",
  "apikey",
]);

function assertNoSensitiveFields(extra: Record<string, unknown>): void {
  for (const key of Object.keys(extra)) {
    if (FORBIDDEN_EXTRA_KEYS.has(key.toLowerCase())) {
      throw new Error(`inbound depth harvest forbids field "${key}"`);
    }
  }
}

function resolveRetentionDays(): number {
  if (clock.retentionDays !== undefined) {
    return clock.retentionDays;
  }
  const raw = process.env.OPENBOT_CHAT_INBOUND_DEPTH_HARVEST_RETENTION_DAYS?.trim();
  if (!raw) {
    return INBOUND_DEPTH_HARVEST_RETENTION_DAYS_DEFAULT;
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return INBOUND_DEPTH_HARVEST_RETENTION_DAYS_DEFAULT;
  }
  return Math.min(parsed, INBOUND_DEPTH_HARVEST_RETENTION_DAYS_MAX);
}

export function resolveInboundDepthHarvestRoot(env: NodeJS.ProcessEnv = process.env): string {
  if (clock.rootDir) {
    return clock.rootDir;
  }
  return path.join(resolveStateDir(env), INBOUND_DEPTH_HARVEST_DIR);
}

export function resolveInboundDepthHarvestFilePath(params?: {
  atMs?: number;
  rootDir?: string;
}): string {
  const atMs = params?.atMs ?? clock.now();
  const day = new Date(atMs).toISOString().slice(0, 10);
  const root = params?.rootDir ?? resolveInboundDepthHarvestRoot();
  return path.join(root, `depth-decided-${day}.jsonl`);
}

function isHarvestEnabled(): boolean {
  if (clock.enabled !== undefined) {
    return clock.enabled;
  }
  return isChatInboundDepthHarvestEnabled();
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const out = value.filter((item): item is string => typeof item === "string" && item.length > 0);
  return out.length > 0 ? out : undefined;
}

export function buildInboundDepthHarvestRecord(params: {
  runId: string;
  sessionKey?: string;
  extra?: Record<string, unknown>;
  atMs?: number;
}): InboundDepthHarvestRecord {
  const extra = params.extra ?? {};
  assertNoSensitiveFields(extra);
  const atMs = params.atMs ?? clock.now();
  const record: InboundDepthHarvestRecord = {
    ts: new Date(atMs).toISOString(),
    event: "chat.depth_decided",
    runId: params.runId,
  };
  if (params.sessionKey) {
    record.sessionKeyHash = hashSessionKey(params.sessionKey);
  }
  const wouldDepth = asString(extra.wouldDepth);
  if (wouldDepth) {
    record.wouldDepth = wouldDepth;
  }
  const mode = asString(extra.mode);
  if (mode) {
    record.mode = mode;
  }
  const routeMs = asNumber(extra.routeMs);
  if (routeMs !== undefined) {
    record.routeMs = routeMs;
  }
  const routeStrength = asString(extra.routeStrength);
  if (routeStrength) {
    record.routeStrength = routeStrength;
  }
  const classifierVersion = asString(extra.classifierVersion);
  if (classifierVersion) {
    record.classifierVersion = classifierVersion;
  }
  const reasons = asStringArray(extra.reasons);
  if (reasons) {
    record.reasons = reasons;
  }
  const flags = listEnabledChatInboundFlags();
  if (flags.length > 0) {
    record.flags = flags;
  }
  return record;
}

export function pruneInboundDepthHarvestFiles(params?: {
  rootDir?: string;
  nowMs?: number;
  retentionDays?: number;
}): string[] {
  const root = params?.rootDir ?? resolveInboundDepthHarvestRoot();
  const retentionDays = params?.retentionDays ?? resolveRetentionDays();
  const nowMs = params?.nowMs ?? clock.now();
  const cutoffMs = nowMs - retentionDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  let entries: string[];
  try {
    entries = fs.readdirSync(root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return removed;
    }
    throw err;
  }
  for (const name of entries) {
    const match = /^depth-decided-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
    if (!match) {
      continue;
    }
    const dayStartMs = Date.parse(`${match[1]}T00:00:00.000Z`);
    if (!Number.isFinite(dayStartMs) || dayStartMs >= cutoffMs) {
      continue;
    }
    const full = path.join(root, name);
    try {
      fs.unlinkSync(full);
      removed.push(full);
    } catch {
      // best-effort prune
    }
  }
  return removed;
}

export function appendInboundDepthHarvestRecord(
  record: InboundDepthHarvestRecord,
  params?: { rootDir?: string },
): string | null {
  const root = params?.rootDir ?? resolveInboundDepthHarvestRoot();
  const atMs = Date.parse(record.ts);
  const filePath = resolveInboundDepthHarvestFilePath({
    atMs: Number.isFinite(atMs) ? atMs : clock.now(),
    rootDir: root,
  });
  fs.mkdirSync(root, { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  try {
    pruneInboundDepthHarvestFiles({ rootDir: root });
  } catch {
    // prune must not block harvest
  }
  return filePath;
}

/**
 * Hook from `emitChatInboundStage`. Only persists `depth_decided`. Never throws.
 */
export function maybeHarvestChatInboundStage(params: {
  runId: string;
  stage: string;
  sessionKey?: string;
  extra?: Record<string, unknown>;
}): void {
  try {
    if (params.stage !== "depth_decided") {
      return;
    }
    if (!isHarvestEnabled()) {
      return;
    }
    const record = buildInboundDepthHarvestRecord({
      runId: params.runId,
      sessionKey: params.sessionKey,
      extra: params.extra,
    });
    appendInboundDepthHarvestRecord(record);
  } catch {
    // Harvest must never break chat.send.
  }
}

export function readInboundDepthHarvestRecords(params?: {
  rootDir?: string;
  filePath?: string;
  limit?: number;
}): InboundDepthHarvestRecord[] {
  const paths: string[] = [];
  if (params?.filePath) {
    paths.push(params.filePath);
  } else {
    const root = params?.rootDir ?? resolveInboundDepthHarvestRoot();
    let entries: string[] = [];
    try {
      entries = fs
        .readdirSync(root)
        .filter((name) => /^depth-decided-\d{4}-\d{2}-\d{2}\.jsonl$/.test(name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    entries.sort();
    for (const name of entries) {
      paths.push(path.join(root, name));
    }
  }
  const records: InboundDepthHarvestRecord[] = [];
  for (const filePath of paths) {
    let raw: string;
    try {
      raw = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        continue;
      }
      throw err;
    }
    for (const line of raw.split("\n")) {
      if (!line.trim()) {
        continue;
      }
      try {
        const parsed = JSON.parse(line) as InboundDepthHarvestRecord;
        if (parsed?.event === "chat.depth_decided" && typeof parsed.runId === "string") {
          records.push(parsed);
        }
      } catch {
        // skip corrupt
      }
    }
  }
  if (params?.limit && params.limit > 0 && records.length > params.limit) {
    return records.slice(-params.limit);
  }
  return records;
}

/** Reasons that imply side-effect / ops intent — chat would be under-route. */
export const UNDER_ROUTE_RISK_REASONS = new Set([
  "explicit_write_or_side_effect",
  "explicit_publish_intent",
  "execution_typeset_or_channel_publish",
  "steward_operational_intent",
  "account_computer_browser",
]);

export type InboundDepthScorecard = {
  total: number;
  byWouldDepth: Record<string, number>;
  byMode: Record<string, number>;
  byReason: Record<string, number>;
  underRouteRiskCount: number;
  underRouteRiskSamples: Array<{
    runId: string;
    ts: string;
    wouldDepth?: string;
    reasons?: string[];
  }>;
  chatSampleCount: number;
  retrieveSampleCount: number;
  actSampleCount: number;
  goNoGoHints: string[];
};

function bump(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

export function buildInboundDepthScorecard(
  records: readonly InboundDepthHarvestRecord[],
): InboundDepthScorecard {
  const byWouldDepth: Record<string, number> = {};
  const byMode: Record<string, number> = {};
  const byReason: Record<string, number> = {};
  const underRouteRiskSamples: InboundDepthScorecard["underRouteRiskSamples"] = [];
  for (const record of records) {
    bump(byWouldDepth, record.wouldDepth ?? "unknown");
    bump(byMode, record.mode ?? "unknown");
    for (const reason of record.reasons ?? []) {
      bump(byReason, reason);
    }
    const reasons = record.reasons ?? [];
    const risky = reasons.some((reason) => UNDER_ROUTE_RISK_REASONS.has(reason));
    // Under-route: act-like reason but classified chat (should be rare if reasons match depth).
    // Also flag chat with empty/default only when ops attach probe expectations separately.
    if (risky && record.wouldDepth === "chat") {
      underRouteRiskSamples.push({
        runId: record.runId,
        ts: record.ts,
        wouldDepth: record.wouldDepth,
        reasons: record.reasons,
      });
    }
  }
  const chatSampleCount = byWouldDepth.chat ?? 0;
  const retrieveSampleCount = byWouldDepth.retrieve ?? 0;
  const actSampleCount = byWouldDepth.act ?? 0;
  const goNoGoHints: string[] = [];
  if (records.length === 0) {
    goNoGoHints.push("no_samples");
  } else {
    if (chatSampleCount === 0) {
      goNoGoHints.push("missing_chat_samples");
    }
    if (retrieveSampleCount === 0) {
      goNoGoHints.push("missing_retrieve_samples");
    }
    if (actSampleCount === 0) {
      goNoGoHints.push("missing_act_samples");
    }
    if (underRouteRiskSamples.length > 0) {
      goNoGoHints.push("under_route_risk_hits");
    }
  }
  if (goNoGoHints.length === 0) {
    goNoGoHints.push("mix_present_review_under_route_manually");
  }
  return {
    total: records.length,
    byWouldDepth,
    byMode,
    byReason,
    underRouteRiskCount: underRouteRiskSamples.length,
    underRouteRiskSamples: underRouteRiskSamples.slice(0, 20),
    chatSampleCount,
    retrieveSampleCount,
    actSampleCount,
    goNoGoHints,
  };
}

export function configureInboundDepthHarvestForTest(next?: {
  enabled?: boolean;
  now?: () => number;
  rootDir?: string;
  retentionDays?: number;
}): void {
  clock = {
    now: next?.now ?? Date.now,
    rootDir: next?.rootDir,
    enabled: next?.enabled,
    retentionDays: next?.retentionDays,
  };
}

export function resetInboundDepthHarvestForTest(): void {
  clock = { now: Date.now };
}
