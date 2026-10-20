/**
 * Agent Runtime Center Mock 后端 — 仅供本地开发与测试。
 *
 * 该模块实现了一个与 {@link AgentRuntimeGateway} 形状一致的内存型 Mock 后端，
 * 返回的全部数据均符合 `runtime-canonical/types.ts` 中的标准模型，可作为
 * UI 开发、单元测试与设计评审的确定性数据源。
 *
 * 严禁在生产代码路径中使用：生产环境请通过 `createAgentRuntimeGateway` 接入真实
 * GatewayBrowserClient。
 *
 * 数据建模原则：
 * - 涵盖典型的 5 个 Agent + 8 条 Binding 的混合场景
 * - 至少触发 3 类治理问题（zombie / version-drift / fallback-broken），
 *   方便 UI 在所有标签页都能展示真实业务样态
 * - 健康状态分布：1 healthy / 2 degraded / 1 unhealthy / 1 unavailable
 */

import {
  calculateRuntimeHealth,
  detectGovernanceIssues,
  type GovernanceDetectorConfig,
  type RuntimeAgent,
  type RuntimeCapabilityBinding,
  type RuntimeGovernanceIssue,
  type RuntimeHealth,
  type RuntimeLifecycle,
  type RuntimeTelemetry,
} from "../runtime-canonical/index.ts";
import type {
  AcknowledgeIssueRequest,
  AcknowledgeIssueResponse,
  CreateBindingRequest,
  CreateBindingResponse,
  DeleteBindingRequest,
  DeleteBindingResponse,
  GetAgentRequest,
  GetAgentResponse,
  GetBindingRequest,
  GetBindingResponse,
  GetGovernanceConfigRequest,
  GetGovernanceConfigResponse,
  GetHealthSummaryRequest,
  GetHealthSummaryResponse,
  GetLifecycleHistoryRequest,
  GetLifecycleHistoryResponse,
  GetRuntimeKpiRequest,
  GetRuntimeKpiResponse,
  LifecycleEvent,
  ListAgentsRequest,
  ListAgentsResponse,
  ListBindingsRequest,
  ListBindingsResponse,
  ListGovernanceIssuesRequest,
  ListGovernanceIssuesResponse,
  ListTelemetryRequest,
  ListTelemetryResponse,
  RuntimeKpiData,
  SeedRuntimeRequest,
  SeedRuntimeResponse,
  UpsertBindingRequest,
  UpsertBindingResponse,
  UpdateBindingPriorityRequest,
  UpdateBindingPriorityResponse,
  UpdateBindingStateRequest,
  UpdateBindingStateResponse,
  UpdateBindingStrategyRequest,
  UpdateBindingStrategyResponse,
  UpdateGovernanceConfigRequest,
  UpdateGovernanceConfigResponse,
  UpdateLifecycleRequest,
  UpdateLifecycleResponse,
} from "./endpoints.ts";
import type { AgentRuntimeGateway } from "./gateway-client.ts";

// ─────────────────────────────────────────────────────────────────────────
// 内部存储 — 内存表
// ─────────────────────────────────────────────────────────────────────────

const NOW = Date.now();
const MS_PER_DAY = 24 * 60 * 60 * 1_000;

type MockState = {
  agents: Map<string, RuntimeAgent>;
  bindings: Map<string, RuntimeCapabilityBinding>;
  telemetry: RuntimeTelemetry[];
  lifecycleEvents: Map<string, LifecycleEvent[]>;
  acknowledgements: Map<string, { reviewerId: string; at: number; note: string | null }>;
  governanceConfig: GovernanceDetectorConfig;
};

