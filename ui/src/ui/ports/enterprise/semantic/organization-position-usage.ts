/**
 * 组织岗位本月用量聚合（纯函数）。
 *
 * 规则：
 * - 聚合范围 = unique(agentIds ∪ defaultAgentId)
 * - 同一 agent ID 只计一次
 * - defaultAgentId 不在 agentIds 中时仍纳入
 * - 未加载 / 失败不得伪装成真实 0
 */

export type OrganizationAgentUsageSlice = {
  totalTokens: number;
  totalCost: number;
  sessionCount: number;
  lastActiveAt: number | null;
  status?: "online" | "offline" | "unknown";
  runtimeHost?: string | null;
  groupCount?: number;
};

export type OrganizationMonthlyUsageLoadState =
  | { status: "unloaded" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      startDate: string;
      endDate: string;
      tenantId: string;
      usageByAgent: ReadonlyMap<string, OrganizationAgentUsageSlice>;
      /** 按员工账号（userId，规范化）汇总；档案 Token/成本/会话优先取此切片。 */
      usageByUser?: ReadonlyMap<string, OrganizationAgentUsageSlice>;
      /** 后端按 seatId 预聚合的结果（优先使用，避免共享 steward 串计）。 */
      usageBySeat?: ReadonlyMap<
        string,
        {
          totalTokens: number;
          totalCost: number;
          sessionCount: number;
          lastActiveAt: number | null;
          unmatchedAgentIds: readonly string[];
        }
      >;
      /** 岗位绑定但无法与用量/已知 agent 对齐的 ID（已规范化，不含敏感细节）。 */
      unmatchedAgentIds: readonly string[];
    };

export type OrganizationPositionUsageAggregate = {
  totalTokens: number | null;
  totalCost: number | null;
  sessionCount: number | null;
  lastActiveAt: number | null;
  runtimeStatus: "online" | "offline" | "unknown" | null;
  runtimeHost: string | null;
  groupCount: number;
  unmatchedAgentIds: string[];
  display: "loading" | "unloaded" | "error" | "ready" | "unmatched";
  errorMessage: string | null;
};

/** 规范化岗位 agent ID：trim + lower-case；空值丢弃。 */
export function normalizeOrganizationAgentId(value: string | null | undefined): string | null {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) {
    return null;
  }
  return trimmed.toLowerCase();
}

/** 规范化员工账号：trim + lower-case；空值丢弃。 */
export function normalizeOrganizationUserId(value: string | null | undefined): string | null {
  return normalizeOrganizationAgentId(value);
}

/**
 * 解析岗位当前绑定员工的月度用量。
 * 无成员时返回 null 指标（禁止伪装成 0）；加载态透传 display。
 */
export function resolveEmployeeUsageForSeat(params: {
  memberUserId: string | null | undefined;
  loadState: OrganizationMonthlyUsageLoadState;
}): OrganizationPositionUsageAggregate {
  const { loadState } = params;
  if (loadState.status === "unloaded") {
    return emptyAggregate("unloaded");
  }
  if (loadState.status === "loading") {
    return emptyAggregate("loading");
  }
  if (loadState.status === "error") {
    return {
      ...emptyAggregate("error"),
      errorMessage: loadState.message,
    };
  }

  const userKey = normalizeOrganizationUserId(params.memberUserId);
  if (!userKey) {
    return emptyAggregate("ready");
  }

  const slice =
    loadState.usageByUser?.get(userKey) ??
    (params.memberUserId?.trim()
      ? loadState.usageByUser?.get(params.memberUserId.trim())
      : undefined);
  if (!slice) {
    return {
      totalTokens: 0,
      totalCost: 0,
      sessionCount: 0,
      lastActiveAt: null,
      runtimeStatus: null,
      runtimeHost: null,
      groupCount: 0,
      unmatchedAgentIds: [],
      display: "ready",
      errorMessage: null,
    };
  }

  return {
    totalTokens: slice.totalTokens,
    totalCost: slice.totalCost,
    sessionCount: slice.sessionCount,
    lastActiveAt: slice.lastActiveAt,
    runtimeStatus: slice.status ?? null,
    runtimeHost: slice.runtimeHost ?? null,
    groupCount: slice.groupCount ?? 0,
    unmatchedAgentIds: [],
    display: "ready",
    errorMessage: null,
  };
}

