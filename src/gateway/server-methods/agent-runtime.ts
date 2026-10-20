/**
 * Agent Runtime Center 后端 RPC 处理器（namespace: `agent-runtime.*`）。
 *
 * 与 `ui/src/ui/capability/agent-runtime/endpoints.ts` 中的目录端点对应，并包含
 * 批量绑定、策略文档，以及 `binding.upgrade` / `capability-versions.list`。
 *
 * 设计要点：
 * - 输入校验：每个 handler 在调用 store 前对 params 做最小化类型检查
 * - 错误处理：`AgentRuntimeStoreError` 转 INVALID_REQUEST；其他异常转 UNAVAILABLE
 * - 同步行为：store 本身是同步 IO（与 skill-lifecycle / capability-governance 一致）
 * - 治理问题列表由 store + 纯函数 detector 实时计算（不持久化），保证幂等
 */

import { loadConfig } from "../../config/config.js";
import { maybeSeedAgentRuntimeFromPlatformState } from "../agent-runtime-seed.js";
import {
  __agentRuntimeStoreInternals,
  AgentRuntimeStoreError,
  computeKpi,
  clearBindingFallback,
  createBinding,
  type BindingState,
  type BindingType,
  type CreateBindingInput,
  deleteBinding,
  getAgent,
  getBinding,
  getGovernanceConfig,
  getHealthSummary,
  getIssueAcknowledgement,
  getRuntimePolicy,
  type GovernanceDetectorConfig,
  type LifecycleEvent,
  listAgents,
  listBindings,
  listLifecycleEvents,
  listTelemetry,
  type LoadStrategy,
  recordIssueAcknowledgement,
  replaceRuntimePolicy,
  type RuntimePolicyConflict,
  type RuntimePolicyDocument,
  type RuntimePolicyFallbackMode,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeHealth,
  type RuntimeLifecycle,
  transitionLifecycle,
  type TelemetryWindow,
  upsertBinding,
  updateBindingPriority,
  updateBindingState,
  updateBindingStrategy,
  updateBindingVersion,
  updateGovernanceConfig,
} from "../agent-runtime-store.js";
import {
  assessCapabilityUpgrade,
  listCapabilityVersionCatalog,
  type CapabilityVersionRegistrySource,
} from "../agent-runtime-version-catalog.js";
import { listRegistry } from "../capability-governance-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import { exactMember, isRecord, requiredString } from "./request-params.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

// 导出测试辅助以便集成测试可以重置 store
export { __agentRuntimeStoreInternals };

// ─────────────────────────────────────────────────────────────────────────
// 内联治理检测器（与 UI 端 governance-detector.ts 同语义）
//
// 服务端选择内联实现而非引入 UI 模块，原因：
// 1. ESM 跨 ui/src 与 src/ 边界引入会破坏模块拓扑
// 2. 检测器是无状态纯函数，复制成本低且语义稳定
// 3. 服务端可以独立演进 detector（例如未来加入持久化的失败采样）
// ─────────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1_000;

type RuntimeGovernanceIssueCategory =
  | "zombie-binding"
  | "resource-overcommit"
  | "capability-conflict"
  | "sandbox-violation"
  | "version-drift"
  | "fallback-chain-broken"
  | "orphaned-agent";

type RuntimeGovernanceIssueSeverity = "critical" | "high" | "medium" | "low";

type RuntimeGovernanceIssue = {
  id: string;
  category: RuntimeGovernanceIssueCategory;
  severity: RuntimeGovernanceIssueSeverity;
  runtimeAgentId: string | null;
  bindingId: string | null;
  description: string;
  impact: string;
  evidence: Record<string, unknown>;
  suggestedAction: string;
  detectedAt: number;
  acknowledgedBy: string | null;
  acknowledgedAt: number | null;
};

function makeIssueId(category: RuntimeGovernanceIssueCategory, subjectId: string): string {
  return `${category}::${subjectId}`;
}

