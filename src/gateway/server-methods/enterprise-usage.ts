import { loadConfig } from "../../config/config.js";
import { maybeSeedAgentRuntimeFromPlatformState } from "../agent-runtime-seed.js";
import {
  listAgents,
  listBindings,
  listTelemetry,
  recordIssueAcknowledgement,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeTelemetry,
} from "../agent-runtime-store.js";
import {
  getRegistryEntry,
  listRegistry,
  type GovernanceManifest,
  type GovernanceRegistryEntry,
} from "../capability-governance-store.js";
import { loadPlatformAuthStore, resolvePlatformAuthConfig } from "../platform-auth.js";
import { resolveAuthoritativeEnterpriseScopeForClient } from "../platform-auth/active-membership-scope.js";
import {
  isRecord,
  numberValue,
  respondInvalid,
  respondUnavailable,
  stringValue,
} from "./request-params.js";
import type { GatewayClient, GatewayRequestHandlers } from "./types.js";

type HealthStatus = "效果稳定" | "偶尔不理想" | "建议优化" | "已停用";
type HealthStatusNoData = "暂无数据";
type InstallRelationBusinessSource = "员工沉淀" | "企业发布";
type InstallRelationStatus = "正常" | "待优化" | "已停用";
type AnalyticsWindow = 7 | 30 | 90;

type GovernanceConfig = {
  lowEfficiency: { minExecutions: number; maxSuccessRate: number };
  zombie: { minInstallDays: number };
  conflict: { minSimilarity: number };
};

type GovernanceIssue = {
  issueId: string;
  type: "低效能力" | "未使用能力" | "冲突能力";
  capabilityId: string;
  robotId: string;
  description: string;
  suggestion: "卸载" | "重新整理能力" | "转移到其他机器人";
  evidence: {
    executions30d?: number;
    successRate?: number;
    installDays?: number;
    similarity?: number;
    conflictWith?: string[];
  };
  detectedAt: number;
};

type InstallRelationEnhanced = {
  id: string;
  capabilityId: string;
  capabilityName: string;
  robotId: string;
  robotName: string;
  installedAt: number;
  source: InstallRelationBusinessSource;
  usageStats: {
    executions30d: number;
    successRate: number;
  };
  status: InstallRelationStatus;
};

type EnterpriseUsageContext = {
  agents: RuntimeAgent[];
  bindings: RuntimeCapabilityBinding[];
  telemetry: RuntimeTelemetry[];
  capabilityNames: Map<string, string>;
  registryById: Map<string, GovernanceRegistryEntry>;
};

const DEFAULT_GOVERNANCE_CONFIG: GovernanceConfig = {
  lowEfficiency: { minExecutions: 50, maxSuccessRate: 0.7 },
  zombie: { minInstallDays: 30 },
  conflict: { minSimilarity: 0.8 },
};

let usageGovernanceConfig: GovernanceConfig = {
  lowEfficiency: { ...DEFAULT_GOVERNANCE_CONFIG.lowEfficiency },
  zombie: { ...DEFAULT_GOVERNANCE_CONFIG.zombie },
  conflict: { ...DEFAULT_GOVERNANCE_CONFIG.conflict },
};

async function resolveUsageTenantId(client: GatewayClient | null): Promise<string | null> {
  const cfg = loadConfig();
  const authConfig = resolvePlatformAuthConfig(cfg.gateway?.auth?.trustedProxy);
  if (!authConfig?.enabled) {
    return null;
  }
  try {
    const store = await loadPlatformAuthStore(authConfig);
    const scope = resolveAuthoritativeEnterpriseScopeForClient({
      store,
      client,
      canonicalize: (value) => value?.trim() || null,
    });
    return scope.kind === "authoritative" ? scope.enterpriseId : null;
  } catch {
    return null;
  }
}

