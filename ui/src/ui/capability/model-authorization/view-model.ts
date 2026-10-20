/**
 * 模型授权视图模型（纯函数）。
 *
 * 设计：`.kiro/specs/model-entitlement-chain/design.md`（§8.2 三端拆分）。
 *
 * 把网关 RPC 响应投影成企业端授权操作面（任务 11）与员工端只读视图（任务 12）
 * 所需的展示模型。纯函数、确定性、无 IO / 无 lit，便于属性/单元测试覆盖。
 *
 * 两态纪律（贯穿全链）：
 * - `state="missing"`：未配置/未迁移 → 文案提示「未配置」，不等同于「无可用模型」。
 * - `state="resolved"` 且集合为空 → 文案提示「已解析为空（被拒）」。
 */

import type {
  EmployeeModelEntitlementSummary,
  EnterpriseModelEntitlement,
  ModelRef,
  SeatModelGrant,
} from "./types.ts";

/** 单个模型在某主体授权面上的勾选行。 */
export type ModelGrantRow = {
  modelId: ModelRef;
  /** 该模型是否在企业 entitlement 内（不在则不可授权）。 */
  withinEntitlement: boolean;
  /** 该模型当前是否已授予该主体。 */
  granted: boolean;
};

/** 企业端某主体（seat/employee）的授权编辑视图。 */
export type EnterpriseGrantSubjectView = {
  subjectType: SeatModelGrant["subjectType"];
  subjectId: string;
  seatId?: string;
  employeeId?: string;
  status: SeatModelGrant["status"];
  rows: ModelGrantRow[];
  updatedAt?: string;
};

/** 企业端「模型授权」操作面整体视图模型。 */
export type EnterpriseAuthorizationView = {
  /** 企业 entitlement 是否已下发（无 → 需平台先绑定套餐）。 */
  hasEntitlement: boolean;
  /** 企业可授权的模型上限集合（来自 entitlement）。 */
  entitlementModelIds: ModelRef[];
  /** 提示文案（无 entitlement 时引导联系平台）。 */
  notice: string | null;
  /** 已存在的各主体授权（含每模型勾选态）。 */
  subjects: EnterpriseGrantSubjectView[];
};

function dedupeSorted(values: readonly ModelRef[]): ModelRef[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))].toSorted();
}

/**
 * 构建企业端授权操作面视图模型。
 *
 * @param entitlement 企业 entitlement（null = 未下发）。
 * @param allowedModelIds 企业可授权上限（通常 = entitlement.allowedModelIds）。
 * @param grants 当前企业下所有 seat/employee 授权记录。
 */
export function buildEnterpriseAuthorizationView(input: {
  entitlement: EnterpriseModelEntitlement | null;
  allowedModelIds: readonly ModelRef[];
  grants: readonly SeatModelGrant[];
  /** 套餐内但未连通的平台模型。不渲染，也不记为越界。 */
  hiddenModelIds?: readonly ModelRef[];
}): EnterpriseAuthorizationView {
  const hidden = new Set(
    (input.hiddenModelIds ?? []).map((id) => id.trim()).filter((id) => id.length > 0),
  );
  const entitlementModelIds = dedupeSorted(
    input.allowedModelIds.length > 0
      ? input.allowedModelIds
      : (input.entitlement?.allowedModelIds ?? []),
  ).filter((id) => !hidden.has(id));
  const hasEntitlement = input.entitlement !== null;
  const allowedSet = new Set(entitlementModelIds);

  const subjects: EnterpriseGrantSubjectView[] = input.grants.map((grant) => {
    const grantedSet = new Set(grant.grantedModelIds);
    // 行集合 = entitlement 模型 ∪ 已授予模型（已授予但越界者也要可见以便撤销）。
    const modelIds = dedupeSorted([...entitlementModelIds, ...grant.grantedModelIds]).filter(
      (id) => !hidden.has(id),
    );
    const rows: ModelGrantRow[] = modelIds.map((modelId) => ({
      modelId,
      withinEntitlement: allowedSet.has(modelId),
      granted: grantedSet.has(modelId),
    }));
    return {
      subjectType: grant.subjectType,
      subjectId: grant.subjectId,
      ...(grant.seatId ? { seatId: grant.seatId } : {}),
      ...(grant.employeeId ? { employeeId: grant.employeeId } : {}),
      status: grant.status,
      rows,
      ...(grant.updatedAt ? { updatedAt: grant.updatedAt } : {}),
    };
  });

  return {
    hasEntitlement,
    entitlementModelIds,
    notice: hasEntitlement
      ? null
      : "本企业尚无模型 entitlement 记录。请联系平台为当前套餐下发模型绑定后再授权。",
    subjects,
  };
}