function makeSeedState(): MockState {
  const agents = new Map<string, RuntimeAgent>();
  const bindings = new Map<string, RuntimeCapabilityBinding>();
  const telemetry: RuntimeTelemetry[] = [];
  const lifecycleEvents = new Map<string, LifecycleEvent[]>();

  // ── Agents（5 个） ──
  const agentSpecs: Array<{
    id: string;
    name: string;
    lifecycle: RuntimeLifecycle;
    health: RuntimeHealth;
    cpu: number;
    mem: number;
    sessionCount: number;
    tenantCoverage: string[];
    lastActiveDaysAgo: number;
  }> = [
    {
      id: "agent-da-bai-guan-jia",
      name: "大白管家",
      lifecycle: "deployed",
      health: "healthy",
      cpu: 38,
      mem: 42,
      sessionCount: 24,
      tenantCoverage: ["tenant-acme"],
      lastActiveDaysAgo: 0,
    },
    {
      id: "agent-gao-ji-mi-shu",
      name: "高级秘书",
      lifecycle: "deployed",
      health: "degraded",
      cpu: 55,
      mem: 67,
      sessionCount: 5,
      tenantCoverage: ["tenant-acme"],
      lastActiveDaysAgo: 0,
    },
    {
      id: "agent-gao-mi-du-fen-xi",
      name: "高密度分析",
      lifecycle: "deployed",
      health: "degraded",
      cpu: 88,
      mem: 91,
      sessionCount: 1,
      tenantCoverage: ["tenant-acme"],
      lastActiveDaysAgo: 0,
    },
    {
      id: "agent-shi-chang-zhu-shou",
      name: "市场助手",
      lifecycle: "draining",
      health: "unhealthy",
      cpu: 12,
      mem: 18,
      sessionCount: 2,
      tenantCoverage: ["tenant-acme"],
      lastActiveDaysAgo: 1,
    },
    {
      id: "agent-skill-fu-hua",
      name: "Skill孵化",
      lifecycle: "suspended",
      health: "unavailable",
      cpu: 0,
      mem: 0,
      sessionCount: 0,
      tenantCoverage: [],
      lastActiveDaysAgo: 5,
    },
  ];

  for (const spec of agentSpecs) {
    agents.set(spec.id, {
      runtimeAgentId: spec.id,
      name: spec.name,
      runtimeVersion: "2026.3.9",
      lifecycle: spec.lifecycle,
      health: spec.health,
      tenantCoverage: spec.tenantCoverage,
      boundCapabilityCount: 0, // 由 binding 填充后再修正
      activeSessionCount: spec.sessionCount,
      resourceUsage: {
        cpuPercent: spec.cpu,
        memoryPercent: spec.mem,
        tokenBudgetUsedPercent: Math.min(100, spec.cpu / 1.2),
      },
      deployedAt: NOW - 30 * MS_PER_DAY,
      lastActiveAt: NOW - spec.lastActiveDaysAgo * MS_PER_DAY,
    });
  }

  // ── Bindings（8 条，覆盖治理问题样态） ──
  const bindingSpecs: Array<{
    id: string;
    agentId: string;
    capabilityId: string;
    capabilityName: string;
    capabilityVersion: string;
    state: RuntimeCapabilityBinding["bindingState"];
    type: RuntimeCapabilityBinding["bindingType"];
    health: RuntimeHealth;
    calls7d: number;
    successRate7d: number;
    daysSinceUpdate: number;
    fallbackBindingId: string | null;
  }> = [
    // 1) 健康主力
    {
      id: "bind-1",
      agentId: "agent-da-bai-guan-jia",
      capabilityId: "cap-customer-emotion",
      capabilityName: "客户情绪整理",
      capabilityVersion: "1.4.2",
      state: "active",
      type: "tenant-installed",
      health: "healthy",
      calls7d: 1245,
      successRate7d: 0.97,
      daysSinceUpdate: 1,
      fallbackBindingId: null,
    },
    // 2) 多人复用，但版本与 #5 漂移
    {
      id: "bind-2",
      agentId: "agent-da-bai-guan-jia",
      capabilityId: "cap-meeting-summary",
      capabilityName: "会议纪要整理",
      capabilityVersion: "2.0.0",
      state: "active",
      type: "platform-default",
      health: "healthy",
      calls7d: 412,
      successRate7d: 0.95,
      daysSinceUpdate: 2,
      fallbackBindingId: null,
    },
    // 3) 高密度分析的 active 但很久未调用 → zombie
    {
      id: "bind-3",
      agentId: "agent-gao-mi-du-fen-xi",
      capabilityId: "cap-fragmented-prompt",
      capabilityName: "碎片提示词整理",
      capabilityVersion: "1.0.0",
      state: "active",
      type: "tenant-installed",
      health: "healthy",
      calls7d: 0,
      successRate7d: 1,
      daysSinceUpdate: 60, // > 默认阈值 30
      fallbackBindingId: null,
    },
    // 4) 市场助手的 degraded binding
    {
      id: "bind-4",
      agentId: "agent-shi-chang-zhu-shou",
      capabilityId: "cap-market-radar",
      capabilityName: "市场雷达",
      capabilityVersion: "1.2.0",
      state: "degraded",
      type: "tenant-installed",
      health: "unhealthy",
      calls7d: 76,
      successRate7d: 0.55,
      daysSinceUpdate: 3,
      fallbackBindingId: "bind-fb-stale",
    },
    // 5) 与 #2 漂移：cap-meeting-summary 版本不一致
    {
      id: "bind-5",
      agentId: "agent-gao-ji-mi-shu",
      capabilityId: "cap-meeting-summary",
      capabilityName: "会议纪要整理",
      capabilityVersion: "1.7.3",
      state: "active",
      type: "platform-default",
      health: "degraded",
      calls7d: 320,
      successRate7d: 0.83,
      daysSinceUpdate: 7,
      fallbackBindingId: null,
    },
    // 6) fallback chain broken：fb 自身 disabled
    {
      id: "bind-fb-stale",
      agentId: "agent-shi-chang-zhu-shou",
      capabilityId: "cap-market-radar-fallback",
      capabilityName: "市场雷达（备选）",
      capabilityVersion: "1.0.0",
      state: "disabled",
      type: "fallback",
      health: "unavailable",
      calls7d: 0,
      successRate7d: 0,
      daysSinceUpdate: 14,
      fallbackBindingId: null,
    },
    // 7) Skill孵化 已 suspended，但留有遗留 binding（disabled）
    {
      id: "bind-7",
      agentId: "agent-skill-fu-hua",
      capabilityId: "cap-skill-incubation",
      capabilityName: "技能孵化助理",
      capabilityVersion: "0.9.1",
      state: "disabled",
      type: "platform-default",
      health: "unavailable",
      calls7d: 0,
      successRate7d: 0,
      daysSinceUpdate: 30,
      fallbackBindingId: null,
    },
    // 8) 高级秘书的 warming 状态（版本切换中）
    {
      id: "bind-8",
      agentId: "agent-gao-ji-mi-shu",
      capabilityId: "cap-summary-helper",
      capabilityName: "纪要助手",
      capabilityVersion: "3.0.0-rc.2",
      state: "warming",
      type: "dynamic-runtime",
      health: "healthy",
      calls7d: 0,
      successRate7d: 1,
      daysSinceUpdate: 0,
      fallbackBindingId: null,
    },
  ];

  for (const spec of bindingSpecs) {
    const binding: RuntimeCapabilityBinding = {
      bindingId: spec.id,
      runtimeAgentId: spec.agentId,
      capabilityId: spec.capabilityId,
      capabilityVersion: spec.capabilityVersion,
      bindingType: spec.type,
      routingPriority: 50,
      loadStrategy: spec.type === "fallback" ? "lazy" : "eager",
      bindingState: spec.state,
      healthStatus: spec.health,
      invocationMetrics: {
        calls7d: spec.calls7d,
        successRate7d: spec.successRate7d,
        avgLatencyMs: spec.health === "degraded" ? 6_500 : 800,
        p95LatencyMs: spec.health === "degraded" ? 12_000 : 1_400,
        errorCount7d: Math.round(spec.calls7d * (1 - spec.successRate7d)),
        tokenConsumption7d: spec.calls7d * 540,
      },
      policy: {
        sandbox: "strict",
        resourceQuota: "small",
        hotReloadable: spec.type !== "fallback",
      },
      fallbackBindingId: spec.fallbackBindingId,
      createdAt: NOW - 30 * MS_PER_DAY,
      updatedAt: NOW - spec.daysSinceUpdate * MS_PER_DAY,
    };
    bindings.set(binding.bindingId, binding);
  }

  // 修正 boundCapabilityCount
  for (const b of bindings.values()) {
    const a = agents.get(b.runtimeAgentId);
    if (!a) {
      continue;
    }
    a.boundCapabilityCount += 1;
  }

  // Telemetry 样本：每个 binding 一份近 7 日数据
  for (const b of bindings.values()) {
    telemetry.push({
      runtimeAgentId: b.runtimeAgentId,
      capabilityId: b.capabilityId,
      calls7d: b.invocationMetrics.calls7d,
      successRate7d: b.invocationMetrics.successRate7d,
      avgLatencyMs: b.invocationMetrics.avgLatencyMs,
      p95LatencyMs: b.invocationMetrics.p95LatencyMs,
      tokenConsumption7d: b.invocationMetrics.tokenConsumption7d,
      errorCount7d: b.invocationMetrics.errorCount7d,
      queueDepth: 0,
      memoryPressure: 0,
      lastSampleAt: NOW,
    });
  }

  // 生命周期事件：示例 1 条
  lifecycleEvents.set("agent-shi-chang-zhu-shou", [
    {
      id: "lc-evt-1",
      runtimeAgentId: "agent-shi-chang-zhu-shou",
      fromLifecycle: "deployed",
      toLifecycle: "draining",
      actor: "ops:peter",
      reason: "排空准备版本升级",
      timestamp: NOW - 6 * 60 * 60 * 1_000,
    },
  ]);

  return {
    agents,
    bindings,
    telemetry,
    lifecycleEvents,
    acknowledgements: new Map(),
    governanceConfig: {
      zombieBindingDays: 30,
      orphanedAgentDays: 30,
      resourceOvercommitThreshold: 0.9,
    },
  };
}