async function loadContext(client: GatewayClient | null): Promise<EnterpriseUsageContext> {
  // Ensure agent-runtime-store is seeded from platform state before reading.
  // Without this, the store may be empty on first load, causing the page to error.
  const cfg = loadConfig();
  await maybeSeedAgentRuntimeFromPlatformState({
    cfg,
    trustedProxy: cfg.gateway?.auth?.trustedProxy,
  });

  const tenantId = await resolveUsageTenantId(client);
  const agents = tenantId
    ? listAgents({
        lifecycle: null,
        health: null,
        tenantId,
        searchQuery: "",
      })
    : [];
  const agentIds = new Set(agents.map((agent) => agent.runtimeAgentId));
  const bindings = listBindings({
    runtimeAgentId: null,
    capabilityId: null,
    bindingType: null,
    bindingState: null,
    health: null,
  }).filter((binding) => agentIds.has(binding.runtimeAgentId));
  const telemetry = listTelemetry({
    runtimeAgentId: null,
    capabilityId: null,
    window: "30d",
  }).filter((sample) => agentIds.has(sample.runtimeAgentId));
  const registry = listRegistry();
  return {
    agents,
    bindings,
    telemetry,
    capabilityNames: new Map(registry.map((entry) => [entry.manifest.id, entry.manifest.name])),
    registryById: new Map(registry.map((entry) => [entry.manifest.id, entry])),
  };
}

function pageInput(raw: unknown): { page: number; pageSize: 10 | 20 | 50 } {
  const record = isRecord(raw) ? raw : {};
  const pageRaw = record.page;
  const page = typeof pageRaw === "number" && Number.isFinite(pageRaw) ? Math.max(1, pageRaw) : 1;
  const pageSizeRaw = record.pageSize;
  const pageSize: 10 | 20 | 50 =
    pageSizeRaw === 20 || pageSizeRaw === 50 || pageSizeRaw === 10 ? pageSizeRaw : 10;
  return { page: Math.floor(page), pageSize };
}

function paginate<T>(
  items: T[],
  rawPagination: unknown,
): { items: T[]; pagination: { currentPage: number; pageSize: 10 | 20 | 50; totalItems: number } } {
  const { page, pageSize } = pageInput(rawPagination);
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    pagination: { currentPage, pageSize, totalItems },
  };
}

function healthToBusiness(raw: RuntimeAgent["health"]): HealthStatus {
  switch (raw) {
    case "healthy":
      return "效果稳定";
    case "degraded":
      return "偶尔不理想";
    case "unhealthy":
      return "建议优化";
    case "unavailable":
      return "已停用";
  }
}

function relationStatus(binding: RuntimeCapabilityBinding): InstallRelationStatus {
  if (binding.bindingState === "disabled" || binding.healthStatus === "unavailable") {
    return "已停用";
  }
  if (binding.healthStatus === "unhealthy") {
    return "待优化";
  }
  return "正常";
}

function relationSource(binding: RuntimeCapabilityBinding): InstallRelationBusinessSource {
  return binding.bindingType === "tenant-installed" ? "员工沉淀" : "企业发布";
}

function latestTelemetry(
  ctx: EnterpriseUsageContext,
  binding: RuntimeCapabilityBinding,
): RuntimeTelemetry | null {
  return (
    ctx.telemetry
      .filter(
        (sample) =>
          sample.runtimeAgentId === binding.runtimeAgentId &&
          sample.capabilityId === binding.capabilityId,
      )
      .toSorted((a, b) => b.lastSampleAt - a.lastSampleAt)[0] ?? null
  );
}

function bindingCalls7d(ctx: EnterpriseUsageContext, binding: RuntimeCapabilityBinding): number {
  return latestTelemetry(ctx, binding)?.calls7d ?? binding.invocationMetrics.calls7d;
}

function bindingSuccessRate(
  ctx: EnterpriseUsageContext,
  binding: RuntimeCapabilityBinding,
): number {
  return latestTelemetry(ctx, binding)?.successRate7d ?? binding.invocationMetrics.successRate7d;
}