/** 员工端只读「可用模型 + 拒绝原因」展示模型。 */
export type EmployeeModelView = {
  /** 是否有可用模型。 */
  hasModels: boolean;
  /** 可用模型列表（已去重排序）。 */
  modelIds: ModelRef[];
  /** 顶部状态文案。 */
  statusLabel: string;
  /** 详细说明（被拒原因 / 未配置提示）。 */
  detail: string;
  seatId?: string;
};

/** 单个模型的实际消费量（来自 gateway `sessions.usage` 的 `aggregates.byModel`）。 */
export type ModelUsageInputRow = {
  provider?: string;
  model?: string;
  /** 调用次数。 */
  count: number;
  totals: {
    input: number;
    output: number;
    totalTokens: number;
    totalCost: number;
  };
};

/** 员工端「各模型消费量」展示行（已合并、按用量排序、含可视化占比）。 */
export type EmployeeModelUsageRow = {
  /** 展示标签：provider/model | model | provider。 */
  label: string;
  provider?: string;
  /** 该模型是否在员工可用（entitlement）集合内。 */
  entitled: boolean;
  /** 是否有实际消费（tokens>0 或有调用次数）。 */
  used: boolean;
  totalTokens: number;
  totalCost: number;
  requests: number;
  /** 0..1，相对本期最大用量模型的占比，用于条形宽度。 */
  share: number;
};

/** 员工端模型用量的可验证状态。 */
export type EmployeeModelUsageStatus = "ready" | "unavailable";

/** 员工端「可用模型 + 各模型消费量」聚合视图。 */
export type EmployeeModelUsageView = {
  /** 仅 ready 数据可作为真实 totals 展示。 */
  status: EmployeeModelUsageStatus;
  /** unavailable 时面向用户的可重试说明。 */
  unavailableReason?: string;
  /**
   * 员工可见范围内部分会话未能完整计入（`aggregatesComplete=false`），
   * 但已返回的 byModel/totals 自洽时可展示。
   */
  partial?: boolean;
  /** 是否有任何实际消费记录。 */
  hasUsage: boolean;
  /** 展示区间（天）。 */
  windowDays: number;
  totalTokens: number;
  totalCost: number;
  totalRequests: number;
  /** 已用模型数量。 */
  usedModelCount: number;
  rows: EmployeeModelUsageRow[];
};

function isInternalInjectedUsageModel(label: string, model?: string): boolean {
  const id = (model ?? label).trim().toLowerCase();
  const leaf = id.split("/").pop() ?? id;
  return leaf === "gateway-injected";
}

function usageRowLabel(row: ModelUsageInputRow): string {
  const model = row.model?.trim();
  const provider = row.provider?.trim();
  if (model) {
    return provider ? `${provider}/${model}` : model;
  }
  return provider || "未知模型";
}

/**
 * Provider-qualified entitlement ids only match the exact canonical
 * `provider/model` row. A bare model id intentionally remains provider-agnostic.
 */
function rowMatchesEntitlementId(label: string, provider: string | undefined, id: string): boolean {
  const entitlementId = id.trim();
  const rowLabel = label.trim();
  if (!entitlementId || !rowLabel) {
    return false;
  }
  if (entitlementId.includes("/")) {
    return rowLabel === entitlementId;
  }
  const normalizedProvider = provider?.trim();
  const model =
    normalizedProvider && rowLabel.startsWith(`${normalizedProvider}/`)
      ? rowLabel.slice(normalizedProvider.length + 1)
      : (rowLabel.split("/").pop() ?? rowLabel);
  return model === entitlementId;
}

/** 判断某消费模型是否落在员工 entitlement 集合内。 */
function isEntitled(row: ModelUsageInputRow, entitlementIds: ReadonlySet<string>): boolean {
  const label = usageRowLabel(row);
  const provider = row.provider?.trim();
  for (const id of entitlementIds) {
    if (rowMatchesEntitlementId(label, provider, id)) {
      return true;
    }
  }
  return false;
}

/**
 * 构建员工端「可用模型 + 各模型消费量」视图（纯函数）。
 *
 * 合并规则：
 * - 以 `byModel` 为消费真源，按标签合并重复项（累加 tokens/cost/次数）。
 * - entitlement 中未被消费到的可用模型，补零行（used=false）以完整展现「可用模型」。
 * - `share` = 该模型 totalTokens / 本期最大模型 totalTokens，用于条形可视化。
 * - 排序：先按 tokens 降序，其次可用模型优先，最后按标签本地化排序。
 */