const state: MockState = makeSeedState();

// ─────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────

function simulateLatency(ms = 50): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 派生当前全部治理问题（含 acknowledgements 注入）。 */
function computeIssues(): RuntimeGovernanceIssue[] {
  const agents = [...state.agents.values()];
  const bindings = [...state.bindings.values()];
  const issues = detectGovernanceIssues(agents, bindings, state.governanceConfig, NOW);
  return issues.map((i) => {
    const ack = state.acknowledgements.get(i.id);
    return ack ? { ...i, acknowledgedBy: ack.reviewerId, acknowledgedAt: ack.at } : i;
  });
}

function recountHealth(
  items: Array<{ health?: RuntimeHealth; healthStatus?: RuntimeHealth }>,
): Record<RuntimeHealth, number> {
  const acc: Record<RuntimeHealth, number> = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unavailable: 0,
  };
  for (const it of items) {
    const h = it.health ?? it.healthStatus ?? "healthy";
    acc[h] += 1;
  }
  return acc;
}

// ─────────────────────────────────────────────────────────────────────────
// Mock backend factory
// ─────────────────────────────────────────────────────────────────────────

/**
 * 创建 Agent Runtime Center 的 Mock 后端。返回值与 {@link AgentRuntimeGateway}
 * 的形状一致，可直接替换真实 gateway 用于本地开发。
 */