function bindingExecutions30d(
  ctx: EnterpriseUsageContext,
  binding: RuntimeCapabilityBinding,
): number {
  return Math.max(0, Math.round(bindingCalls7d(ctx, binding) * 4));
}

function weightedSuccess(
  ctx: EnterpriseUsageContext,
  bindings: RuntimeCapabilityBinding[],
): number {
  const totalCalls = bindings.reduce((sum, binding) => sum + bindingExecutions30d(ctx, binding), 0);
  if (totalCalls <= 0) {
    return 0;
  }
  const weighted = bindings.reduce(
    (sum, binding) => sum + bindingExecutions30d(ctx, binding) * bindingSuccessRate(ctx, binding),
    0,
  );
  return weighted / totalCalls;
}

function findRegistryEntry(capabilityId: string): GovernanceRegistryEntry | null {
  return (
    getRegistryEntry(capabilityId) ??
    listRegistry().find(
      (entry) => entry.manifest.id === capabilityId || entry.manifest.skillKey === capabilityId,
    ) ??
    null
  );
}

function capabilityName(ctx: EnterpriseUsageContext, capabilityId: string): string {
  return (
    ctx.capabilityNames.get(capabilityId) ??
    findRegistryEntry(capabilityId)?.manifest.name ??
    "未知能力"
  );
}

function relationFromBinding(
  binding: RuntimeCapabilityBinding,
  agent: RuntimeAgent,
  ctx: EnterpriseUsageContext,
): InstallRelationEnhanced {
  return {
    id: binding.bindingId,
    capabilityId: binding.capabilityId,
    capabilityName: capabilityName(ctx, binding.capabilityId),
    robotId: agent.runtimeAgentId,
    robotName: agent.name,
    installedAt: binding.createdAt,
    source: relationSource(binding),
    usageStats: {
      executions30d: bindingExecutions30d(ctx, binding),
      successRate: bindingSuccessRate(ctx, binding),
    },
    status: relationStatus(binding),
  };
}

function agentBindings(
  ctx: EnterpriseUsageContext,
  runtimeAgentId: string,
): RuntimeCapabilityBinding[] {
  return ctx.bindings.filter((binding) => binding.runtimeAgentId === runtimeAgentId);
}

function robotUsageRow(agent: RuntimeAgent, ctx: EnterpriseUsageContext) {
  const bindings = agentBindings(ctx, agent.runtimeAgentId);
  const activeBindings = bindings.filter((binding) => relationStatus(binding) !== "已停用");
  const capabilityCount = new Set(activeBindings.map((binding) => binding.capabilityId)).size;
  const monthlyExecutions = bindings.reduce(
    (sum, binding) => sum + bindingExecutions30d(ctx, binding),
    0,
  );
  const topCapabilities = activeBindings
    .toSorted((a, b) => bindingExecutions30d(ctx, b) - bindingExecutions30d(ctx, a))
    .map((binding) => capabilityName(ctx, binding.capabilityId))
    .filter((name, index, arr) => arr.indexOf(name) === index)
    .slice(0, 3);
  return {
    robotId: agent.runtimeAgentId,
    robotName: agent.name,
    capabilityCount,
    monthlyExecutions,
    employeeCoverage: activeEmployeeCoverage(agent, monthlyExecutions),
    successRate: weightedSuccess(ctx, bindings),
    healthStatus: healthToBusiness(agent.health) as HealthStatus | HealthStatusNoData,
    topCapabilities,
  };
}

function inExecutionRange(value: number, range: string): boolean {
  if (range === "<100") {
    return value < 100;
  }
  if (range === "100-1000") {
    return value >= 100 && value <= 1000;
  }
  if (range === ">1000") {
    return value > 1000;
  }
  return true;
}

function dateSeries(days: number): string[] {
  const now = new Date();
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (days - index - 1));
    return date.toISOString().slice(0, 10);
  });
}

