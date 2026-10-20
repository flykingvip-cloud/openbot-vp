/**
 * Runtime Governance Issue Detector — 仅覆盖运行时治理问题的纯函数检测器集合。
 *
 * 设计准则：
 * - **去业务化**：本模块只输出 7 类运行时治理问题（zombie-binding、
 *   resource-overcommit、capability-conflict、sandbox-violation、
 *   version-drift、fallback-chain-broken、orphaned-agent），**不**承载企业端
 *   业务治理（如复用价值低、贡献不活跃等）。
 * - **纯函数**：所有检测器只读入参，不修改、不依赖外部状态、不发起 I/O；
 *   相同 `(agents, bindings, config, now)` 永远生成 deep-equal 的 Issue 集合
 *   （由 Property 7 验证）。
 * - **稳定 ID**：每条 Issue 的 `id` 由 `(category, subjectId)` 派生，使得同一
 *   问题在多次检测周期中保持稳定，便于 Acknowledge 持久化与 UI 去抖。
 * - **结构化证据**：`evidence` 仅承载计数 / 时间戳 / 阈值等结构化证据，
 *   严禁承载错误堆栈、日志原文等可能含 PII 的字段。
 *
 * 调用入口：{@link detectGovernanceIssues}。各类别独立函数也对外导出，方便单测。
 */

import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeGovernanceIssue,
  RuntimeGovernanceIssueCategory,
  RuntimeGovernanceIssueSeverity,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 配置
// ─────────────────────────────────────────────────────────────────────────

/**
 * 治理检测阈值。
 *
 * 字段语义：
 * - `zombieBindingDays`        Binding 处于 active 但 7 日调用 = 0 且自身距今超过此天数 → 视为僵尸
 * - `orphanedAgentDays`        Agent 无任何 binding 且距今最近活跃超过此天数 → 视为孤立
 * - `resourceOvercommitThreshold` Agent 资源使用率（cpu/memory 任一）≥ 此值（[0,1]）→ 视为超配
 */
export type GovernanceDetectorConfig = {
  zombieBindingDays: number;
  orphanedAgentDays: number;
  resourceOvercommitThreshold: number;
};

export const DEFAULT_GOVERNANCE_CONFIG: GovernanceDetectorConfig = {
  zombieBindingDays: 30,
  orphanedAgentDays: 30,
  resourceOvercommitThreshold: 0.9,
};

// ─────────────────────────────────────────────────────────────────────────
// 内部辅助
// ─────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

/** 构造稳定 ID：同一 `(category, subjectId)` 永远产生相同字符串。 */
function makeIssueId(category: RuntimeGovernanceIssueCategory, subjectId: string): string {
  return `${category}::${subjectId}`;
}

/** 通用 Issue 工厂：保证字段顺序与默认值一致，便于 deep-equal 比较。 */
function makeIssue(params: {
  category: RuntimeGovernanceIssueCategory;
  severity: RuntimeGovernanceIssueSeverity;
  subjectId: string;
  runtimeAgentId: string | null;
  bindingId: string | null;
  description: string;
  impact: string;
  evidence: Record<string, unknown>;
  suggestedAction: string;
  detectedAt: number;
}): RuntimeGovernanceIssue {
  return {
    id: makeIssueId(params.category, params.subjectId),
    category: params.category,
    severity: params.severity,
    runtimeAgentId: params.runtimeAgentId,
    bindingId: params.bindingId,
    description: params.description,
    impact: params.impact,
    evidence: params.evidence,
    suggestedAction: params.suggestedAction,
    detectedAt: params.detectedAt,
    acknowledgedBy: null,
    acknowledgedAt: null,
  };
}