function detectIssues(
  agents: RuntimeAgent[],
  bindings: RuntimeCapabilityBinding[],
  config: GovernanceDetectorConfig,
  now: number,
): RuntimeGovernanceIssue[] {
  const result: RuntimeGovernanceIssue[] = [];

  // zombie-binding
  const zombieCutoff = config.zombieBindingDays * MS_PER_DAY;
  for (const b of bindings) {
    if (b.bindingState !== "active") {
      continue;
    }
    if (b.invocationMetrics.calls7d > 0) {
      continue;
    }
    if (now - b.updatedAt < zombieCutoff) {
      continue;
    }
    result.push({
      id: makeIssueId("zombie-binding", b.bindingId),
      category: "zombie-binding",
      severity: "low",
      runtimeAgentId: b.runtimeAgentId,
      bindingId: b.bindingId,
      description: `绑定 ${b.bindingId} 已超过 ${config.zombieBindingDays} 天无调用`,
      impact: "占用 Agent 装载位但无业务价值",
      evidence: {
        calls7d: 0,
        inactiveDays: Math.floor((now - b.updatedAt) / MS_PER_DAY),
        thresholdDays: config.zombieBindingDays,
      },
      suggestedAction: "确认是否仍需要该绑定，必要时禁用或卸载",
      detectedAt: now,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  // orphaned-agent
  const orphanCutoff = config.orphanedAgentDays * MS_PER_DAY;
  const agentsWithBinding = new Set<string>();
  for (const b of bindings) {
    agentsWithBinding.add(b.runtimeAgentId);
  }
  for (const a of agents) {
    if (a.lifecycle === "archived") {
      continue;
    }
    if (agentsWithBinding.has(a.runtimeAgentId)) {
      continue;
    }
    if (now - a.lastActiveAt < orphanCutoff) {
      continue;
    }
    result.push({
      id: makeIssueId("orphaned-agent", a.runtimeAgentId),
      category: "orphaned-agent",
      severity: "low",
      runtimeAgentId: a.runtimeAgentId,
      bindingId: null,
      description: `Agent ${a.name} 无任何能力绑定且长期不活跃`,
      impact: "Agent 实例资源未释放，可能浪费配额",
      evidence: {
        inactiveDays: Math.floor((now - a.lastActiveAt) / MS_PER_DAY),
        boundCapabilityCount: a.boundCapabilityCount,
        thresholdDays: config.orphanedAgentDays,
      },
      suggestedAction: "如不再使用，建议进入 draining → suspended → archived 流程",
      detectedAt: now,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  // version-drift
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
  for (const [capabilityId, versions] of versionsByCapability) {
    if (versions.size <= 1) {
      continue;
    }
    result.push({
      id: makeIssueId("version-drift", capabilityId),
      category: "version-drift",
      severity: "medium",
      runtimeAgentId: null,
      bindingId: null,
      description: `Capability ${capabilityId} 在不同 Agent 上版本不一致`,
      impact: "可能导致同一能力在不同租户上行为不一致",
      evidence: {
        capabilityId,
        versions: [...versions].toSorted(),
        distinctVersionCount: versions.size,
      },
      suggestedAction: "评估是否需要统一升级到最新版本，或审核版本切换计划",
      detectedAt: now,
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  // fallback-chain-broken
  const byId = new Map<string, RuntimeCapabilityBinding>();
  for (const b of bindings) {
    byId.set(b.bindingId, b);
  }
  for (const b of bindings) {
    if (b.fallbackBindingId === null) {
      continue;
    }
    const fb = byId.get(b.fallbackBindingId);
    if (!fb) {
      result.push({
        id: makeIssueId("fallback-chain-broken", b.bindingId),
        category: "fallback-chain-broken",
        severity: "high",
        runtimeAgentId: b.runtimeAgentId,
        bindingId: b.bindingId,
        description: `绑定 ${b.bindingId} 指向的降级备选不存在`,
        impact: "主绑定不可用时将失去降级保护",
        evidence: { fallbackBindingId: b.fallbackBindingId, reason: "missing" },
        suggestedAction: "更正 fallbackBindingId 或清空该字段",
        detectedAt: now,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
      continue;
    }
    if (
      fb.bindingState === "disabled" ||
      fb.healthStatus === "unhealthy" ||
      fb.healthStatus === "unavailable"
    ) {
      result.push({
        id: makeIssueId("fallback-chain-broken", b.bindingId),
        category: "fallback-chain-broken",
        severity: "high",
        runtimeAgentId: b.runtimeAgentId,
        bindingId: b.bindingId,
        description: `绑定 ${b.bindingId} 的降级备选当前不可用`,
        impact: "主绑定不可用时降级链失效",
        evidence: {
          fallbackBindingId: fb.bindingId,
          fallbackState: fb.bindingState,
          fallbackHealth: fb.healthStatus,
        },
        suggestedAction: "修复备选绑定或更换 fallbackBindingId",
        detectedAt: now,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
    }
  }

  // resource-overcommit
  const thresholdPercent = config.resourceOvercommitThreshold * 100;
  for (const a of agents) {
    if (a.lifecycle !== "deployed") {
      continue;
    }
    const cpu = a.resourceUsage.cpuPercent;
    const mem = a.resourceUsage.memoryPercent;
    if (cpu >= thresholdPercent || mem >= thresholdPercent) {
      result.push({
        id: makeIssueId("resource-overcommit", a.runtimeAgentId),
        category: "resource-overcommit",
        severity: "high",
        runtimeAgentId: a.runtimeAgentId,
        bindingId: null,
        description: `Agent ${a.name} 资源使用率超过阈值`,
        impact: "可能影响请求处理能力或触发 OOM",
        evidence: { cpuPercent: cpu, memoryPercent: mem, thresholdPercent },
        suggestedAction: "扩容 Agent 实例或迁移部分能力",
        detectedAt: now,
        acknowledgedBy: null,
        acknowledgedAt: null,
      });
    }
  }

  // capability-conflict
  type Group = RuntimeCapabilityBinding[];
  const groups = new Map<string, Group>();
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
  for (const [key, group] of groups) {
    if (group.length <= 1) {
      continue;
    }
    if (group.length === 2) {
      const [a, b] = group;
      const isPair = a.fallbackBindingId === b.bindingId || b.fallbackBindingId === a.bindingId;
      if (isPair) {
        continue;
      }
    }
    const versions = [...new Set(group.map((g) => g.capabilityVersion))].toSorted();
    if (versions.length <= 1) {
      continue;
    }
    const [agentId, capabilityId] = key.split("::");
    result.push({
      id: makeIssueId("capability-conflict", key),
      category: "capability-conflict",
      severity: "medium",
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
      acknowledgedBy: null,
      acknowledgedAt: null,
    });
  }

  // 注入 acknowledgements + 排序
  for (const issue of result) {
    const ack = getIssueAcknowledgement(issue.id);
    if (ack) {
      issue.acknowledgedBy = ack.reviewerId;
      issue.acknowledgedAt = ack.acknowledgedAt;
    }
  }
  return result.toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ─────────────────────────────────────────────────────────────────────────
// 输入校验工具
// ─────────────────────────────────────────────────────────────────────────

function requiredEnum<T extends string>(
  params: Record<string, unknown>,
  key: string,
  allowed: readonly T[],
  respond: RespondFn,
): T | null {
  const value = exactMember(params[key], allowed);
  if (value === null) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `${key} must be one of: ${allowed.join(", ")}`),
    );
  }
  return value;
}

const MAX_BINDING_BATCH = 100;

function batchRejectionReason(error: unknown): string {
  if (error instanceof AgentRuntimeStoreError) {
    return error.message;
  }
  return error instanceof Error ? error.message : "binding update failed";
}

function bindingIdsParam(params: Record<string, unknown>, respond: RespondFn): string[] | null {
  const raw = params.bindingIds;
  if (!Array.isArray(raw) || raw.length === 0) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "bindingIds must be a non-empty string array"),
    );
    return null;
  }
  if (raw.length > MAX_BINDING_BATCH) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, `bindingIds exceeds ${MAX_BINDING_BATCH}`),
    );
    return null;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string" || !item.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "bindingIds must be a non-empty string array"),
      );
      return null;
    }
    const id = item.trim();
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

/**
 * `null` means the caller omitted issueIds (fix the whole category).
 * `undefined` means the parameter was present but invalid and an error was sent.
 */
function issueIdsParam(
  params: Record<string, unknown>,
  respond: RespondFn,
): string[] | null | undefined {
  if (params.issueIds === undefined) {
    return null;
  }
  if (!Array.isArray(params.issueIds)) {
    respond(
      false,
      undefined,
      errorShape(ErrorCodes.INVALID_REQUEST, "issueIds must be an array of strings"),
    );
    return undefined;
  }
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of params.issueIds) {
    if (typeof item !== "string" || !item.trim()) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "issueIds must be an array of strings"),
      );
      return undefined;
    }
    const id = item.trim();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

type GovernanceFixApplied = { issueId: string; bindingId: string; action: string };
type GovernanceFixSkipped = { issueId: string; reason: string };

function governanceFixPlan(
  issue: RuntimeGovernanceIssue,
): { action: "disable-binding" | "clear-missing-fallback" } | { skip: string } {
  if (issue.category === "zombie-binding" && issue.bindingId) {
    return { action: "disable-binding" };
  }
  if (issue.category === "fallback-chain-broken" && issue.bindingId) {
    if (issue.evidence.reason === "missing") {
      return { action: "clear-missing-fallback" };
    }
    return {
      skip: "fallback target is disabled or unhealthy; automatic re-enable is not defined",
    };
  }
  if (issue.category === "version-drift" || issue.category === "capability-conflict") {
    return {
      skip: "no safe version target; call agent-runtime.binding.upgrade with an explicit capabilityVersion",
    };
  }
  if (issue.category === "orphaned-agent") {
    return { skip: "automatic lifecycle drain is not defined" };
  }
  if (issue.category === "resource-overcommit") {
    return { skip: "automatic capacity change is not defined" };
  }
  return { skip: "no automatic repair for this category" };
}

function applyGovernanceFix(params: {
  category: RuntimeGovernanceIssueCategory;
  issueIds: string[] | null;
  dryRun: boolean;
}): { dryRun: boolean; applied: GovernanceFixApplied[]; skipped: GovernanceFixSkipped[] } {
  const config = getGovernanceConfig();
  const agents = listAgents({ lifecycle: null, health: null, tenantId: null, searchQuery: "" });
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  const open = detectIssues(agents, bindings, config, Date.now()).filter(
    (issue) => issue.category === params.category,
  );
  const byId = new Map(open.map((issue) => [issue.id, issue]));
  const selected = params.issueIds
    ? params.issueIds.map((issueId) => byId.get(issueId) ?? issueId)
    : open;
  const applied: GovernanceFixApplied[] = [];
  const skipped: GovernanceFixSkipped[] = [];
  for (const entry of selected) {
    if (typeof entry === "string") {
      skipped.push({ issueId: entry, reason: "issue is not open in this category" });
      continue;
    }
    const plan = governanceFixPlan(entry);
    if ("skip" in plan) {
      skipped.push({ issueId: entry.id, reason: plan.skip });
      continue;
    }
    const bindingId = entry.bindingId;
    if (!bindingId) {
      skipped.push({ issueId: entry.id, reason: "issue has no binding to repair" });
      continue;
    }
    if (!params.dryRun) {
      try {
        if (plan.action === "disable-binding") {
          updateBindingState(bindingId, "disabled");
        } else {
          clearBindingFallback(bindingId);
        }
      } catch (err) {
        skipped.push({ issueId: entry.id, reason: batchRejectionReason(err) });
        continue;
      }
    }
    applied.push({ issueId: entry.id, bindingId, action: plan.action });
  }
  return { dryRun: params.dryRun, applied, skipped };
}

const POLICY_CONFLICTS: readonly RuntimePolicyConflict[] = [
  "highest-success",
  "priority",
  "manual",
];
const POLICY_FALLBACK_MODES: readonly RuntimePolicyFallbackMode[] = ["auto-standby", "none"];

function nullablePolicyEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
): T | null | undefined {
  if (value === null) {
    return null;
  }
  return exactMember(value, allowed) ?? undefined;
}

function nullableRate(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

/** Whole requests/day. Fractional values are not a daily request count. */
function nullableDailyCap(value: unknown): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function registryVersionSources(): CapabilityVersionRegistrySource[] {
  return listRegistry().flatMap((entry) => {
    const capabilityId = entry.manifest.id.trim();
    const version = entry.manifest.version.trim();
    if (!capabilityId || !version) {
      return [];
    }
    return [{ capabilityId, version, lifecycleState: entry.lifecycleState }];
  });
}

function currentVersionCatalog() {
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  });
  return listCapabilityVersionCatalog({
    bindings,
    registry: registryVersionSources(),
  });
}

function mergeRuntimePolicy(
  current: RuntimePolicyDocument,
  params: Record<string, unknown>,
  respond: RespondFn,
): RuntimePolicyDocument | null {
  const known = ["loadDefaults", "conflict", "fallback", "rateLimit"] as const;
  if (!known.some((key) => key in params)) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "policy patch is empty"));
    return null;
  }
  const next: RuntimePolicyDocument = {
    loadDefaults: current.loadDefaults
      ? {
          default: current.loadDefaults.default,
          byCapabilityKind: { ...current.loadDefaults.byCapabilityKind },
        }
      : null,
    conflict: current.conflict,
    fallback: { mode: current.fallback.mode },
    rateLimit: current.rateLimit
      ? {
          perCapabilityQps: current.rateLimit.perCapabilityQps,
          perTenantDailyCap: current.rateLimit.perTenantDailyCap,
        }
      : null,
  };
  if ("loadDefaults" in params) {
    if (params.loadDefaults === null) {
      next.loadDefaults = null;
    } else if (!isRecord(params.loadDefaults)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "loadDefaults must be an object or null"),
      );
      return null;
    } else {
      const incoming = params.loadDefaults;
      const base = next.loadDefaults ?? { default: null, byCapabilityKind: {} };
      if ("default" in incoming) {
        const parsed = nullablePolicyEnum(incoming.default, LOAD_STRATEGIES);
        if (parsed === undefined) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "loadDefaults.default must be a load strategy or null",
            ),
          );
          return null;
        }
        base.default = parsed;
      }
      if ("byCapabilityKind" in incoming) {
        if (!isRecord(incoming.byCapabilityKind)) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "byCapabilityKind must be an object"),
          );
          return null;
        }
        const kinds: Record<string, LoadStrategy | null> = {};
        for (const [key, value] of Object.entries(incoming.byCapabilityKind)) {
          const trimmed = key.trim();
          if (!trimmed || trimmed.length > 64) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.INVALID_REQUEST, "capability kind key is invalid"),
            );
            return null;
          }
          const parsed = nullablePolicyEnum(value, LOAD_STRATEGIES);
          if (parsed === undefined) {
            respond(
              false,
              undefined,
              errorShape(ErrorCodes.INVALID_REQUEST, `invalid load strategy for ${trimmed}`),
            );
            return null;
          }
          kinds[trimmed] = parsed;
        }
        if (Object.keys(kinds).length > 64) {
          respond(
            false,
            undefined,
            errorShape(ErrorCodes.INVALID_REQUEST, "byCapabilityKind exceeds 64 keys"),
          );
          return null;
        }
        base.byCapabilityKind = kinds;
      }
      next.loadDefaults = base;
    }
  }
  if ("conflict" in params) {
    const parsed = nullablePolicyEnum(params.conflict, POLICY_CONFLICTS);
    if (parsed === undefined) {
      respond(
        false,
        undefined,
        errorShape(
          ErrorCodes.INVALID_REQUEST,
          "conflict must be highest-success, priority, manual, or null",
        ),
      );
      return null;
    }
    next.conflict = parsed;
  }
  if ("fallback" in params) {
    if (!isRecord(params.fallback) || !("mode" in params.fallback)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "fallback.mode is required"),
      );
      return null;
    }
    const parsed = nullablePolicyEnum(params.fallback.mode, POLICY_FALLBACK_MODES);
    if (parsed === undefined) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "fallback.mode must be auto-standby, none, or null"),
      );
      return null;
    }
    next.fallback = { mode: parsed };
  }
  if ("rateLimit" in params) {
    if (params.rateLimit === null) {
      next.rateLimit = null;
    } else if (!isRecord(params.rateLimit)) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "rateLimit must be an object or null"),
      );
      return null;
    } else {
      const base = next.rateLimit ?? { perCapabilityQps: null, perTenantDailyCap: null };
      if ("perCapabilityQps" in params.rateLimit) {
        const parsed = nullableRate(params.rateLimit.perCapabilityQps);
        if (parsed === undefined) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "perCapabilityQps must be a non-negative number of requests per second, or null",
            ),
          );
          return null;
        }
        base.perCapabilityQps = parsed;
      }
      if ("perTenantDailyCap" in params.rateLimit) {
        const parsed = nullableDailyCap(params.rateLimit.perTenantDailyCap);
        if (parsed === undefined) {
          respond(
            false,
            undefined,
            errorShape(
              ErrorCodes.INVALID_REQUEST,
              "perTenantDailyCap must be a non-negative integer number of requests per day, or null",
            ),
          );
          return null;
        }
        base.perTenantDailyCap = parsed;
      }
      next.rateLimit = base;
    }
  }
  return next;
}

