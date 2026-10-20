import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../config/config.js";
import { discoverAllSessions, loadSessionCostSummary } from "../infra/session-cost-usage.js";
import { normalizeAgentId } from "../routing/session-key.js";

export type SeatUsageBinding = {
  seatId: string;
  agentIds: readonly string[];
  defaultAgentId?: string | null;
  /** 当前绑定员工账号（有则进入 users[] 归因；空岗不合成假成员）。 */
  memberUserId?: string | null;
};

export type AgentUsageTotals = {
  agentId: string;
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
};

export type SeatMonthlyUsageRow = {
  seatId: string;
  agentIds: string[];
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
  unmatchedAgentIds: string[];
};

export type UserMonthlyUsageRow = {
  userId: string;
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
};

export type MonthlySeatUsageResult = {
  tenantId: string;
  startDate: string;
  endDate: string;
  agents: AgentUsageTotals[];
  /** 按当前绑定员工账号汇总（同一员工跨岗合并）；无成员空岗不出现。 */
  users: UserMonthlyUsageRow[];
  seats: SeatMonthlyUsageRow[];
  unmatchedAgentIds: string[];
};

export function normalizeSeatUsageUserId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

/** Tenant-safe session discovery against an explicit sessions directory. */
async function discoverSessionsInDir(params: {
  sessionsDir: string;
  startMs?: number;
  endMs?: number;
}): Promise<Array<{ sessionId: string; sessionFile: string; mtime: number }>> {
  const sessionsDir = path.resolve(params.sessionsDir);
  const entries = await fs.promises.readdir(sessionsDir, { withFileTypes: true }).catch(() => []);
  const discovered: Array<{ sessionId: string; sessionFile: string; mtime: number }> = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    const sessionFile = path.join(sessionsDir, entry.name);
    const stats = await fs.promises.stat(sessionFile).catch(() => null);
    if (!stats) {
      continue;
    }
    if (params.startMs && stats.mtimeMs < params.startMs) {
      continue;
    }
    discovered.push({
      sessionId: entry.name.slice(0, -6),
      sessionFile,
      mtime: stats.mtimeMs,
    });
  }
  return discovered.toSorted((a, b) => b.mtime - a.mtime);
}

export function normalizeSeatAgentId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  return normalizeAgentId(trimmed);
}

/** unique(agentIds ∪ defaultAgentId)，按规范化去重，保留首次原始值。 */
export function collectUniqueSeatAgentIds(seat: {
  agentIds?: readonly string[] | null;
  defaultAgentId?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const original = typeof raw === "string" ? raw.trim() : "";
    const key = normalizeSeatAgentId(original);
    if (!key || seen.has(key)) {
      return;
    }
    seen.add(key);
    out.push(original);
  };
  for (const id of seat.agentIds ?? []) {
    push(id);
  }
  push(seat.defaultAgentId);
  return out;
}

export function buildSeatMonthlyUsageRows(params: {
  seats: readonly SeatUsageBinding[];
  usageByAgent: ReadonlyMap<string, Omit<AgentUsageTotals, "agentId">>;
  discoverableAgentIds: ReadonlySet<string>;
}): { seats: SeatMonthlyUsageRow[]; unmatchedAgentIds: string[] } {
  const globalUnmatched = new Set<string>();
  const seats = params.seats.map((seat) => {
    const agentIds = collectUniqueSeatAgentIds(seat);
    let totalTokens = 0;
    let totalCost = 0;
    let sessionCount = 0;
    let lastActiveAt: number | null = null;
    const unmatchedAgentIds: string[] = [];

    for (const agentId of agentIds) {
      const key = normalizeSeatAgentId(agentId);
      if (!key) {
        continue;
      }
      const slice = params.usageByAgent.get(key);
      if (!slice) {
        unmatchedAgentIds.push(agentId);
        globalUnmatched.add(agentId);
        continue;
      }
      if (!params.discoverableAgentIds.has(key)) {
        unmatchedAgentIds.push(agentId);
        globalUnmatched.add(agentId);
      }
      totalTokens += slice.totalTokens;
      totalCost += slice.totalCost;
      sessionCount += slice.sessionCount;
      if (slice.lastActiveAt != null) {
        lastActiveAt = Math.max(lastActiveAt ?? 0, slice.lastActiveAt);
      }
    }

    return {
      seatId: seat.seatId,
      agentIds,
      totalTokens,
      totalCost,
      sessionCount,
      lastActiveAt,
      unmatchedAgentIds,
    };
  });

  return {
    seats,
    unmatchedAgentIds: [...globalUnmatched].toSorted(),
  };
}

/**
 * 将岗位会话用量归因到当前绑定员工账号。
 * 数据源仍是租户隔离的 agent sessions（跟 live 一致），不另走 billing UsageRecord，
 * 避免与多租户会话根冲突或双计。
 */