export function createAgentRuntimeMockBackend(): AgentRuntimeGateway {
  return {
    async listAgents(req: ListAgentsRequest): Promise<ListAgentsResponse> {
      await simulateLatency();
      const q = req.searchQuery.trim().toLowerCase();
      const agents = [...state.agents.values()].filter((a) => {
        if (req.lifecycle !== null && a.lifecycle !== req.lifecycle) {
          return false;
        }
        if (req.health !== null && a.health !== req.health) {
          return false;
        }
        if (req.tenantId !== null && !a.tenantCoverage.includes(req.tenantId)) {
          return false;
        }
        if (q && !a.name.toLowerCase().includes(q)) {
          return false;
        }
        return true;
      });
      return { agents };
    },

    async getAgent(req: GetAgentRequest): Promise<GetAgentResponse> {
      await simulateLatency();
      const agent = state.agents.get(req.runtimeAgentId);
      if (!agent) {
        throw new Error(`Unknown agent: ${req.runtimeAgentId}`);
      }
      const bindings = [...state.bindings.values()].filter(
        (b) => b.runtimeAgentId === req.runtimeAgentId,
      );
      return { agent, bindings };
    },

    async listBindings(req: ListBindingsRequest): Promise<ListBindingsResponse> {
      await simulateLatency();
      const bindings = [...state.bindings.values()].filter((b) => {
        if (req.runtimeAgentId !== null && b.runtimeAgentId !== req.runtimeAgentId) {
          return false;
        }
        if (req.capabilityId !== null && b.capabilityId !== req.capabilityId) {
          return false;
        }
        if (req.bindingType !== null && b.bindingType !== req.bindingType) {
          return false;
        }
        if (req.bindingState !== null && b.bindingState !== req.bindingState) {
          return false;
        }
        if (req.health !== null && b.healthStatus !== req.health) {
          return false;
        }
        return true;
      });
      return { bindings };
    },

    async getBinding(req: GetBindingRequest): Promise<GetBindingResponse> {
      await simulateLatency();
      const binding = state.bindings.get(req.bindingId);
      if (!binding) {
        throw new Error(`Unknown binding: ${req.bindingId}`);
      }
      const agent = state.agents.get(binding.runtimeAgentId);
      return {
        binding,
        agentName: agent?.name ?? binding.runtimeAgentId,
        capabilityName: binding.capabilityId,
      };
    },

    async seed(_req: SeedRuntimeRequest): Promise<SeedRuntimeResponse> {
      await simulateLatency();
      return {
        seeded: true,
        agentCount: state.agents.size,
        bindingCount: state.bindings.size,
        tenantCount: new Set(
          [...state.agents.values()].flatMap((agent) => agent.tenantCoverage ?? []),
        ).size,
      };
    },

    async upsertBinding(req: UpsertBindingRequest): Promise<UpsertBindingResponse> {
      await simulateLatency();
      const existing = [...state.bindings.values()].find(
        (binding) =>
          binding.runtimeAgentId === req.runtimeAgentId &&
          binding.capabilityId === req.capabilityId,
      );
      const bindingId = existing?.bindingId ?? `bind-${Math.random().toString(36).slice(2, 10)}`;
      const binding: RuntimeCapabilityBinding = {
        bindingId,
        runtimeAgentId: req.runtimeAgentId,
        capabilityId: req.capabilityId,
        capabilityVersion: req.capabilityVersion,
        bindingType: req.bindingType,
        routingPriority: req.routingPriority ?? existing?.routingPriority ?? 50,
        loadStrategy: req.loadStrategy,
        bindingState: existing?.bindingState ?? "active",
        healthStatus: existing?.healthStatus ?? "healthy",
        invocationMetrics: existing?.invocationMetrics ?? {
          calls7d: 0,
          successRate7d: 1,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          errorCount7d: 0,
          tokenConsumption7d: 0,
        },
        policy: req.policy ??
          existing?.policy ?? {
            sandbox: "strict",
            resourceQuota: "small",
            hotReloadable: true,
          },
        fallbackBindingId: req.fallbackBindingId,
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
      };
      state.bindings.set(bindingId, binding);
      return { binding };
    },

    async createBinding(req: CreateBindingRequest): Promise<CreateBindingResponse> {
      await simulateLatency();
      const id = `bind-${Math.random().toString(36).slice(2, 10)}`;
      const binding: RuntimeCapabilityBinding = {
        bindingId: id,
        runtimeAgentId: req.runtimeAgentId,
        capabilityId: req.capabilityId,
        capabilityVersion: req.capabilityVersion,
        bindingType: req.bindingType,
        routingPriority: req.routingPriority ?? 50,
        loadStrategy: req.loadStrategy,
        bindingState: "active",
        healthStatus: "healthy",
        invocationMetrics: {
          calls7d: 0,
          successRate7d: 1,
          avgLatencyMs: 0,
          p95LatencyMs: 0,
          errorCount7d: 0,
          tokenConsumption7d: 0,
        },
        policy: req.policy ?? { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
        fallbackBindingId: req.fallbackBindingId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      state.bindings.set(id, binding);
      const agent = state.agents.get(req.runtimeAgentId);
      if (agent) {
        agent.boundCapabilityCount += 1;
      }
      return { binding };
    },

    async updateBindingState(req: UpdateBindingStateRequest): Promise<UpdateBindingStateResponse> {
      await simulateLatency();
      const b = state.bindings.get(req.bindingId);
      if (!b) {
        throw new Error(`Unknown binding: ${req.bindingId}`);
      }
      const next: RuntimeCapabilityBinding = {
        ...b,
        bindingState: req.bindingState,
        updatedAt: Date.now(),
      };
      state.bindings.set(b.bindingId, next);
      return { binding: next };
    },

    async updateBindingPriority(
      req: UpdateBindingPriorityRequest,
    ): Promise<UpdateBindingPriorityResponse> {
      await simulateLatency();
      const b = state.bindings.get(req.bindingId);
      if (!b) {
        throw new Error(`Unknown binding: ${req.bindingId}`);
      }
      const next: RuntimeCapabilityBinding = {
        ...b,
        routingPriority: req.routingPriority,
        updatedAt: Date.now(),
      };
      state.bindings.set(b.bindingId, next);
      return { binding: next };
    },

    async updateBindingStrategy(
      req: UpdateBindingStrategyRequest,
    ): Promise<UpdateBindingStrategyResponse> {
      await simulateLatency();
      const b = state.bindings.get(req.bindingId);
      if (!b) {
        throw new Error(`Unknown binding: ${req.bindingId}`);
      }
      const next: RuntimeCapabilityBinding = {
        ...b,
        loadStrategy: req.loadStrategy,
        updatedAt: Date.now(),
      };
      state.bindings.set(b.bindingId, next);
      return { binding: next };
    },

    async deleteBinding(req: DeleteBindingRequest): Promise<DeleteBindingResponse> {
      await simulateLatency();
      const had = state.bindings.delete(req.bindingId);
      return { bindingId: req.bindingId, deleted: had };
    },

    async listTelemetry(req: ListTelemetryRequest): Promise<ListTelemetryResponse> {
      await simulateLatency();
      const samples = state.telemetry.filter((t) => {
        if (req.runtimeAgentId !== null && t.runtimeAgentId !== req.runtimeAgentId) {
          return false;
        }
        if (req.capabilityId !== null && t.capabilityId !== req.capabilityId) {
          return false;
        }
        return true;
      });
      return { samples };
    },

    async getHealthSummary(_req: GetHealthSummaryRequest): Promise<GetHealthSummaryResponse> {
      await simulateLatency();
      const agents = [...state.agents.values()];
      const bindings = [...state.bindings.values()];
      const agentCountByHealth = recountHealth(agents);
      const bindingCountByHealth = recountHealth(bindings);
      const unhealthyAgents = agents.filter((a) => a.health !== "healthy");
      const unhealthyBindings = bindings.filter((b) => b.healthStatus !== "healthy");
      return {
        agentCountByHealth,
        bindingCountByHealth,
        unhealthyAgents,
        unhealthyBindings,
      };
    },

    async updateLifecycle(req: UpdateLifecycleRequest): Promise<UpdateLifecycleResponse> {
      await simulateLatency();
      const a = state.agents.get(req.runtimeAgentId);
      if (!a) {
        throw new Error(`Unknown agent: ${req.runtimeAgentId}`);
      }
      // Mock 后端不在此处校验状态机；UI 控制器会先调用 validateTransition 拦截非法转换。
      const next: RuntimeAgent = { ...a, lifecycle: req.targetLifecycle };
      state.agents.set(a.runtimeAgentId, next);
      const events = state.lifecycleEvents.get(a.runtimeAgentId) ?? [];
      events.push({
        id: `lc-evt-${Math.random().toString(36).slice(2, 8)}`,
        runtimeAgentId: a.runtimeAgentId,
        fromLifecycle: a.lifecycle,
        toLifecycle: req.targetLifecycle,
        actor: "ops:mock",
        reason: req.reason,
        timestamp: Date.now(),
      });
      state.lifecycleEvents.set(a.runtimeAgentId, events);
      const affectedBindings = [...state.bindings.values()].filter(
        (b) => b.runtimeAgentId === a.runtimeAgentId,
      );
      return {
        agent: next,
        rejectionReason: null,
        impact: {
          affectedBindingCount: affectedBindings.length,
          activeSessionCount: a.activeSessionCount,
          affectedTenantCount: a.tenantCoverage.length,
          triggersDownstreamNotification:
            req.targetLifecycle === "deprecated" || req.targetLifecycle === "archived",
        },
      };
    },

    async getLifecycleHistory(
      req: GetLifecycleHistoryRequest,
    ): Promise<GetLifecycleHistoryResponse> {
      await simulateLatency();
      return { events: state.lifecycleEvents.get(req.runtimeAgentId) ?? [] };
    },

    async listGovernanceIssues(
      req: ListGovernanceIssuesRequest,
    ): Promise<ListGovernanceIssuesResponse> {
      await simulateLatency();
      const all = computeIssues();
      const issues = all.filter((i) => {
        if (req.category !== null && i.category !== req.category) {
          return false;
        }
        if (req.severity !== null && i.severity !== req.severity) {
          return false;
        }
        if (!req.includeAcknowledged && i.acknowledgedBy !== null) {
          return false;
        }
        return true;
      });
      return { issues };
    },

    async acknowledgeIssue(req: AcknowledgeIssueRequest): Promise<AcknowledgeIssueResponse> {
      await simulateLatency();
      state.acknowledgements.set(req.issueId, {
        reviewerId: req.reviewerId,
        at: Date.now(),
        note: req.note,
      });
      const all = computeIssues();
      const issue = all.find((i) => i.id === req.issueId);
      if (!issue) {
        throw new Error(`Unknown issue: ${req.issueId}`);
      }
      return { issue };
    },

    async getGovernanceConfig(
      _req: GetGovernanceConfigRequest,
    ): Promise<GetGovernanceConfigResponse> {
      await simulateLatency();
      return { config: state.governanceConfig };
    },

    async updateGovernanceConfig(
      req: UpdateGovernanceConfigRequest,
    ): Promise<UpdateGovernanceConfigResponse> {
      await simulateLatency();
      state.governanceConfig = { ...state.governanceConfig, ...req.config };
      return { config: state.governanceConfig };
    },

    async getRuntimeKpi(_req: GetRuntimeKpiRequest): Promise<GetRuntimeKpiResponse> {
      await simulateLatency();
      const agents = [...state.agents.values()];
      const bindings = [...state.bindings.values()];

      const agentCountByLifecycle: Record<RuntimeLifecycle, number> = {
        deployed: 0,
        draining: 0,
        suspended: 0,
        deprecated: 0,
        archived: 0,
      };
      for (const a of agents) {
        agentCountByLifecycle[a.lifecycle] += 1;
      }

      const bindingCountByState: RuntimeKpiData["bindingCountByState"] = {
        active: 0,
        warming: 0,
        degraded: 0,
        disabled: 0,
      };
      const bindingCountByType: RuntimeKpiData["bindingCountByType"] = {
        "tenant-installed": 0,
        "platform-default": 0,
        "dynamic-runtime": 0,
        fallback: 0,
      };
      for (const b of bindings) {
        bindingCountByState[b.bindingState] += 1;
        bindingCountByType[b.bindingType] += 1;
      }

      const tenantSet = new Set<string>();
      for (const a of agents) {
        for (const t of a.tenantCoverage) {
          tenantSet.add(t);
        }
      }

      const healthyCount = agents.filter((a) => a.health === "healthy").length;
      const sessionTotal = agents.reduce((s, a) => s + a.activeSessionCount, 0);

      const kpi: RuntimeKpiData = {
        agentCountTotal: agents.length,
        agentCountByLifecycle,
        bindingCountTotal: bindings.length,
        bindingCountByState,
        bindingCountByType,
        avgBindingsPerAgent:
          agents.length === 0 ? 0 : Math.round((bindings.length / agents.length) * 10) / 10,
        healthyAgentRatio: agents.length === 0 ? 0 : healthyCount / agents.length,
        tenantCoverageTotal: tenantSet.size,
        activeSessionCount: sessionTotal,
      };
      return { kpi };
    },
  };
}

// 导出仅供测试 / 调试使用的内部状态访问器，便于单测重置 / 注入数据。
// 生产路径不应使用以下导出。
export const __mockBackendInternals = {
  reset(): void {
    const fresh = makeSeedState();
    state.agents = fresh.agents;
    state.bindings = fresh.bindings;
    state.telemetry = fresh.telemetry;
    state.lifecycleEvents = fresh.lifecycleEvents;
    state.acknowledgements = fresh.acknowledgements;
    state.governanceConfig = fresh.governanceConfig;
  },
  state,
};

// 抑制未使用变量告警：calculateRuntimeHealth 是公开 API，留作后续扩展。
void calculateRuntimeHealth;