function respondError(respond: RespondFn, error: unknown): void {
  if (error instanceof AgentRuntimeStoreError) {
    respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, error.message));
    return;
  }
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, String(error)));
}

const RUNTIME_LIFECYCLES: RuntimeLifecycle[] = [
  "deployed",
  "draining",
  "suspended",
  "deprecated",
  "archived",
];
const RUNTIME_HEALTHS: RuntimeHealth[] = ["healthy", "degraded", "unhealthy", "unavailable"];
const BINDING_TYPES: BindingType[] = [
  "tenant-installed",
  "platform-default",
  "dynamic-runtime",
  "fallback",
];
const BINDING_STATES: BindingState[] = ["active", "warming", "degraded", "disabled"];
const LOAD_STRATEGIES: LoadStrategy[] = ["eager", "lazy", "on-demand"];
const TELEMETRY_WINDOWS: TelemetryWindow[] = ["1h", "6h", "24h", "7d", "30d"];

const ISSUE_CATEGORIES: RuntimeGovernanceIssueCategory[] = [
  "zombie-binding",
  "resource-overcommit",
  "capability-conflict",
  "sandbox-violation",
  "version-drift",
  "fallback-chain-broken",
  "orphaned-agent",
];
const ISSUE_SEVERITIES: RuntimeGovernanceIssueSeverity[] = ["critical", "high", "medium", "low"];