/** 按 (category, subjectId) 升序稳定排序，保证检测器输出的确定性。 */
function sortIssues(issues: readonly RuntimeGovernanceIssue[]): RuntimeGovernanceIssue[] {
  return [...issues].toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ─────────────────────────────────────────────────────────────────────────
// 单类别检测器（对外导出，便于单元测试）
// ─────────────────────────────────────────────────────────────────────────

/**
 * Zombie Binding：BindingState=`active` 且 7 日调用次数为 0，且自创建/更新以来
 * 已超过阈值天数。
 *
 * 排除条件：
 * - 非 active 状态（warming/degraded/disabled）不视为僵尸（已被状态机管控）
 * - `now - updatedAt < zombieBindingDays` 的新 binding 暂不告警，避免误报新部署
 */
export function detectZombieBindings(
  bindings: readonly RuntimeCapabilityBinding[],
  thresholdDays: number,
  now: number,
): RuntimeGovernanceIssue[] {
  const result: RuntimeGovernanceIssue[] = [];
  const cutoffMs = thresholdDays * MS_PER_DAY;
  for (const b of bindings) {
    if (b.bindingState !== "active") {
      continue;
    }
    if (b.invocationMetrics.calls7d > 0) {
      continue;
    }
    if (now - b.updatedAt < cutoffMs) {
      continue;
    }
    result.push(
      makeIssue({
        category: "zombie-binding",
        severity: "low",
        subjectId: b.bindingId,
        runtimeAgentId: b.runtimeAgentId,
        bindingId: b.bindingId,
        description: `绑定 ${b.bindingId} 已超过 ${thresholdDays} 天无调用`,
        impact: "占用 Agent 装载位但无业务价值",
        evidence: {
          calls7d: 0,
          inactiveDays: Math.floor((now - b.updatedAt) / MS_PER_DAY),
          thresholdDays,
        },
        suggestedAction: "确认是否仍需要该绑定，必要时禁用或卸载",
        detectedAt: now,
      }),
    );
  }
  return result;
}

/**
 * Orphaned Agent：Agent 不绑定任何能力，且距今最近活跃已超过阈值天数。
 *
 * 排除条件：
 * - Agent 已 archived（终态本就无意义，由生命周期管控，不重复告警）
 */
export function detectOrphanedAgents(
  agents: readonly RuntimeAgent[],
  bindings: readonly RuntimeCapabilityBinding[],
  thresholdDays: number,
  now: number,
): RuntimeGovernanceIssue[] {
  const cutoffMs = thresholdDays * MS_PER_DAY;
  const agentsWithBinding = new Set<string>();
  for (const b of bindings) {
    agentsWithBinding.add(b.runtimeAgentId);
  }

  const result: RuntimeGovernanceIssue[] = [];
  for (const a of agents) {
    if (a.lifecycle === "archived") {
      continue;
    }
    if (agentsWithBinding.has(a.runtimeAgentId)) {
      continue;
    }
    if (now - a.lastActiveAt < cutoffMs) {
      continue;
    }
    result.push(
      makeIssue({
        category: "orphaned-agent",
        severity: "low",
        subjectId: a.runtimeAgentId,
        runtimeAgentId: a.runtimeAgentId,
        bindingId: null,
        description: `Agent ${a.name} 无任何能力绑定且长期不活跃`,
        impact: "Agent 实例资源未释放，可能浪费配额",
        evidence: {
          inactiveDays: Math.floor((now - a.lastActiveAt) / MS_PER_DAY),
          boundCapabilityCount: a.boundCapabilityCount,
          thresholdDays,
        },
        suggestedAction: "如不再使用，建议进入 draining → suspended → archived 流程",
        detectedAt: now,
      }),
    );
  }
  return result;
}

/**
 * Version Drift：同一 Capability 在不同 Agent 上绑定了不一致的 capabilityVersion。
 *
 * 仅报告 active/warming/degraded 三种"实际在用"的状态；disabled 绑定不参与版本一致性判定。
 */
export function detectVersionDrift(
  bindings: readonly RuntimeCapabilityBinding[],
  now: number,
): RuntimeGovernanceIssue[] {
  const versionsByCapability = new Map<string, Set<string>>();
  for (const b of bindings) {
    if (b.bindingState === "disabled") {
      continue;
    }
    let set = versionsByCapability.get(b.capabilityId);
    if (!set) {
      set = new Set<string>();
      versionsByCapability.set(b.capabilityId, set);
    }
    set.add(b.capabilityVersion);
  }

  const result: RuntimeGovernanceIssue[] = [];
  for (const [capabilityId, versions] of versionsByCapability) {
    if (versions.size <= 1) {
      continue;
    }
    const sortedVersions = [...versions].toSorted();
    result.push(
      makeIssue({
        category: "version-drift",
        severity: "medium",
        subjectId: capabilityId,
        runtimeAgentId: null,
        bindingId: null,
        description: `Capability ${capabilityId} 在不同 Agent 上版本不一致`,
        impact: "可能导致同一能力在不同租户上行为不一致",
        evidence: { capabilityId, versions: sortedVersions, distinctVersionCount: versions.size },
        suggestedAction: "评估是否需要统一升级到最新版本，或审核版本切换计划",
        detectedAt: now,
      }),
    );
  }
  return result;
}

/**
 * Fallback Chain Broken：Binding 设置了 fallbackBindingId，但其指向的备选 binding
 * 自身已 disabled 或 unhealthy/unavailable。
 */
export function detectFallbackChainBroken(
  bindings: readonly RuntimeCapabilityBinding[],
  now: number,
): RuntimeGovernanceIssue[] {
  const byId = new Map<string, RuntimeCapabilityBinding>();
  for (const b of bindings) {
    byId.set(b.bindingId, b);
  }

  const result: RuntimeGovernanceIssue[] = [];
  for (const b of bindings) {
    if (b.fallbackBindingId === null) {
      continue;
    }
    const fallback = byId.get(b.fallbackBindingId);
    if (!fallback) {
      result.push(
        makeIssue({
          category: "fallback-chain-broken",
          severity: "high",
          subjectId: b.bindingId,
          runtimeAgentId: b.runtimeAgentId,
          bindingId: b.bindingId,
          description: `绑定 ${b.bindingId} 指向的降级备选不存在`,
          impact: "主绑定不可用时将失去降级保护",
          evidence: {
            fallbackBindingId: b.fallbackBindingId,
            reason: "missing",
          },
          suggestedAction: "更正 fallbackBindingId 或清空该字段",
          detectedAt: now,
        }),
      );
      continue;
    }
    const fallbackBroken =
      fallback.bindingState === "disabled" ||
      fallback.healthStatus === "unhealthy" ||
      fallback.healthStatus === "unavailable";
    if (fallbackBroken) {
      result.push(
        makeIssue({
          category: "fallback-chain-broken",
          severity: "high",
          subjectId: b.bindingId,
          runtimeAgentId: b.runtimeAgentId,
          bindingId: b.bindingId,
          description: `绑定 ${b.bindingId} 的降级备选当前不可用`,
          impact: "主绑定不可用时降级链失效",
          evidence: {
            fallbackBindingId: fallback.bindingId,
            fallbackState: fallback.bindingState,
            fallbackHealth: fallback.healthStatus,
          },
          suggestedAction: "修复备选绑定或更换 fallbackBindingId",
          detectedAt: now,
        }),
      );
    }
  }
  return result;
}

/**
 * Resource Overcommit：Agent 的 cpu/memory 任一占用百分比超过阈值。
 *
 * 仅报告 deployed 状态的 Agent，draining/suspended/deprecated/archived 不计入。
 */
export function detectResourceOvercommit(
  agents: readonly RuntimeAgent[],
  thresholdRatio: number,
  now: number,
): RuntimeGovernanceIssue[] {
  const thresholdPercent = thresholdRatio * 100;
  const result: RuntimeGovernanceIssue[] = [];
  for (const a of agents) {
    if (a.lifecycle !== "deployed") {
      continue;
    }
    const cpu = a.resourceUsage.cpuPercent;
    const mem = a.resourceUsage.memoryPercent;
    if (cpu >= thresholdPercent || mem >= thresholdPercent) {
      result.push(
        makeIssue({
          category: "resource-overcommit",
          severity: "high",
          subjectId: a.runtimeAgentId,
          runtimeAgentId: a.runtimeAgentId,
          bindingId: null,
          description: `Agent ${a.name} 资源使用率超过阈值`,
          impact: "可能影响请求处理能力或触发 OOM",
          evidence: {
            cpuPercent: cpu,
            memoryPercent: mem,
            thresholdPercent,
          },
          suggestedAction: "扩容 Agent 实例或迁移部分能力",
          detectedAt: now,
        }),
      );
    }
  }
  return result;
}

/**
 * Capability Conflict：同一 Agent 上存在多个绑定指向同一 capabilityId 但
 * capabilityVersion 不同（非降级关系）。这通常意味着配置冲突，路由器无法决定
 * 应该使用哪个版本。
 *
 * 排除：互为 fallback 的两条绑定不视为冲突（属于显式降级链）。
 */
export function detectCapabilityConflict(
  bindings: readonly RuntimeCapabilityBinding[],
  now: number,
): RuntimeGovernanceIssue[] {
  // 同 agent 同 capability 的绑定分组
  const groups = new Map<string, RuntimeCapabilityBinding[]>();
  for (const b of bindings) {
    if (b.bindingState === "disabled") {
      continue;
    }
    const key = `${b.runtimeAgentId}::${b.capabilityId}`;
    let arr = groups.get(key);
    if (!arr) {
      arr = [];
      groups.set(key, arr);
    }
    arr.push(b);
  }

  const result: RuntimeGovernanceIssue[] = [];
  for (const [key, group] of groups) {
    if (group.length <= 1) {
      continue;
    }

    // 排除显式降级关系：若两条互为 fallback，则不视为冲突
    if (group.length === 2) {
      const [a, b] = group;
      const isExplicitFallbackPair =
        a.fallbackBindingId === b.bindingId || b.fallbackBindingId === a.bindingId;
      if (isExplicitFallbackPair) {
        continue;
      }
    }

    const versions = [...new Set(group.map((g) => g.capabilityVersion))].toSorted();
    if (versions.length <= 1) {
      continue;
    } // 多条但版本相同，也不视为冲突
    const [agentId, capabilityId] = key.split("::");
    result.push(
      makeIssue({
        category: "capability-conflict",
        severity: "medium",
        subjectId: key,
        runtimeAgentId: agentId,
        bindingId: null,
        description: `Agent ${agentId} 上存在 ${capabilityId} 的多个不同版本绑定`,
        impact: "路由器可能选择非预期版本，行为不可预测",
        evidence: {
          capabilityId,
          versions,
          bindingIds: group.map((g) => g.bindingId).toSorted(),
        },
        suggestedAction: "保留单一版本绑定，或将多余版本配置为 fallback",
        detectedAt: now,
      }),
    );
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────
// 入口聚合器
// ─────────────────────────────────────────────────────────────────────────

/**
 * 执行全部 7 类运行时治理检测，并对结果进行**确定性排序**（按 issue.id 字典序）。
 *
 * 确定性约定（Property 7）：相同入参（含 `now` 与可选 `config`）必定生成
 * deep-equal 的 Issue 列表。
 *
 * @param agents   全部 Agent Runtime 实例
 * @param bindings 全部 Runtime Capability Binding
 * @param config   可选阈值覆盖；未指定字段使用 {@link DEFAULT_GOVERNANCE_CONFIG}
 * @param now      检测时间戳（毫秒）。注入此参数是为了让纯函数性可测试，
 *                  生产代码默认传入 `Date.now()`。
 * @returns        排序后的运行时治理问题列表
 */
export function detectGovernanceIssues(
  agents: readonly RuntimeAgent[],
  bindings: readonly RuntimeCapabilityBinding[],
  config: Partial<GovernanceDetectorConfig> | undefined,
  now: number,
): RuntimeGovernanceIssue[] {
  const cfg: GovernanceDetectorConfig = { ...DEFAULT_GOVERNANCE_CONFIG, ...config };
  const merged: RuntimeGovernanceIssue[] = [
    ...detectZombieBindings(bindings, cfg.zombieBindingDays, now),
    ...detectOrphanedAgents(agents, bindings, cfg.orphanedAgentDays, now),
    ...detectVersionDrift(bindings, now),
    ...detectFallbackChainBroken(bindings, now),
    ...detectResourceOvercommit(agents, cfg.resourceOvercommitThreshold, now),
    ...detectCapabilityConflict(bindings, now),
    // sandbox-violation 当前依赖运行时遥测的扩展字段，留作 Phase 3 接入。
  ];
  return sortIssues(merged);
}