function hasUsageActivity(
  slice: Pick<OrganizationPositionUsageAggregate, "totalTokens" | "totalCost" | "sessionCount">,
): boolean {
  return (
    (slice.totalTokens ?? 0) > 0 || (slice.totalCost ?? 0) > 0 || (slice.sessionCount ?? 0) > 0
  );
}

/**
 * 岗位「本月消耗」合并规则：
 * - 优先座位 AI 资产聚合（usageBySeat / agents），避免 users[] 缺失时整表被盖成 $0
 * - 仅当座位无用量且员工切片有用量时，回退员工账号归因
 * - 未绑定成员时不把空座位伪装成真实 0（指标保持 null）
 */
export function mergePositionMonthlyUsage(params: {
  employeeAttributionUserId: string | null | undefined;
  seatUsage: OrganizationPositionUsageAggregate;
  employeeUsage: OrganizationPositionUsageAggregate;
}): OrganizationPositionUsageAggregate {
  const { seatUsage, employeeUsage } = params;
  const bound = Boolean(params.employeeAttributionUserId?.trim());

  if (
    seatUsage.display === "loading" ||
    seatUsage.display === "unloaded" ||
    seatUsage.display === "error"
  ) {
    return seatUsage;
  }
  if (
    bound &&
    (employeeUsage.display === "loading" ||
      employeeUsage.display === "unloaded" ||
      employeeUsage.display === "error")
  ) {
    return {
      ...employeeUsage,
      errorMessage: employeeUsage.errorMessage ?? seatUsage.errorMessage,
    };
  }

  if (hasUsageActivity(seatUsage) || seatUsage.display === "unmatched") {
    return seatUsage;
  }
  if (bound && hasUsageActivity(employeeUsage)) {
    return employeeUsage;
  }
  if (!bound) {
    return {
      ...seatUsage,
      totalTokens: null,
      totalCost: null,
      sessionCount: null,
      lastActiveAt: null,
    };
  }
  // Bound seat with real zero activity (agents present / ready).
  return seatUsage;
}

/**
 * 收集岗位唯一 agent ID（保留首次出现的原始大小写，按规范化去重）。
 * 顺序：agentIds 先，再补 defaultAgentId。
 */