// ─────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────

export const agentRuntimeHandlers: GatewayRequestHandlers = {
  // ── Runtime Catalog ──
  "agent-runtime.list-agents": ({ params, respond }) => {
    const filter = {
      lifecycle: exactMember(params.lifecycle, RUNTIME_LIFECYCLES),
      health: exactMember(params.health, RUNTIME_HEALTHS),
      tenantId:
        typeof params.tenantId === "string" && params.tenantId.trim()
          ? params.tenantId.trim()
          : null,
      searchQuery: typeof params.searchQuery === "string" ? params.searchQuery : "",
    };
    respond(true, { agents: listAgents(filter) }, undefined);
  },

  "agent-runtime.get-agent": ({ params, respond }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const agent = getAgent(runtimeAgentId);
    if (!agent) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Unknown agent: ${runtimeAgentId}`),
      );
      return;
    }
    const bindings = listBindings({
      runtimeAgentId,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    respond(true, { agent, bindings }, undefined);
  },

  // ── Capability Bindings ──
  "agent-runtime.list-bindings": ({ params, respond }) => {
    respond(
      true,
      {
        bindings: listBindings({
          runtimeAgentId:
            typeof params.runtimeAgentId === "string" && params.runtimeAgentId.trim()
              ? params.runtimeAgentId.trim()
              : null,
          capabilityId:
            typeof params.capabilityId === "string" && params.capabilityId.trim()
              ? params.capabilityId.trim()
              : null,
          bindingType: exactMember(params.bindingType, BINDING_TYPES),
          bindingState: exactMember(params.bindingState, BINDING_STATES),
          health: exactMember(params.health, RUNTIME_HEALTHS),
        }),
      },
      undefined,
    );
  },

  "agent-runtime.get-binding": ({ params, respond }) => {
    const bindingId = requiredString(params, "bindingId", respond);
    if (!bindingId) {
      return;
    }
    const binding = getBinding(bindingId);
    if (!binding) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Unknown binding: ${bindingId}`),
      );
      return;
    }
    const agent = getAgent(binding.runtimeAgentId);
    respond(
      true,
      {
        binding,
        agentName: agent?.name ?? binding.runtimeAgentId,
        // capabilityName 在当前后端没有真正的 catalog；用 capabilityId 占位。
        // 真实落地时由 capability-governance-store 提供 manifest.name。
        capabilityName: binding.capabilityId,
      },
      undefined,
    );
  },

  "agent-runtime.seed": async ({ respond, context }) => {
    try {
      const cfg = loadConfig();
      const result = await maybeSeedAgentRuntimeFromPlatformState({
        cfg,
        trustedProxy: cfg.gateway?.auth?.trustedProxy,
        log: {
          info: (message) => context.logGateway.info(message),
          warn: (message) => context.logGateway.warn(message),
        },
      });
      respond(true, result, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.upsert-binding": ({ params, respond }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    const capabilityVersion = requiredString(params, "capabilityVersion", respond);
    const bindingType = requiredEnum(params, "bindingType", BINDING_TYPES, respond);
    const loadStrategy = requiredEnum(params, "loadStrategy", LOAD_STRATEGIES, respond);
    if (!runtimeAgentId || !capabilityId || !capabilityVersion || !bindingType || !loadStrategy) {
      return;
    }
    const policyRaw = isRecord(params.policy) ? params.policy : null;
    const policy: CreateBindingInput["policy"] = policyRaw
      ? {
          sandbox: typeof policyRaw.sandbox === "string" ? policyRaw.sandbox : "strict",
          resourceQuota:
            typeof policyRaw.resourceQuota === "string" ? policyRaw.resourceQuota : "small",
          hotReloadable:
            typeof policyRaw.hotReloadable === "boolean" ? policyRaw.hotReloadable : true,
        }
      : null;
    try {
      const binding = upsertBinding({
        runtimeAgentId,
        capabilityId,
        capabilityVersion,
        bindingType,
        loadStrategy,
        routingPriority: typeof params.routingPriority === "number" ? params.routingPriority : null,
        policy,
        fallbackBindingId:
          typeof params.fallbackBindingId === "string" && params.fallbackBindingId.trim()
            ? params.fallbackBindingId.trim()
            : null,
      });
      respond(true, { binding }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.create-binding": ({ params, respond }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    const capabilityId = requiredString(params, "capabilityId", respond);
    const capabilityVersion = requiredString(params, "capabilityVersion", respond);
    const bindingType = requiredEnum(params, "bindingType", BINDING_TYPES, respond);
    const loadStrategy = requiredEnum(params, "loadStrategy", LOAD_STRATEGIES, respond);
    if (!runtimeAgentId || !capabilityId || !capabilityVersion || !bindingType || !loadStrategy) {
      return;
    }
    const policyRaw = isRecord(params.policy) ? params.policy : null;
    const policy: CreateBindingInput["policy"] = policyRaw
      ? {
          sandbox: typeof policyRaw.sandbox === "string" ? policyRaw.sandbox : "strict",
          resourceQuota:
            typeof policyRaw.resourceQuota === "string" ? policyRaw.resourceQuota : "small",
          hotReloadable:
            typeof policyRaw.hotReloadable === "boolean" ? policyRaw.hotReloadable : true,
        }
      : null;
    try {
      const binding = createBinding({
        runtimeAgentId,
        capabilityId,
        capabilityVersion,
        bindingType,
        loadStrategy,
        routingPriority: typeof params.routingPriority === "number" ? params.routingPriority : null,
        policy,
        fallbackBindingId:
          typeof params.fallbackBindingId === "string" && params.fallbackBindingId.trim()
            ? params.fallbackBindingId.trim()
            : null,
      });
      respond(true, { binding }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.update-binding-state": ({ params, respond }) => {
    const bindingId = requiredString(params, "bindingId", respond);
    const bindingState = requiredEnum(params, "bindingState", BINDING_STATES, respond);
    if (!bindingId || !bindingState) {
      return;
    }
    try {
      const binding = updateBindingState(bindingId, bindingState);
      respond(true, { binding }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.update-binding-priority": ({ params, respond }) => {
    const bindingId = requiredString(params, "bindingId", respond);
    if (!bindingId) {
      return;
    }
    if (typeof params.routingPriority !== "number") {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, "routingPriority must be a number"),
      );
      return;
    }
    try {
      const binding = updateBindingPriority(bindingId, params.routingPriority);
      respond(true, { binding }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.update-binding-strategy": ({ params, respond }) => {
    const bindingId = requiredString(params, "bindingId", respond);
    const loadStrategy = requiredEnum(params, "loadStrategy", LOAD_STRATEGIES, respond);
    if (!bindingId || !loadStrategy) {
      return;
    }
    try {
      const binding = updateBindingStrategy(bindingId, loadStrategy);
      respond(true, { binding }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.binding.batch-set-state": ({ params, respond }) => {
    const bindingIds = bindingIdsParam(params, respond);
    if (!bindingIds) {
      return;
    }
    const bindingState = requiredEnum(params, "bindingState", BINDING_STATES, respond);
    if (!bindingState) {
      return;
    }
    const applied: RuntimeCapabilityBinding[] = [];
    const rejected: Array<{ bindingId: string; reason: string }> = [];
    for (const bindingId of bindingIds) {
      try {
        const binding = updateBindingState(bindingId, bindingState);
        if (binding.bindingId !== bindingId || binding.bindingState !== bindingState) {
          rejected.push({ bindingId, reason: "stored binding did not match the request" });
          continue;
        }
        applied.push(binding);
      } catch (err) {
        rejected.push({ bindingId, reason: batchRejectionReason(err) });
      }
    }
    respond(true, { applied, rejected }, undefined);
  },

  "agent-runtime.binding.batch-set-strategy": ({ params, respond }) => {
    const bindingIds = bindingIdsParam(params, respond);
    if (!bindingIds) {
      return;
    }
    const loadStrategy = requiredEnum(params, "loadStrategy", LOAD_STRATEGIES, respond);
    if (!loadStrategy) {
      return;
    }
    const applied: RuntimeCapabilityBinding[] = [];
    const rejected: Array<{ bindingId: string; reason: string }> = [];
    for (const bindingId of bindingIds) {
      try {
        const binding = updateBindingStrategy(bindingId, loadStrategy);
        if (binding.bindingId !== bindingId || binding.loadStrategy !== loadStrategy) {
          rejected.push({ bindingId, reason: "stored binding did not match the request" });
          continue;
        }
        applied.push(binding);
      } catch (err) {
        rejected.push({ bindingId, reason: batchRejectionReason(err) });
      }
    }
    respond(true, { applied, rejected }, undefined);
  },

  "agent-runtime.capability-versions.list": ({ params, respond }) => {
    const capabilityId =
      typeof params.capabilityId === "string" && params.capabilityId.trim()
        ? params.capabilityId.trim()
        : null;
    try {
      const entries = currentVersionCatalog().filter(
        (entry) => capabilityId === null || entry.capabilityId === capabilityId,
      );
      respond(true, { entries }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.binding.upgrade": ({ params, respond }) => {
    const bindingIds = bindingIdsParam(params, respond);
    if (!bindingIds) {
      return;
    }
    const capabilityVersion = requiredString(params, "capabilityVersion", respond);
    if (!capabilityVersion) {
      return;
    }
    const targetVersion = capabilityVersion.trim();
    let catalog;
    try {
      catalog = currentVersionCatalog();
    } catch (err) {
      respondError(respond, err);
      return;
    }
    const applied: RuntimeCapabilityBinding[] = [];
    const rejected: Array<{ bindingId: string; reason: string }> = [];
    for (const bindingId of bindingIds) {
      const current = getBinding(bindingId);
      if (!current) {
        rejected.push({ bindingId, reason: `Unknown binding: ${bindingId}` });
        continue;
      }
      const decision = assessCapabilityUpgrade({
        capabilityId: current.capabilityId,
        currentVersion: current.capabilityVersion,
        targetVersion,
        catalog,
      });
      if (!decision.ok) {
        rejected.push({ bindingId, reason: decision.reason });
        continue;
      }
      try {
        const binding = updateBindingVersion(bindingId, targetVersion);
        if (binding.bindingId !== bindingId || binding.capabilityVersion !== targetVersion) {
          rejected.push({ bindingId, reason: "stored binding did not match the request" });
          continue;
        }
        applied.push(binding);
      } catch (err) {
        rejected.push({ bindingId, reason: batchRejectionReason(err) });
      }
    }
    respond(true, { applied, rejected }, undefined);
  },

  "agent-runtime.delete-binding": ({ params, respond }) => {
    const bindingId = requiredString(params, "bindingId", respond);
    if (!bindingId) {
      return;
    }
    const deleted = deleteBinding(bindingId);
    respond(true, { bindingId, deleted }, undefined);
  },

  // ── Runtime Health ──
  "agent-runtime.list-telemetry": ({ params, respond }) => {
    const window = exactMember(params.window, TELEMETRY_WINDOWS) ?? "24h";
    const samples = listTelemetry({
      runtimeAgentId:
        typeof params.runtimeAgentId === "string" && params.runtimeAgentId.trim()
          ? params.runtimeAgentId.trim()
          : null,
      capabilityId:
        typeof params.capabilityId === "string" && params.capabilityId.trim()
          ? params.capabilityId.trim()
          : null,
      window,
    });
    respond(true, { samples }, undefined);
  },

  "agent-runtime.get-health-summary": ({ respond }) => {
    respond(true, getHealthSummary(), undefined);
  },

  // ── Deployment Lifecycle ──
  "agent-runtime.update-lifecycle": ({ params, respond, client }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    const targetLifecycle = requiredEnum(params, "targetLifecycle", RUNTIME_LIFECYCLES, respond);
    if (!runtimeAgentId || !targetLifecycle) {
      return;
    }
    const reason = typeof params.reason === "string" ? params.reason : "";
    try {
      const result = transitionLifecycle({
        runtimeAgentId,
        targetLifecycle,
        actor: client?.user ?? "operator",
        reason,
      });
      respond(
        true,
        {
          agent: result.agent,
          rejectionReason: result.rejectionReason,
          impact: result.impact,
        },
        undefined,
      );
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.get-lifecycle-history": ({ params, respond }) => {
    const runtimeAgentId = requiredString(params, "runtimeAgentId", respond);
    if (!runtimeAgentId) {
      return;
    }
    const events: LifecycleEvent[] = listLifecycleEvents(runtimeAgentId);
    respond(true, { events }, undefined);
  },

  // ── Governance & Policy ──
  "agent-runtime.list-governance-issues": ({ params, respond }) => {
    const includeAcknowledged = params.includeAcknowledged === true;
    const categoryFilter = exactMember(params.category, ISSUE_CATEGORIES);
    const severityFilter = exactMember(params.severity, ISSUE_SEVERITIES);
    const config = getGovernanceConfig();
    const agents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: null,
      searchQuery: "",
    });
    const bindings = listBindings({
      runtimeAgentId: null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    const all = detectIssues(agents, bindings, config, Date.now());
    const issues = all.filter((i) => {
      if (categoryFilter !== null && i.category !== categoryFilter) {
        return false;
      }
      if (severityFilter !== null && i.severity !== severityFilter) {
        return false;
      }
      if (!includeAcknowledged && i.acknowledgedBy !== null) {
        return false;
      }
      return true;
    });
    respond(true, { issues }, undefined);
  },

  "agent-runtime.acknowledge-issue": ({ params, respond, client }) => {
    const issueId = requiredString(params, "issueId", respond);
    if (!issueId) {
      return;
    }
    const reviewerId =
      (typeof params.reviewerId === "string" && params.reviewerId.trim()) ||
      client?.user ||
      "operator";
    const note = typeof params.note === "string" && params.note.trim() ? params.note.trim() : null;
    recordIssueAcknowledgement({ issueId, reviewerId, note });
    // 重新计算 issue 列表并返回带 ack 信息的版本
    const config = getGovernanceConfig();
    const agents = listAgents({
      lifecycle: null,
      health: null,
      tenantId: null,
      searchQuery: "",
    });
    const bindings = listBindings({
      runtimeAgentId: null,
      capabilityId: null,
      bindingType: null,
      bindingState: null,
      health: null,
    });
    const all = detectIssues(agents, bindings, config, Date.now());
    const issue = all.find((i) => i.id === issueId);
    if (!issue) {
      respond(
        false,
        undefined,
        errorShape(ErrorCodes.INVALID_REQUEST, `Unknown issue: ${issueId}`),
      );
      return;
    }
    respond(true, { issue }, undefined);
  },

  "agent-runtime.get-governance-config": ({ respond }) => {
    respond(true, { config: getGovernanceConfig() }, undefined);
  },

  "agent-runtime.governance.fix": ({ params, respond }) => {
    const category = requiredEnum(params, "category", ISSUE_CATEGORIES, respond);
    if (!category) {
      return;
    }
    if (typeof params.dryRun !== "boolean") {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "dryRun must be a boolean"));
      return;
    }
    const issueIds = issueIdsParam(params, respond);
    if (issueIds === undefined) {
      return;
    }
    try {
      respond(true, applyGovernanceFix({ category, issueIds, dryRun: params.dryRun }), undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.policy.get": ({ respond }) => {
    respond(true, getRuntimePolicy(), undefined);
  },

  "agent-runtime.policy.update": ({ params, respond }) => {
    const merged = mergeRuntimePolicy(getRuntimePolicy(), params, respond);
    if (!merged) {
      return;
    }
    try {
      respond(true, replaceRuntimePolicy(merged), undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  "agent-runtime.update-governance-config": ({ params, respond }) => {
    if (!isRecord(params.config)) {
      respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, "config is required"));
      return;
    }
    const patch: Partial<GovernanceDetectorConfig> = {};
    const cfg = params.config;
    if (typeof cfg.zombieBindingDays === "number") {
      patch.zombieBindingDays = cfg.zombieBindingDays;
    }
    if (typeof cfg.orphanedAgentDays === "number") {
      patch.orphanedAgentDays = cfg.orphanedAgentDays;
    }
    if (typeof cfg.resourceOvercommitThreshold === "number") {
      patch.resourceOvercommitThreshold = cfg.resourceOvercommitThreshold;
    }
    try {
      const config = updateGovernanceConfig(patch);
      respond(true, { config }, undefined);
    } catch (err) {
      respondError(respond, err);
    }
  },

  // ── KPI ──
  "agent-runtime.get-runtime-kpi": ({ respond }) => {
    respond(true, { kpi: computeKpi() }, undefined);
  },
};