export function buildUserMonthlyUsageRows(params: {
  seats: readonly SeatUsageBinding[];
  seatRows: readonly SeatMonthlyUsageRow[];
}): UserMonthlyUsageRow[] {
  const bySeatId = new Map(params.seatRows.map((row) => [row.seatId, row] as const));
  const userMap = new Map<string, UserMonthlyUsageRow>();

  for (const seat of params.seats) {
    const userKey = normalizeSeatUsageUserId(seat.memberUserId);
    if (!userKey) {
      continue;
    }
    const seatRow = bySeatId.get(seat.seatId);
    if (!seatRow) {
      continue;
    }
    const displayId = seat.memberUserId!.trim();
    const existing = userMap.get(userKey);
    if (!existing) {
      userMap.set(userKey, {
        userId: displayId,
        totalTokens: seatRow.totalTokens,
        totalCost: seatRow.totalCost,
        sessionCount: seatRow.sessionCount,
        lastActiveAt: seatRow.lastActiveAt,
      });
      continue;
    }
    existing.totalTokens += seatRow.totalTokens;
    existing.totalCost += seatRow.totalCost;
    existing.sessionCount += seatRow.sessionCount;
    if (seatRow.lastActiveAt != null) {
      existing.lastActiveAt = Math.max(existing.lastActiveAt ?? 0, seatRow.lastActiveAt);
    }
  }

  return [...userMap.values()].toSorted((a, b) => a.userId.localeCompare(b.userId));
}

/**
 * 仅扫描指定 agentIds 的会话用量（全量，不截断）。
 *
 * 租户隔离：共享多租户模式下调用方必须传入 resolveSessionsDirs，只扫描该租户
 * tenants/<tid>/users/<uid>/state/agents/<agentId>/sessions，禁止回落到全局
 * ~/.openbot/agents/<id>/sessions（否则同名 agent 会串账）。
 * 本地单根模式可不传，沿用全局 agent 会话目录。
 */
export async function loadUsageByAgentIds(params: {
  agentIds: readonly string[];
  startMs: number;
  endMs: number;
  resolveSessionsDirs?: (agentId: string) => Promise<readonly string[]> | readonly string[];
}): Promise<{
  usageByAgent: Map<string, Omit<AgentUsageTotals, "agentId">>;
  discoverableAgentIds: Set<string>;
  agents: AgentUsageTotals[];
}> {
  const config = loadConfig();
  const uniqueKeys = new Set<string>();
  const originalByKey = new Map<string, string>();
  for (const raw of params.agentIds) {
    const key = normalizeSeatAgentId(raw);
    if (!key || uniqueKeys.has(key)) {
      continue;
    }
    uniqueKeys.add(key);
    originalByKey.set(key, raw.trim());
  }

  const usageByAgent = new Map<string, Omit<AgentUsageTotals, "agentId">>();
  const discoverableAgentIds = new Set<string>();

  await Promise.all(
    [...uniqueKeys].map(async (agentKey) => {
      discoverableAgentIds.add(agentKey);
      const sessionsDirs = params.resolveSessionsDirs
        ? [...(await params.resolveSessionsDirs(agentKey))]
        : [undefined];
      let totalTokens = 0;
      let totalCost = 0;
      let sessionCount = 0;
      let lastActiveAt: number | null = null;
      const seenSessionFiles = new Set<string>();

      for (const sessionsDir of sessionsDirs) {
        const sessions = sessionsDir
          ? await discoverSessionsInDir({
              sessionsDir,
              startMs: params.startMs,
              endMs: params.endMs,
            })
          : await discoverAllSessions({
              agentId: agentKey,
              startMs: params.startMs,
              endMs: params.endMs,
            });
        for (const session of sessions) {
          if (seenSessionFiles.has(session.sessionFile)) {
            continue;
          }
          seenSessionFiles.add(session.sessionFile);
          const usage = await loadSessionCostSummary({
            sessionId: session.sessionId,
            sessionFile: session.sessionFile,
            config,
            agentId: agentKey,
            startMs: params.startMs,
            endMs: params.endMs,
          });
          if (!usage) {
            continue;
          }
          sessionCount += 1;
          totalTokens += usage.totalTokens;
          totalCost += usage.totalCost;
          const activity = usage.lastActivity ?? session.mtime;
          if (activity != null) {
            lastActiveAt = Math.max(lastActiveAt ?? 0, activity);
          }
        }
      }

      usageByAgent.set(agentKey, {
        totalTokens,
        totalCost,
        sessionCount,
        lastActiveAt,
      });
    }),
  );

  const agents: AgentUsageTotals[] = [...usageByAgent.entries()].map(([agentKey, slice]) => ({
    agentId: originalByKey.get(agentKey) ?? agentKey,
    ...slice,
  }));

  return { usageByAgent, discoverableAgentIds, agents };
}

export function assembleMonthlySeatUsageResult(params: {
  tenantId: string;
  startDate: string;
  endDate: string;
  seats: readonly SeatUsageBinding[];
  usageByAgent: ReadonlyMap<string, Omit<AgentUsageTotals, "agentId">>;
  discoverableAgentIds: ReadonlySet<string>;
  agents: AgentUsageTotals[];
}): MonthlySeatUsageResult {
  const built = buildSeatMonthlyUsageRows({
    seats: params.seats,
    usageByAgent: params.usageByAgent,
    discoverableAgentIds: params.discoverableAgentIds,
  });
  return {
    tenantId: params.tenantId,
    startDate: params.startDate,
    endDate: params.endDate,
    agents: params.agents,
    users: buildUserMonthlyUsageRows({ seats: params.seats, seatRows: built.seats }),
    seats: built.seats,
    unmatchedAgentIds: built.unmatchedAgentIds,
  };
}