function distributeTotal(total: number, days: number): number[] {
  if (days <= 0) {
    return [];
  }
  const base = Math.floor(total / days);
  const remainder = total % days;
  return Array.from({ length: days }, (_, index) => base + (index >= days - remainder ? 1 : 0));
}

function analyticsWindow(value: unknown): AnalyticsWindow {
  return value === 7 || value === 90 || value === 30 ? value : 30;
}

function safeConfig(raw: unknown): GovernanceConfig {
  if (!isRecord(raw)) {
    return usageGovernanceConfig;
  }
  return mergeGovernanceConfig(usageGovernanceConfig, raw);
}

function optionalNumber(value: unknown): number | undefined {
  return numberValue(value) ?? undefined;
}

function mergeGovernanceConfig(
  base: GovernanceConfig,
  patch: Record<string, unknown>,
): GovernanceConfig {
  const lowEfficiency = isRecord(patch.lowEfficiency) ? patch.lowEfficiency : {};
  const zombie = isRecord(patch.zombie) ? patch.zombie : {};
  const conflict = isRecord(patch.conflict) ? patch.conflict : {};
  return {
    lowEfficiency: {
      minExecutions:
        optionalNumber(lowEfficiency.minExecutions) ?? base.lowEfficiency.minExecutions,
      maxSuccessRate:
        optionalNumber(lowEfficiency.maxSuccessRate) ?? base.lowEfficiency.maxSuccessRate,
    },
    zombie: {
      minInstallDays: optionalNumber(zombie.minInstallDays) ?? base.zombie.minInstallDays,
    },
    conflict: {
      minSimilarity: optionalNumber(conflict.minSimilarity) ?? base.conflict.minSimilarity,
    },
  };
}

function manifestDomain(manifest: GovernanceManifest): string {
  const categoryId = typeof manifest.categoryId === "string" ? manifest.categoryId : "";
  const haystack = [
    manifest.name,
    manifest.skillKey,
    manifest.description,
    manifest.descriptionZh ?? "",
    categoryId,
  ]
    .join(" ")
    .toLowerCase();
  if (/(sales|crm|客户|商机|销售|营销)/i.test(haystack)) {
    return "销售";
  }
  if (/(hr|recruit|招聘|面试|人事|员工)/i.test(haystack)) {
    return "HR";
  }
  if (/(support|ticket|客服|工单|投诉)/i.test(haystack)) {
    return "客服";
  }
  if (/(finance|invoice|pdf|财务|发票|报销|费用)/i.test(haystack)) {
    return "财务";
  }
  if (/(legal|contract|法务|合同|合规)/i.test(haystack)) {
    return "法务";
  }
  return "数据分析";
}

function words(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/u)
      .filter((part) => part.length >= 2),
  );
}

function activeEmployeeCoverage(agent: RuntimeAgent, monthlyExecutions: number): number {
  return monthlyExecutions > 0 ? Math.max(0, agent.activeSessionCount) : 0;
}

function normalizeReviewerId(client: GatewayClient | null): string {
  return client?.user?.trim().toLowerCase() || "enterprise-admin";
}