export function collectUniqueSeatAgentIds(seat: {
  agentIds?: readonly string[] | null;
  defaultAgentId?: string | null;
}): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (raw: string | null | undefined) => {
    const original = typeof raw === "string" ? raw.trim() : "";
    const key = normalizeOrganizationAgentId(original);
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

/** 企业本地时区下的自然月窗口：当月 1 日 → 当天（YYYY-MM-DD）。 */
export function resolveOrganizationMonthWindow(now: Date = new Date()): {
  startDate: string;
  endDate: string;
} {
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const mm = String(month).padStart(2, "0");
  const startDate = `${year}-${mm}-01`;
  const endDate = `${year}-${mm}-${String(day).padStart(2, "0")}`;
  return { startDate, endDate };
}

export function lookupAgentUsageSlice(
  usageByAgent: ReadonlyMap<string, OrganizationAgentUsageSlice>,
  agentId: string,
): OrganizationAgentUsageSlice | null {
  const key = normalizeOrganizationAgentId(agentId);
  if (!key) {
    return null;
  }
  return usageByAgent.get(key) ?? usageByAgent.get(agentId) ?? null;
}

/**
 * 将多个 agent 用量聚合成岗位级指标。
 * knownAgentIds：当前租户已知的 agent 目录（用于区分「无会话」与「无法归因」）。
 */
export function aggregateSeatAgentUsage(params: {
  seat: {
    seatId?: string | null;
    agentIds?: readonly string[] | null;
    defaultAgentId?: string | null;
  };
  loadState: OrganizationMonthlyUsageLoadState;
  knownAgentIds?: ReadonlySet<string>;
}): OrganizationPositionUsageAggregate {
  const { loadState } = params;
  if (loadState.status === "unloaded") {
    return emptyAggregate("unloaded");
  }
  if (loadState.status === "loading") {
    return emptyAggregate("loading");
  }
  if (loadState.status === "error") {
    return {
      ...emptyAggregate("error"),
      errorMessage: loadState.message,
    };
  }

  const seatId = params.seat.seatId?.trim() || null;
  const seatRow = seatId ? loadState.usageBySeat?.get(seatId) : undefined;
  if (seatRow) {
    const unmatchedAgentIds = [...seatRow.unmatchedAgentIds];
    if (unmatchedAgentIds.length > 0 && seatRow.sessionCount === 0 && seatRow.totalTokens === 0) {
      return {
        totalTokens: null,
        totalCost: null,
        sessionCount: null,
        lastActiveAt: null,
        runtimeStatus: null,
        runtimeHost: null,
        groupCount: 0,
        unmatchedAgentIds,
        display: "unmatched",
        errorMessage: null,
      };
    }
    return {
      totalTokens: seatRow.totalTokens,
      totalCost: seatRow.totalCost,
      sessionCount: seatRow.sessionCount,
      lastActiveAt: seatRow.lastActiveAt,
      runtimeStatus: null,
      runtimeHost: null,
      groupCount: 0,
      unmatchedAgentIds,
      display: unmatchedAgentIds.length > 0 ? "unmatched" : "ready",
      errorMessage: null,
    };
  }

  const agentIds = collectUniqueSeatAgentIds(params.seat);
  const known = params.knownAgentIds;
  const unmatchedAgentIds: string[] = [];
  let totalTokens = 0;
  let totalCost = 0;
  let sessionCount = 0;
  let lastActiveAt: number | null = null;
  let runtimeStatus: "online" | "offline" | "unknown" | null = null;
  let runtimeHost: string | null = null;
  let groupCount = 0;
  let matchedAny = false;

  for (const agentId of agentIds) {
    const slice = lookupAgentUsageSlice(loadState.usageByAgent, agentId);
    const normalized = normalizeOrganizationAgentId(agentId);
    const knownHit =
      normalized != null &&
      (known?.has(normalized) || known?.has(agentId) || loadState.usageByAgent.has(normalized));

    if (!slice) {
      // 目录中不存在且无用量条目 → 无法归因；有目录无用量 → 真实 0。
      if (known && normalized && !known.has(normalized) && !known.has(agentId)) {
        unmatchedAgentIds.push(agentId);
      } else if (!known && !knownHit) {
        // 无目录时：若全局 unmatched 列表含该 ID，记诊断。
        if (
          loadState.unmatchedAgentIds.some((id) => normalizeOrganizationAgentId(id) === normalized)
        ) {
          unmatchedAgentIds.push(agentId);
        }
      }
      continue;
    }

    matchedAny = true;
    totalTokens += slice.totalTokens;
    totalCost += slice.totalCost;
    sessionCount += slice.sessionCount;
    if (slice.lastActiveAt != null) {
      lastActiveAt = Math.max(lastActiveAt ?? 0, slice.lastActiveAt);
    }
    if (slice.groupCount != null) {
      groupCount += slice.groupCount;
    }
    if (slice.runtimeHost) {
      runtimeHost = runtimeHost ?? slice.runtimeHost;
    }
    if (slice.status === "online") {
      runtimeStatus = "online";
    } else if (slice.status === "offline" && runtimeStatus !== "online") {
      runtimeStatus = "offline";
    } else if (runtimeStatus == null) {
      runtimeStatus = slice.status ?? "unknown";
    }
  }

  // 岗位配置了机器人，但全部无法对齐到已知目录/用量键。
  if (agentIds.length > 0 && !matchedAny && unmatchedAgentIds.length === agentIds.length) {
    return {
      totalTokens: null,
      totalCost: null,
      sessionCount: null,
      lastActiveAt: null,
      runtimeStatus: null,
      runtimeHost: null,
      groupCount: 0,
      unmatchedAgentIds,
      display: "unmatched",
      errorMessage: null,
    };
  }

  return {
    totalTokens,
    totalCost,
    sessionCount,
    lastActiveAt,
    // 无运行态时保持 null，让 surface 回退 mesh / defaultAgent，避免 "unknown" 阻断回退。
    runtimeStatus,
    runtimeHost,
    groupCount,
    unmatchedAgentIds,
    display: unmatchedAgentIds.length > 0 ? "unmatched" : "ready",
    errorMessage: null,
  };
}

function emptyAggregate(
  display: OrganizationPositionUsageAggregate["display"],
): OrganizationPositionUsageAggregate {
  return {
    totalTokens: null,
    totalCost: null,
    sessionCount: null,
    lastActiveAt: null,
    runtimeStatus: null,
    runtimeHost: null,
    groupCount: 0,
    unmatchedAgentIds: [],
    display,
    errorMessage: null,
  };
}

/** 将 RPC / 序列化结果转成 Map（key 一律规范化）。 */
export function indexOrganizationAgentUsage(
  entries: ReadonlyArray<{ agentId: string } & OrganizationAgentUsageSlice>,
): Map<string, OrganizationAgentUsageSlice> {
  const map = new Map<string, OrganizationAgentUsageSlice>();
  for (const entry of entries) {
    const key = normalizeOrganizationAgentId(entry.agentId);
    if (!key) {
      continue;
    }
    mergeUsageSliceIntoMap(map, key, entry);
  }
  return map;
}

/** 将按员工账号汇总的 RPC 结果转成 Map（key 一律规范化）。 */
export function indexOrganizationUserUsage(
  entries: ReadonlyArray<{ userId: string } & OrganizationAgentUsageSlice>,
): Map<string, OrganizationAgentUsageSlice> {
  const map = new Map<string, OrganizationAgentUsageSlice>();
  for (const entry of entries) {
    const key = normalizeOrganizationUserId(entry.userId);
    if (!key) {
      continue;
    }
    mergeUsageSliceIntoMap(map, key, entry);
  }
  return map;
}

function mergeUsageSliceIntoMap(
  map: Map<string, OrganizationAgentUsageSlice>,
  key: string,
  entry: OrganizationAgentUsageSlice,
): void {
  const existing = map.get(key);
  if (!existing) {
    map.set(key, {
      totalTokens: entry.totalTokens,
      totalCost: entry.totalCost,
      sessionCount: entry.sessionCount,
      lastActiveAt: entry.lastActiveAt,
      status: entry.status,
      runtimeHost: entry.runtimeHost ?? null,
      groupCount: entry.groupCount ?? 0,
    });
    return;
  }
  existing.totalTokens += entry.totalTokens;
  existing.totalCost += entry.totalCost;
  existing.sessionCount += entry.sessionCount;
  if (entry.lastActiveAt != null) {
    existing.lastActiveAt = Math.max(existing.lastActiveAt ?? 0, entry.lastActiveAt);
  }
  if (entry.groupCount != null) {
    existing.groupCount = (existing.groupCount ?? 0) + entry.groupCount;
  }
  if (entry.status === "online") {
    existing.status = "online";
  }
  if (entry.runtimeHost) {
    existing.runtimeHost = existing.runtimeHost ?? entry.runtimeHost;
  }
}
