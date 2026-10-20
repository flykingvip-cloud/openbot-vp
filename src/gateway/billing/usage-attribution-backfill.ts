/**
 * 历史 UsageRecord 归属标签回填：从 session store 索引 runId→agentId，
 * 再结合 seat store 补齐 orgSeatId。
 */

import fs from "node:fs";
import { listAgentIds } from "../../agents/agent-scope.js";
import type { OpenBotConfig } from "../../config/config.js";
import { loadConfig } from "../../config/config.js";
import { loadSessionStore, resolveStorePath } from "../../config/sessions.js";
import { resolveAgentIdFromSessionKey } from "../../routing/session-key.js";
import type { EnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import { loadEnterpriseSeatAssetsStore } from "../enterprise-seat-assets-store.js";
import type { UsageRecord } from "./types.js";
import {
  resolveOrgSeatIdForAgentInStore,
  resolveOrgSeatIdForMemberInStore,
} from "./usage-attribution-context.js";
import { applyUsageAttributionPatches, listUsageRecords } from "./usage-records-store.js";

export type RunIdAgentIndexEntry = {
  agentId: string;
  sessionKey?: string;
};

export type RunIdAgentIndex = Map<string, RunIdAgentIndexEntry>;

/** 从 credit:/provider-cost: 事件幂等键提取 taskId（通常为 agent runId）。 */
export function extractCreditTaskIdFromEventId(eventId: string): string | null {
  const trimmed = eventId.trim();
  if (trimmed.startsWith("credit:")) {
    const taskId = trimmed.slice("credit:".length).trim();
    return taskId || null;
  }
  if (trimmed.startsWith("provider-cost:")) {
    const taskId = trimmed.slice("provider-cost:".length).trim();
    return taskId || null;
  }
  return null;
}

/** 从 aor:{runId}:... 事件幂等键提取 AOR runId。 */
export function extractAorRunIdFromEventId(eventId: string): string | null {
  const trimmed = eventId.trim();
  if (!trimmed.startsWith("aor:")) {
    return null;
  }
  const parts = trimmed.split(":");
  const runId = parts[1]?.trim();
  return runId || null;
}

/** 扫描各 agent 的 sessions.json，建立 sessionId(runId) → agentId 索引。 */
export function buildRunIdAgentIndexFromConfig(cfg: OpenBotConfig): RunIdAgentIndex {
  return buildRunIdAgentIndexFromResolver(cfg, (agentId) =>
    resolveStorePath(cfg.session?.store, { agentId }),
  );
}

/** Tenant-aware variant: caller supplies per-agent store path resolver (P3). */
export function buildRunIdAgentIndexFromResolver(
  cfg: OpenBotConfig,
  resolveAgentStorePath: (agentId: string) => string,
): RunIdAgentIndex {
  const index: RunIdAgentIndex = new Map();
  for (const agentId of listAgentIds(cfg)) {
    const storePath = resolveAgentStorePath(agentId);
    if (!fs.existsSync(storePath)) {
      continue;
    }
    const store = loadSessionStore(storePath, { skipCache: true });
    for (const [storeKey, entry] of Object.entries(store)) {
      const sessionId = entry?.sessionId?.trim();
      if (!sessionId || index.has(sessionId)) {
        continue;
      }
      index.set(sessionId, {
        agentId: resolveAgentIdFromSessionKey(storeKey),
        sessionKey: storeKey,
      });
    }
  }
  return index;
}

export type UsageAttributionBackfillResult = {
  scanned: number;
  updated: number;
  alreadyTagged: number;
  unresolved: number;
  dryRun: boolean;
};

export type InferUsageAttributionInput = {
  record: UsageRecord;
  seatStore: EnterpriseSeatAssetsStore;
  runIndex: RunIdAgentIndex;
};

/** 为单条历史记录推断可补齐的 agentId / orgSeatId（不修改 store）。 */
export function inferUsageAttributionForRecord(
  input: InferUsageAttributionInput,
): { agentId?: string; orgSeatId?: string } | null {
  const rec = input.record;
  const existingAgentId = rec.agentId?.trim();
  const existingOrgSeatId = rec.orgSeatId?.trim();
  if (existingAgentId && existingOrgSeatId) {
    return null;
  }

  let agentId = existingAgentId;
  if (!agentId) {
    const creditTaskId = extractCreditTaskIdFromEventId(rec.eventId);
    if (creditTaskId) {
      agentId = input.runIndex.get(creditTaskId)?.agentId;
    }
    if (!agentId) {
      const aorRunId = extractAorRunIdFromEventId(rec.eventId);
      if (aorRunId) {
        agentId = input.runIndex.get(aorRunId)?.agentId;
      }
    }
  }

  let orgSeatId = existingOrgSeatId;
  if (!orgSeatId && agentId) {
    orgSeatId =
      resolveOrgSeatIdForAgentInStore(input.seatStore, rec.enterpriseId, agentId) ?? undefined;
  }
  if (!orgSeatId && rec.userId?.trim()) {
    orgSeatId =
      resolveOrgSeatIdForMemberInStore(input.seatStore, rec.enterpriseId, rec.userId) ?? undefined;
  }

  const nextAgentId = existingAgentId || agentId;
  const nextOrgSeatId = existingOrgSeatId || orgSeatId;
  if (!nextAgentId && !nextOrgSeatId) {
    return null;
  }

  const patch: { agentId?: string; orgSeatId?: string } = {};
  if (nextAgentId && nextAgentId !== existingAgentId) {
    patch.agentId = nextAgentId;
  }
  if (nextOrgSeatId && nextOrgSeatId !== existingOrgSeatId) {
    patch.orgSeatId = nextOrgSeatId;
  }
  if (!patch.agentId && !patch.orgSeatId) {
    return null;
  }
  return patch;
}

export type BackfillUsageAttributionInput = {
  enterpriseId: string;
  startTime?: string;
  endTime?: string;
  dryRun?: boolean;
  usageStorePath?: string;
  seatAssetsPath?: string;
  cfg?: OpenBotConfig;
  runIndex?: RunIdAgentIndex;
  seatStore?: EnterpriseSeatAssetsStore;
};

/** 为企业历史用量记录回填 agentId / orgSeatId。 */
export async function backfillUsageAttribution(
  input: BackfillUsageAttributionInput,
): Promise<UsageAttributionBackfillResult> {
  const cfg = input.cfg ?? loadConfig();
  const runIndex = input.runIndex ?? buildRunIdAgentIndexFromConfig(cfg);
  const seatStore = input.seatStore ?? (await loadEnterpriseSeatAssetsStore(input.seatAssetsPath));

  const records = await listUsageRecords(
    input.enterpriseId,
    {
      ...(input.startTime ? { startTime: input.startTime } : {}),
      ...(input.endTime ? { endTime: input.endTime } : {}),
    },
    input.usageStorePath,
  );

  let alreadyTagged = 0;
  let unresolved = 0;
  const patches: Array<{ id: string; agentId?: string; orgSeatId?: string }> = [];

  for (const rec of records) {
    if (rec.agentId?.trim() && rec.orgSeatId?.trim()) {
      alreadyTagged += 1;
      continue;
    }
    const inferred = inferUsageAttributionForRecord({ record: rec, seatStore, runIndex });
    if (!inferred) {
      unresolved += 1;
      continue;
    }
    patches.push({ id: rec.id, ...inferred });
  }

  const dryRun = input.dryRun === true;
  const updated = dryRun
    ? patches.length
    : await applyUsageAttributionPatches(input.enterpriseId, patches, input.usageStorePath);

  return {
    scanned: records.length,
    updated,
    alreadyTagged,
    unresolved,
    dryRun,
  };
}