function similarity(left: string, right: string): number {
  const a = words(left);
  const b = words(right);
  if (a.size === 0 || b.size === 0) {
    return 0;
  }
  const intersection = [...a].filter((entry) => b.has(entry)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function installDays(relation: InstallRelationEnhanced, now: number): number {
  return Math.max(0, Math.floor((now - relation.installedAt) / (24 * 60 * 60 * 1000)));
}

function detectUsageIssues(
  ctx: EnterpriseUsageContext,
  config: GovernanceConfig,
): {
  lowEfficiency: GovernanceIssue[];
  zombie: GovernanceIssue[];
  conflict: GovernanceIssue[];
} {
  const now = Date.now();
  const agents = new Map(ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const));
  const relations = ctx.bindings
    .map((binding) => {
      const agent = agents.get(binding.runtimeAgentId);
      return agent ? relationFromBinding(binding, agent, ctx) : null;
    })
    .filter((relation): relation is InstallRelationEnhanced => relation !== null);
  const lowEfficiency: GovernanceIssue[] = [];
  const zombie: GovernanceIssue[] = [];
  for (const relation of relations) {
    const executions30d = relation.usageStats.executions30d;
    const successRate = relation.usageStats.successRate;
    if (
      executions30d > config.lowEfficiency.minExecutions &&
      successRate < config.lowEfficiency.maxSuccessRate
    ) {
      lowEfficiency.push({
        issueId: `低效能力:${relation.capabilityId}:${relation.robotId}`,
        type: "低效能力",
        capabilityId: relation.capabilityId,
        robotId: relation.robotId,
        description: `${relation.capabilityName} 最近使用效果偏低，建议重新整理或优化说明。`,
        suggestion: "重新整理能力",
        evidence: { executions30d, successRate },
        detectedAt: now,
      });
    }
    const days = installDays(relation, now);
    if (executions30d === 0 && days > config.zombie.minInstallDays) {
      zombie.push({
        issueId: `未使用能力:${relation.capabilityId}:${relation.robotId}`,
        type: "未使用能力",
        capabilityId: relation.capabilityId,
        robotId: relation.robotId,
        description: `${relation.capabilityName} 已安装 ${days} 天但暂无使用记录，可考虑卸载。`,
        suggestion: "卸载",
        evidence: { executions30d, installDays: days },
        detectedAt: now,
      });
    }
  }

  const conflict: GovernanceIssue[] = [];
  const byRobot = new Map<string, InstallRelationEnhanced[]>();
  for (const relation of relations) {
    byRobot.set(relation.robotId, [...(byRobot.get(relation.robotId) ?? []), relation]);
  }
  for (const [robotId, robotRelations] of byRobot) {
    for (let i = 0; i < robotRelations.length; i += 1) {
      for (let j = i + 1; j < robotRelations.length; j += 1) {
        const left = robotRelations[i];
        const right = robotRelations[j];
        if (!left || !right) {
          continue;
        }
        const leftEntry = ctx.registryById.get(left.capabilityId);
        const rightEntry = ctx.registryById.get(right.capabilityId);
        if (!leftEntry || !rightEntry) {
          continue;
        }
        if (manifestDomain(leftEntry.manifest) !== manifestDomain(rightEntry.manifest)) {
          continue;
        }
        const score = similarity(
          `${leftEntry.manifest.name} ${leftEntry.manifest.description}`,
          `${rightEntry.manifest.name} ${rightEntry.manifest.description}`,
        );
        if (score < config.conflict.minSimilarity) {
          continue;
        }
        conflict.push({
          issueId: `冲突能力:${left.capabilityId}:${robotId}`,
          type: "冲突能力",
          capabilityId: left.capabilityId,
          robotId,
          description: `${left.capabilityName} 与 ${right.capabilityName} 场景相近，建议确认保留策略。`,
          suggestion: "转移到其他机器人",
          evidence: { similarity: score, conflictWith: [right.capabilityId] },
          detectedAt: now,
        });
      }
    }
  }
  return { lowEfficiency, zombie, conflict };
}

export const enterpriseUsageHandlers: GatewayRequestHandlers = {
  "enterprise-usage.list-robot-capability-views": async ({ client, params, respond }) => {
    try {
      const ctx = await loadContext(client);
      const allRows = ctx.agents.map((agent) => robotUsageRow(agent, ctx));
      const kpiExecutions = allRows.reduce((sum, row) => sum + row.monthlyExecutions, 0);
      const robotsWithUsage = allRows.filter((row) => row.monthlyExecutions > 0);
      const kpis = {
        totalRobots: ctx.agents.length,
        totalMonthlyExecutions: kpiExecutions,
        totalEmployeeCoverage: allRows.reduce((sum, row) => sum + row.employeeCoverage, 0),
        averageSuccessRate:
          robotsWithUsage.length === 0
            ? 0
            : robotsWithUsage.reduce((sum, row) => sum + row.successRate, 0) /
              robotsWithUsage.length,
      };
      const filters = isRecord(params.filters) ? params.filters : {};
      const nameQuery = stringValue(filters.nameQuery)?.toLowerCase() ?? "";
      const healthStatus =
        filters.healthStatus === "效果稳定" ||
        filters.healthStatus === "偶尔不理想" ||
        filters.healthStatus === "建议优化" ||
        filters.healthStatus === "已停用"
          ? filters.healthStatus
          : null;
      const range = stringValue(filters.monthlyExecutionsRange) ?? "全部";
      const filtered = allRows.filter((row) => {
        if (nameQuery && !row.robotName.toLowerCase().includes(nameQuery)) {
          return false;
        }
        if (healthStatus && row.healthStatus !== healthStatus) {
          return false;
        }
        return inExecutionRange(row.monthlyExecutions, range);
      });
      const sorting = isRecord(params.sorting) ? params.sorting : {};
      const field =
        sorting.field === "capabilityCount" ||
        sorting.field === "employeeCoverage" ||
        sorting.field === "successRate"
          ? sorting.field
          : "monthlyExecutions";
      const direction = sorting.direction === "asc" ? 1 : -1;
      const sorted = filtered.toSorted((a, b) => (a[field] - b[field]) * direction);
      respond(true, { ...paginate(sorted, params.pagination), kpis });
    } catch {
      // Graceful fallback: return empty data instead of an error so the UI
      // shows an empty state ("0 robots") rather than "加载失败，请重试".
      respond(true, {
        items: [],
        pagination: { currentPage: 1, pageSize: 10, totalItems: 0 },
        kpis: {
          totalRobots: 0,
          totalMonthlyExecutions: 0,
          totalEmployeeCoverage: 0,
          averageSuccessRate: 0,
        },
      });
    }
  },

  "enterprise-usage.get-robot-detail": async ({ client, params, respond }) => {
    const robotId = stringValue(params.robotId);
    if (!robotId) {
      respondInvalid(respond, "robotId is required");
      return;
    }
    try {
      const ctx = await loadContext(client);
      const agent = ctx.agents.find((candidate) => candidate.runtimeAgentId === robotId);
      if (!agent) {
        respondInvalid(respond, `Unknown robot: ${robotId}`);
        return;
      }
      const bindings = agentBindings(ctx, agent.runtimeAgentId);
      const capabilities = bindings.map((binding) => ({
        capabilityId: binding.capabilityId,
        capabilityName: capabilityName(ctx, binding.capabilityId),
        monthlyExecutions: bindingExecutions30d(ctx, binding),
        successRate: bindingSuccessRate(ctx, binding),
      }));
      const totalExecutions = capabilities.reduce((sum, item) => sum + item.monthlyExecutions, 0);
      respond(true, {
        basic: {
          robotId: agent.runtimeAgentId,
          robotName: agent.name,
          healthStatus: healthToBusiness(agent.health),
          lastActiveAt: agent.lastActiveAt,
        },
        capabilities,
        trend30d: {
          dates: dateSeries(30),
          dailyExecutions: distributeTotal(totalExecutions, 30),
        },
        topCapabilities: capabilities
          .toSorted((a, b) => b.monthlyExecutions - a.monthlyExecutions)
          .map((item) => item.capabilityName)
          .slice(0, 3),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-usage.get-analytics": async ({ client, params, respond }) => {
    try {
      const ctx = await loadContext(client);
      const windowDays = analyticsWindow(params.window);
      const scale = windowDays / 7;
      const totalExecutions = Math.round(
        ctx.bindings.reduce((sum, binding) => sum + bindingCalls7d(ctx, binding) * scale, 0),
      );
      const successRate = weightedSuccess(ctx, ctx.bindings);
      const coveredRobots = new Set(
        ctx.bindings
          .filter((binding) => bindingCalls7d(ctx, binding) > 0)
          .map((binding) => binding.runtimeAgentId),
      ).size;
      const coveredRobotIds = new Set(
        ctx.bindings
          .filter((binding) => bindingCalls7d(ctx, binding) > 0)
          .map((binding) => binding.runtimeAgentId),
      );
      const agentsById = new Map(ctx.agents.map((agent) => [agent.runtimeAgentId, agent] as const));
      const coveredEmployees = [...coveredRobotIds].reduce(
        (sum, robotId) => sum + (agentsById.get(robotId)?.activeSessionCount ?? 0),
        0,
      );
      const topByCapability = new Map<
        string,
        {
          capabilityId: string;
          capabilityName: string;
          monthlyExecutions: number;
          successRate: number;
          robots: Set<string>;
        }
      >();
      for (const binding of ctx.bindings) {
        const current = topByCapability.get(binding.capabilityId) ?? {
          capabilityId: binding.capabilityId,
          capabilityName: capabilityName(ctx, binding.capabilityId),
          monthlyExecutions: 0,
          successRate: 0,
          robots: new Set<string>(),
        };
        current.monthlyExecutions += Math.round(bindingCalls7d(ctx, binding) * scale);
        current.successRate = Math.max(current.successRate, bindingSuccessRate(ctx, binding));
        current.robots.add(binding.runtimeAgentId);
        topByCapability.set(binding.capabilityId, current);
      }
      const dates = dateSeries(windowDays);
      respond(true, {
        kpis: {
          totalMonthlyExecutions: {
            current: totalExecutions,
            previousMonthChange: 0,
            previousMonthPercentage: 0,
          },
          coveredRobots: {
            current: coveredRobots,
            previousMonthChange: 0,
            previousMonthPercentage: 0,
          },
          coveredEmployees: {
            current: coveredEmployees,
            previousMonthChange: 0,
            previousMonthPercentage: 0,
          },
          averageSuccessRate: {
            current: successRate,
            previousMonthChange: 0,
            previousMonthPercentage: 0,
          },
        },
        trendExecutions: { dates, values: distributeTotal(totalExecutions, windowDays) },
        trendCapabilityReuse: {
          dates,
          values: distributeTotal(
            new Set(ctx.bindings.map((binding) => binding.capabilityId)).size,
            windowDays,
          ),
        },
        topCapabilities: [...topByCapability.values()]
          .toSorted((a, b) => b.monthlyExecutions - a.monthlyExecutions)
          .slice(0, 20)
          .map((entry) => ({
            capabilityId: entry.capabilityId,
            capabilityName: entry.capabilityName,
            monthlyExecutions: entry.monthlyExecutions,
            successRate: entry.successRate,
            coveredRobots: entry.robots.size,
          })),
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-usage.detect-governance": async ({ client, params, respond }) => {
    try {
      const ctx = await loadContext(client);
      respond(true, detectUsageIssues(ctx, safeConfig(params.config)));
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  "enterprise-usage.acknowledge-governance": ({ client, params, respond }) => {
    const issueId = stringValue(params.issueId);
    if (!issueId) {
      respondInvalid(respond, "issueId is required");
      return;
    }
    recordIssueAcknowledgement({
      issueId,
      reviewerId: normalizeReviewerId(client),
      note: stringValue(params.note),
    });
    respond(true, { acknowledged: true });
  },

  "enterprise-usage.update-governance-config": ({ params, respond }) => {
    const patch = isRecord(params.config) ? params.config : {};
    usageGovernanceConfig = mergeGovernanceConfig(usageGovernanceConfig, patch);
    respond(true, { config: usageGovernanceConfig });
  },
};