export function buildEmployeeModelUsageView(input: {
  entitlementModelIds: readonly ModelRef[];
  byModel: readonly ModelUsageInputRow[];
  windowDays: number;
  status?: EmployeeModelUsageStatus;
  unavailableReason?: string;
  partial?: boolean;
}): EmployeeModelUsageView {
  const status = input.status ?? "ready";
  const entitlementIds = new Set(
    input.entitlementModelIds.map((id) => id.trim()).filter((id) => id.length > 0),
  );

  // Unavailable data must never flow into totals, even if a caller accidentally
  // supplies stale rows alongside the status.
  const usageRows = status === "ready" ? input.byModel : [];

  // 合并消费行（同一 label 累加）。
  const byLabel = new Map<string, EmployeeModelUsageRow>();
  for (const row of usageRows) {
    const label = usageRowLabel(row);
    if (isInternalInjectedUsageModel(label, row.model)) {
      continue;
    }
    const tokens = Math.max(0, Math.round(row.totals.totalTokens));
    const cost = Math.max(0, row.totals.totalCost);
    const requests = Math.max(0, Math.round(row.count));
    const existing = byLabel.get(label);
    if (existing) {
      existing.totalTokens += tokens;
      existing.totalCost += cost;
      existing.requests += requests;
      existing.used = existing.used || tokens > 0 || requests > 0;
    } else {
      byLabel.set(label, {
        label,
        ...(row.provider?.trim() ? { provider: row.provider.trim() } : {}),
        entitled: isEntitled(row, entitlementIds),
        used: tokens > 0 || requests > 0,
        totalTokens: tokens,
        totalCost: cost,
        requests,
        share: 0,
      });
    }
  }

  // 补齐 entitlement 中未消费到的可用模型（补零行），已被消费行覆盖的不再重复。
  for (const id of entitlementIds) {
    const alreadyShown = [...byLabel.values()].some((r) =>
      rowMatchesEntitlementId(r.label, r.provider, id),
    );
    if (!alreadyShown) {
      byLabel.set(id, {
        label: id,
        entitled: true,
        used: false,
        totalTokens: 0,
        totalCost: 0,
        requests: 0,
        share: 0,
      });
    }
  }

  const rows = [...byLabel.values()].filter((row) => row.entitled || row.used);
  const maxTokens = rows.reduce((max, r) => Math.max(max, r.totalTokens), 0);
  for (const r of rows) {
    r.share = maxTokens > 0 ? r.totalTokens / maxTokens : 0;
  }
  rows.sort((a, b) => {
    if (b.totalTokens !== a.totalTokens) {
      return b.totalTokens - a.totalTokens;
    }
    if (a.entitled !== b.entitled) {
      return a.entitled ? -1 : 1;
    }
    return a.label.localeCompare(b.label, "zh-CN");
  });

  const totalTokens = rows.reduce((sum, r) => sum + r.totalTokens, 0);
  const totalCost = rows.reduce((sum, r) => sum + r.totalCost, 0);
  const totalRequests = rows.reduce((sum, r) => sum + r.requests, 0);
  const usedModelCount = rows.filter((r) => r.used).length;

  return {
    status,
    ...(status === "unavailable" && input.unavailableReason
      ? { unavailableReason: input.unavailableReason }
      : {}),
    ...(status === "ready" && input.partial ? { partial: true } : {}),
    hasUsage: status === "ready" && usedModelCount > 0,
    windowDays: input.windowDays,
    totalTokens,
    totalCost,
    totalRequests,
    usedModelCount,
    rows,
  };
}

/**
 * 构建员工端只读视图模型。员工端**不**暴露平台模型管理复杂度，
 * 仅展示「当前 seat / 可用模型 / 被拒原因」。
 */
export function buildEmployeeModelView(
  summary: EmployeeModelEntitlementSummary,
): EmployeeModelView {
  const modelIds = dedupeSorted(summary.modelIds);
  const hasModels = modelIds.length > 0;
  let statusLabel: string;
  if (summary.state === "missing") {
    statusLabel = "未配置授权";
  } else if (hasModels) {
    statusLabel = "可用";
  } else {
    statusLabel = "已被拒绝";
  }
  return {
    hasModels,
    modelIds,
    statusLabel,
    detail: summary.reason,
    ...(summary.seatId ? { seatId: summary.seatId } : {}),
  };
}
