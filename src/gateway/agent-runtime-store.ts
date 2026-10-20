/**
 * Agent Runtime Store — Platform Agent Runtime Center 的后端持久化层。
 *
 * 提供 JSON-file backed 的 in-memory store，与 `skill-lifecycle-store.ts`、
 * `capability-governance-store.ts` 等模块同构：
 * - 启动时从 `~/.openclaw/agent-runtime/store.json` 加载（不存在则用 seed 初始化）
 * - 所有写操作同步刷盘（debounce + best-effort）
 * - 文件损坏时回退到空状态并打印警告，不抛错
 *
 * 数据模型：
 * - `runtime_agents`     Agent Runtime 实例
 * - `runtime_bindings`   Capability Binding 关联
 * - `governance_acks`    治理问题 Acknowledge 记录
 * - `governance_config`  治理检测阈值（可被 update-governance-config 覆盖）
 * - `lifecycle_events`   生命周期事件历史
 *
 * 严格约束：
 * - 本模块**只**承载 Runtime Canonical 数据，不承载企业端 / 员工端业务字段
 * - 所有公共函数为同步纯 IO（readFileSync / writeFileSync），与同模块其他 store 保持一致
 * - 类型与 ui/src/ui/capability/runtime-canonical/types.ts 中的字面量保持完全一致
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../utils.js";

// ─────────────────────────────────────────────────────────────────────────
// 类型镜像（与 UI 端 runtime-canonical/types.ts 保持字面量一致）
// ─────────────────────────────────────────────────────────────────────────

export type RuntimeLifecycle = "deployed" | "draining" | "suspended" | "deprecated" | "archived";

export type RuntimeHealth = "healthy" | "degraded" | "unhealthy" | "unavailable";

export type BindingType =
  | "tenant-installed"
  | "platform-default"
  | "dynamic-runtime"
  | "fallback"
  | "skill";

export type LoadStrategy = "eager" | "lazy" | "on-demand";

export type BindingState = "active" | "warming" | "degraded" | "disabled";

export type BindingPolicy = {
  sandbox: string;
  resourceQuota: string;
  hotReloadable: boolean;
};

export type BindingInvocationMetrics = {
  calls7d: number;
  successRate7d: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  errorCount7d: number;
  tokenConsumption7d: number;
};

export type RuntimeAgent = {
  runtimeAgentId: string;
  name: string;
  runtimeVersion: string;
  lifecycle: RuntimeLifecycle;
  health: RuntimeHealth;
  tenantCoverage: string[];
  boundCapabilityCount: number;
  activeSessionCount: number;
  resourceUsage: {
    cpuPercent: number;
    memoryPercent: number;
    tokenBudgetUsedPercent: number;
  };
  deployedAt: number;
  lastActiveAt: number;
};

export type TenantInstallSource =
  | "platform-marketplace"
  | "enterprise-distributed"
  | "external-local"
  | "dabai-proxy"
  | "robot-self";
export type ConfigurationState = "not-required" | "pending" | "complete";
export type GovernanceState = "pending-review" | "approved" | "restricted" | "disabled";

export type RuntimeCapabilityBinding = {
  bindingId: string;
  runtimeAgentId: string;
  capabilityId: string;
  capabilityVersion: string;
  bindingType: BindingType;
  routingPriority: number;
  loadStrategy: LoadStrategy;
  bindingState: BindingState;
  healthStatus: RuntimeHealth;
  invocationMetrics: BindingInvocationMetrics;
  policy: BindingPolicy;
  fallbackBindingId: string | null;
  createdAt: number;
  updatedAt: number;
  installRequestId?: string;
  tenantInstallSource?: TenantInstallSource;
  configurationState?: ConfigurationState;
  governanceState?: GovernanceState;
};

export type RuntimeTelemetry = {
  runtimeAgentId: string;
  capabilityId: string | null;
  calls7d: number;
  successRate7d: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  tokenConsumption7d: number;
  errorCount7d: number;
  queueDepth: number;
  memoryPressure: number;
  lastSampleAt: number;
};

export type GovernanceDetectorConfig = {
  zombieBindingDays: number;
  orphanedAgentDays: number;
  resourceOvercommitThreshold: number;
};

export type LifecycleEvent = {
  id: string;
  runtimeAgentId: string;
  fromLifecycle: RuntimeLifecycle;
  toLifecycle: RuntimeLifecycle;
  actor: string;
  reason: string;
  timestamp: number;
};

export type IssueAcknowledgement = {
  reviewerId: string;
  acknowledgedAt: number;
  note: string | null;
};

export type RuntimePolicyConflict = "highest-success" | "priority" | "manual";
export type RuntimePolicyFallbackMode = "auto-standby" | "none";

/**
 * Product policy document for the platform strategy card.
 * `null` means unconfigured. This is not the auth rate limiter.
 *
 * Units (global policy, not per binding):
 * - `perCapabilityQps`: requests per second for one capability. Fractional values are allowed.
 * - `perTenantDailyCap`: whole requests per day for one tenant. Non-integers are rejected.
 *
 * `fallback.mode` is the global switch (`auto-standby` | `none`).
 * Per-binding `fallbackBindingId` is not part of this document.
 */
export type RuntimePolicyDocument = {
  loadDefaults: {
    default: LoadStrategy | null;
    byCapabilityKind: Record<string, LoadStrategy | null>;
  } | null;
  conflict: RuntimePolicyConflict | null;
  fallback: { mode: RuntimePolicyFallbackMode | null };
  rateLimit: {
    perCapabilityQps: number | null;
    perTenantDailyCap: number | null;
  } | null;
};

export const UNCONFIGURED_RUNTIME_POLICY: RuntimePolicyDocument = {
  loadDefaults: null,
  conflict: null,
  fallback: { mode: null },
  rateLimit: null,
};

const LOAD_STRATEGY_VALUES: readonly LoadStrategy[] = ["eager", "lazy", "on-demand"];
const POLICY_CONFLICT_VALUES: readonly RuntimePolicyConflict[] = [
  "highest-success",
  "priority",
  "manual",
];
const POLICY_FALLBACK_VALUES: readonly RuntimePolicyFallbackMode[] = ["auto-standby", "none"];

function exactLoadStrategy(value: unknown): LoadStrategy | null {
  return LOAD_STRATEGY_VALUES.find((item) => item === value) ?? null;
}

export function cloneRuntimePolicy(policy: RuntimePolicyDocument): RuntimePolicyDocument {
  return {
    loadDefaults: policy.loadDefaults
      ? {
          default: policy.loadDefaults.default,
          byCapabilityKind: { ...policy.loadDefaults.byCapabilityKind },
        }
      : null,
    conflict: policy.conflict,
    fallback: { mode: policy.fallback.mode },
    rateLimit: policy.rateLimit
      ? {
          perCapabilityQps: policy.rateLimit.perCapabilityQps,
          perTenantDailyCap: policy.rateLimit.perTenantDailyCap,
        }
      : null,
  };
}

function normalizeRuntimePolicy(raw: unknown): RuntimePolicyDocument {
  if (!raw || typeof raw !== "object") {
    return cloneRuntimePolicy(UNCONFIGURED_RUNTIME_POLICY);
  }
  const candidate = raw as Partial<RuntimePolicyDocument>;
  const loadRaw = candidate.loadDefaults;
  let loadDefaults: RuntimePolicyDocument["loadDefaults"] = null;
  if (loadRaw && typeof loadRaw === "object") {
    const byCapabilityKind: Record<string, LoadStrategy | null> = {};
    const kinds =
      loadRaw.byCapabilityKind && typeof loadRaw.byCapabilityKind === "object"
        ? loadRaw.byCapabilityKind
        : {};
    for (const [key, value] of Object.entries(kinds)) {
      const trimmed = key.trim();
      if (!trimmed) {
        continue;
      }
      byCapabilityKind[trimmed] = value === null ? null : exactLoadStrategy(value);
    }
    loadDefaults = {
      default: loadRaw.default === null ? null : exactLoadStrategy(loadRaw.default),
      byCapabilityKind,
    };
  }
  const conflict = POLICY_CONFLICT_VALUES.find((item) => item === candidate.conflict) ?? null;
  const fallbackMode =
    POLICY_FALLBACK_VALUES.find((item) => item === candidate.fallback?.mode) ?? null;
  const rateRaw = candidate.rateLimit;
  let rateLimit: RuntimePolicyDocument["rateLimit"] = null;
  if (rateRaw && typeof rateRaw === "object") {
    rateLimit = {
      perCapabilityQps: finiteNonNegative(rateRaw.perCapabilityQps),
      perTenantDailyCap: finiteDailyRequestCount(rateRaw.perTenantDailyCap),
    };
  }
  return { loadDefaults, conflict, fallback: { mode: fallbackMode }, rateLimit };
}

function finiteNonNegative(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

/** Daily cap counts whole requests. A fractional stored value is unconfigured. */
function finiteDailyRequestCount(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

// ─────────────────────────────────────────────────────────────────────────
// 错误类型
// ─────────────────────────────────────────────────────────────────────────

export class AgentRuntimeStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentRuntimeStoreError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 持久化路径
// ─────────────────────────────────────────────────────────────────────────

const STORE_DIR = path.join(CONFIG_DIR, "agent-runtime");
const STORE_FILE = path.join(STORE_DIR, "store.json");

// ─────────────────────────────────────────────────────────────────────────
// 默认治理阈值（与 UI 端 governance-detector.ts 中的 DEFAULT_GOVERNANCE_CONFIG 一致）
// ─────────────────────────────────────────────────────────────────────────

const DEFAULT_GOVERNANCE_CONFIG: GovernanceDetectorConfig = {
  zombieBindingDays: 30,
  orphanedAgentDays: 30,
  resourceOvercommitThreshold: 0.9,
};

// ─────────────────────────────────────────────────────────────────────────
// In-memory 状态
// ─────────────────────────────────────────────────────────────────────────

type StoreShape = {
  agents: Record<string, RuntimeAgent>;
  bindings: Record<string, RuntimeCapabilityBinding>;
  telemetry: RuntimeTelemetry[];
  lifecycleEvents: Record<string, LifecycleEvent[]>;
  acknowledgements: Record<string, IssueAcknowledgement>;
  governanceConfig: GovernanceDetectorConfig;
  policy: RuntimePolicyDocument;
};

let store: StoreShape = makeEmptyStore();

function makeEmptyStore(): StoreShape {
  return {
    agents: {},
    bindings: {},
    telemetry: [],
    lifecycleEvents: {},
    acknowledgements: {},
    governanceConfig: { ...DEFAULT_GOVERNANCE_CONFIG },
    policy: cloneRuntimePolicy(UNCONFIGURED_RUNTIME_POLICY),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 加载 / 持久化
// ─────────────────────────────────────────────────────────────────────────

let loadAttempted = false;

function ensureLoaded(): void {
  if (loadAttempted) {
    return;
  }
  loadAttempted = true;
  try {
    if (!fs.existsSync(STORE_FILE)) {
      return;
    }
    const raw = fs.readFileSync(STORE_FILE, "utf-8");
    if (!raw.trim()) {
      return;
    }
    const parsed = JSON.parse(raw) as Partial<StoreShape>;
    store = {
      agents: parsed.agents ?? {},
      bindings: parsed.bindings ?? {},
      telemetry: Array.isArray(parsed.telemetry) ? parsed.telemetry : [],
      lifecycleEvents: parsed.lifecycleEvents ?? {},
      acknowledgements: parsed.acknowledgements ?? {},
      governanceConfig: { ...DEFAULT_GOVERNANCE_CONFIG, ...parsed.governanceConfig },
      policy: normalizeRuntimePolicy(parsed.policy),
    };
  } catch (err) {
    // 文件损坏：回退到 seed 状态，仅打印 warning
    // eslint-disable-next-line no-console
    console.warn(`[agent-runtime-store] store.json corrupted, using empty seed: ${String(err)}`);
    store = makeEmptyStore();
  }
}

function persist(): void {
  try {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_FILE, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  } catch (err) {
    // 写盘失败不抛错；上层 RPC 仍然认为操作成功（与 employee-capability 模块同语义）
    // eslint-disable-next-line no-console
    console.warn(`[agent-runtime-store] persist failed: ${String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 公共 API：Agents
// ─────────────────────────────────────────────────────────────────────────

export type ListAgentsFilter = {
  lifecycle: RuntimeLifecycle | null;
  health: RuntimeHealth | null;
  tenantId: string | null;
  searchQuery: string;
};

export function listAgents(filter: ListAgentsFilter): RuntimeAgent[] {
  ensureLoaded();
  const q = filter.searchQuery.trim().toLowerCase();
  return Object.values(store.agents).filter((a) => {
    if (filter.lifecycle !== null && a.lifecycle !== filter.lifecycle) {
      return false;
    }
    if (filter.health !== null && a.health !== filter.health) {
      return false;
    }
    if (filter.tenantId !== null && !a.tenantCoverage.includes(filter.tenantId)) {
      return false;
    }
    if (q && !a.name.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
}

export function getAgent(runtimeAgentId: string): RuntimeAgent | null {
  ensureLoaded();
  return store.agents[runtimeAgentId] ?? null;
}

/** 由 Phase 3 / 自动化流程调用：注册或更新 Agent。当前手动入口仅出现在测试 / 引导。 */
export function upsertAgent(agent: RuntimeAgent): void {
  ensureLoaded();
  store.agents[agent.runtimeAgentId] = agent;
  persist();
}

/** Test / bootstrap helper — partial agent seeding. */
export function createAgent(
  input: Pick<RuntimeAgent, "runtimeAgentId" | "name" | "runtimeVersion" | "lifecycle" | "health"> &
    Partial<
      Pick<
        RuntimeAgent,
        | "tenantCoverage"
        | "boundCapabilityCount"
        | "activeSessionCount"
        | "resourceUsage"
        | "deployedAt"
        | "lastActiveAt"
      >
    >,
): RuntimeAgent {
  const now = Date.now();
  const agent: RuntimeAgent = {
    tenantCoverage: [],
    boundCapabilityCount: 0,
    activeSessionCount: 0,
    resourceUsage: { cpuPercent: 0, memoryPercent: 0, tokenBudgetUsedPercent: 0 },
    deployedAt: now,
    lastActiveAt: now,
    ...input,
  };
  upsertAgent(agent);
  return agent;
}

/** 转换 Agent 生命周期。返回更新后的 Agent + 影响评估。 */
export function transitionLifecycle(input: {
  runtimeAgentId: string;
  targetLifecycle: RuntimeLifecycle;
  actor: string;
  reason: string;
}): {
  agent: RuntimeAgent;
  rejectionReason: string | null;
  impact: {
    affectedBindingCount: number;
    activeSessionCount: number;
    affectedTenantCount: number;
    triggersDownstreamNotification: boolean;
  };
  fromLifecycle: RuntimeLifecycle;
} {
  ensureLoaded();
  const a = store.agents[input.runtimeAgentId];
  if (!a) {
    throw new AgentRuntimeStoreError(`Unknown runtime agent: ${input.runtimeAgentId}`);
  }
  const fromLifecycle = a.lifecycle;
  // 服务端强制再次校验状态机合法性（与 UI 客户端校验互为防御）。
  const allowed = LEGAL_TRANSITIONS[fromLifecycle];
  if (!allowed.includes(input.targetLifecycle)) {
    return {
      agent: a,
      rejectionReason: `${fromLifecycle} 不能转换到 ${input.targetLifecycle}`,
      impact: {
        affectedBindingCount: 0,
        activeSessionCount: a.activeSessionCount,
        affectedTenantCount: a.tenantCoverage.length,
        triggersDownstreamNotification: false,
      },
      fromLifecycle,
    };
  }

  const next: RuntimeAgent = { ...a, lifecycle: input.targetLifecycle };
  store.agents[a.runtimeAgentId] = next;

  // archived 时级联禁用所有 binding（实现 task 23 的"deprecated → archived 自动 disable"）
  let cascadeDisabled = 0;
  if (input.targetLifecycle === "archived") {
    for (const b of Object.values(store.bindings)) {
      if (b.runtimeAgentId === a.runtimeAgentId && b.bindingState !== "disabled") {
        store.bindings[b.bindingId] = {
          ...b,
          bindingState: "disabled",
          updatedAt: Date.now(),
        };
        cascadeDisabled += 1;
      }
    }
  }

  // 写入生命周期事件历史
  const evt: LifecycleEvent = {
    id: randomUUID(),
    runtimeAgentId: a.runtimeAgentId,
    fromLifecycle,
    toLifecycle: input.targetLifecycle,
    actor: input.actor,
    reason: input.reason,
    timestamp: Date.now(),
  };
  const arr = store.lifecycleEvents[a.runtimeAgentId] ?? [];
  arr.push(evt);
  store.lifecycleEvents[a.runtimeAgentId] = arr;

  persist();

  const triggersDownstreamNotification =
    input.targetLifecycle === "deprecated" || input.targetLifecycle === "archived";
  return {
    agent: next,
    rejectionReason: null,
    impact: {
      affectedBindingCount: cascadeDisabled || countAgentBindings(a.runtimeAgentId),
      activeSessionCount: a.activeSessionCount,
      affectedTenantCount: a.tenantCoverage.length,
      triggersDownstreamNotification,
    },
    fromLifecycle,
  };
}

export function listLifecycleEvents(runtimeAgentId: string): LifecycleEvent[] {
  ensureLoaded();
  return store.lifecycleEvents[runtimeAgentId] ?? [];
}

const LEGAL_TRANSITIONS: Record<RuntimeLifecycle, readonly RuntimeLifecycle[]> = {
  deployed: ["draining", "deprecated"],
  draining: ["suspended"],
  suspended: ["deployed", "archived"],
  deprecated: ["archived"],
  archived: [],
};

// ─────────────────────────────────────────────────────────────────────────
// 公共 API：Bindings
// ─────────────────────────────────────────────────────────────────────────

export type ListBindingsFilter = {
  runtimeAgentId: string | null;
  capabilityId: string | null;
  bindingType: BindingType | null;
  bindingState: BindingState | null;
  health: RuntimeHealth | null;
};

export function listBindings(filter: ListBindingsFilter): RuntimeCapabilityBinding[] {
  ensureLoaded();
  return Object.values(store.bindings).filter((b) => {
    if (filter.runtimeAgentId !== null && b.runtimeAgentId !== filter.runtimeAgentId) {
      return false;
    }
    if (filter.capabilityId !== null && b.capabilityId !== filter.capabilityId) {
      return false;
    }
    if (filter.bindingType !== null && b.bindingType !== filter.bindingType) {
      return false;
    }
    if (filter.bindingState !== null && b.bindingState !== filter.bindingState) {
      return false;
    }
    if (filter.health !== null && b.healthStatus !== filter.health) {
      return false;
    }
    return true;
  });
}

export function getBinding(bindingId: string): RuntimeCapabilityBinding | null {
  ensureLoaded();
  return store.bindings[bindingId] ?? null;
}

export type CreateBindingInput = {
  runtimeAgentId: string;
  capabilityId: string;
  capabilityVersion: string;
  bindingType: BindingType;
  loadStrategy: LoadStrategy;
  routingPriority: number | null;
  policy?: BindingPolicy | null;
  fallbackBindingId?: string | null;
  installRequestId?: string;
  tenantInstallSource?: TenantInstallSource;
  configurationState?: ConfigurationState;
  governanceState?: GovernanceState;
};

export function createBinding(input: CreateBindingInput): RuntimeCapabilityBinding {
  ensureLoaded();
  if (!store.agents[input.runtimeAgentId]) {
    throw new AgentRuntimeStoreError(`Unknown runtime agent: ${input.runtimeAgentId}`);
  }
  // 拒绝重复的"同一 (agent, capability)"活跃绑定
  const existing = Object.values(store.bindings).find(
    (b) =>
      b.runtimeAgentId === input.runtimeAgentId &&
      b.capabilityId === input.capabilityId &&
      b.bindingState !== "disabled",
  );
  if (existing) {
    throw new AgentRuntimeStoreError(
      `Active binding for ${input.capabilityId} already exists on ${input.runtimeAgentId}`,
    );
  }
  const now = Date.now();
  const binding: RuntimeCapabilityBinding = {
    bindingId: `bind-${randomUUID()}`,
    runtimeAgentId: input.runtimeAgentId,
    capabilityId: input.capabilityId,
    capabilityVersion: input.capabilityVersion,
    bindingType: input.bindingType,
    routingPriority: input.routingPriority ?? 50,
    loadStrategy: input.loadStrategy,
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
    policy: input.policy ?? { sandbox: "strict", resourceQuota: "small", hotReloadable: true },
    fallbackBindingId: input.fallbackBindingId ?? null,
    createdAt: now,
    updatedAt: now,
    installRequestId: input.installRequestId,
    tenantInstallSource: input.tenantInstallSource,
    configurationState: input.configurationState,
    governanceState: input.governanceState,
  };
  store.bindings[binding.bindingId] = binding;

  // 同步更新 Agent 的 boundCapabilityCount
  const agent = store.agents[input.runtimeAgentId];
  if (agent) {
    store.agents[input.runtimeAgentId] = {
      ...agent,
      boundCapabilityCount: agent.boundCapabilityCount + 1,
    };
  }

  persist();
  return binding;
}

export function upsertBinding(input: CreateBindingInput): RuntimeCapabilityBinding {
  ensureLoaded();
  const now = Date.now();
  const existing = Object.values(store.bindings).find(
    (b) => b.runtimeAgentId === input.runtimeAgentId && b.capabilityId === input.capabilityId,
  );
  if (existing) {
    const next: RuntimeCapabilityBinding = {
      ...existing,
      capabilityVersion: input.capabilityVersion,
      bindingType: input.bindingType,
      routingPriority: input.routingPriority ?? existing.routingPriority,
      loadStrategy: input.loadStrategy,
      bindingState: "active",
      policy: input.policy ?? existing.policy,
      fallbackBindingId: input.fallbackBindingId ?? existing.fallbackBindingId,
      updatedAt: now,
      installRequestId: input.installRequestId ?? existing.installRequestId,
      tenantInstallSource: input.tenantInstallSource ?? existing.tenantInstallSource,
      configurationState: input.configurationState ?? existing.configurationState,
      governanceState: input.governanceState ?? existing.governanceState,
    };
    store.bindings[existing.bindingId] = next;
    persist();
    return next;
  }
  return createBinding(input);
}

export function updateBindingState(
  bindingId: string,
  bindingState: BindingState,
): RuntimeCapabilityBinding {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = { ...b, bindingState, updatedAt: Date.now() };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function updateBindingPriority(
  bindingId: string,
  routingPriority: number,
): RuntimeCapabilityBinding {
  ensureLoaded();
  if (!Number.isFinite(routingPriority) || routingPriority < 0) {
    throw new AgentRuntimeStoreError("routingPriority must be a non-negative finite number");
  }
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = { ...b, routingPriority, updatedAt: Date.now() };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function updateBindingVersion(
  bindingId: string,
  capabilityVersion: string,
): RuntimeCapabilityBinding {
  ensureLoaded();
  const version = capabilityVersion.trim();
  if (!version) {
    throw new AgentRuntimeStoreError("capabilityVersion is required");
  }
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = {
    ...b,
    capabilityVersion: version,
    updatedAt: Date.now(),
  };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function updateBindingStrategy(
  bindingId: string,
  loadStrategy: LoadStrategy,
): RuntimeCapabilityBinding {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = { ...b, loadStrategy, updatedAt: Date.now() };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function updateBindingConfigurationState(
  bindingId: string,
  configurationState: ConfigurationState,
): RuntimeCapabilityBinding {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = {
    ...b,
    configurationState,
    updatedAt: Date.now(),
  };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function clearBindingFallback(bindingId: string): RuntimeCapabilityBinding {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    throw new AgentRuntimeStoreError(`Unknown binding: ${bindingId}`);
  }
  const next: RuntimeCapabilityBinding = { ...b, fallbackBindingId: null, updatedAt: Date.now() };
  store.bindings[bindingId] = next;
  persist();
  return next;
}

export function getRuntimePolicy(): RuntimePolicyDocument {
  ensureLoaded();
  return cloneRuntimePolicy(store.policy);
}

export function replaceRuntimePolicy(next: RuntimePolicyDocument): RuntimePolicyDocument {
  ensureLoaded();
  store.policy = cloneRuntimePolicy(next);
  persist();
  return cloneRuntimePolicy(store.policy);
}

export function deleteBinding(bindingId: string): boolean {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    return false;
  }
  delete store.bindings[bindingId];
  // 同步更新 Agent 的 boundCapabilityCount
  const agent = store.agents[b.runtimeAgentId];
  if (agent) {
    store.agents[b.runtimeAgentId] = {
      ...agent,
      boundCapabilityCount: Math.max(0, agent.boundCapabilityCount - 1),
    };
  }
  persist();
  return true;
}

export function canInvokeBinding(bindingId: string): {
  allowed: boolean;
  reason?: string;
} {
  ensureLoaded();
  const b = store.bindings[bindingId];
  if (!b) {
    return { allowed: false, reason: "binding-not-found" };
  }
  if (b.configurationState === "pending") {
    return { allowed: false, reason: "pending-configuration" };
  }
  if (b.bindingState === "disabled") {
    return { allowed: false, reason: "binding-disabled" };
  }
  // "degraded" is the governance limit state: still invokable (throttled by priority).
  if (b.bindingState === "degraded") {
    return { allowed: true, reason: "binding-limited" };
  }
  if (b.bindingState !== "active") {
    return { allowed: false, reason: `binding-state-${b.bindingState}` };
  }
  return { allowed: true };
}

function countAgentBindings(runtimeAgentId: string): number {
  return Object.values(store.bindings).filter((b) => b.runtimeAgentId === runtimeAgentId).length;
}

// ─────────────────────────────────────────────────────────────────────────
// 公共 API：Telemetry
// ─────────────────────────────────────────────────────────────────────────

export type TelemetryWindow = "1h" | "6h" | "24h" | "7d" | "30d";

export function listTelemetry(filter: {
  runtimeAgentId: string | null;
  capabilityId: string | null;
  // window 当前作为提示参数；in-memory store 不区分窗口
  window: TelemetryWindow;
}): RuntimeTelemetry[] {
  ensureLoaded();
  return store.telemetry.filter((t) => {
    if (filter.runtimeAgentId !== null && t.runtimeAgentId !== filter.runtimeAgentId) {
      return false;
    }
    if (filter.capabilityId !== null && t.capabilityId !== filter.capabilityId) {
      return false;
    }
    return true;
  });
}

/** 用于由 Runtime 探测器或测试注入采样数据。 */
export function recordTelemetry(sample: RuntimeTelemetry): void {
  ensureLoaded();
  store.telemetry.push(sample);
  // 限制总条数避免无限膨胀（保留最近 5000 条）
  if (store.telemetry.length > 5000) {
    store.telemetry = store.telemetry.slice(-5000);
  }
  persist();
}

export function getHealthSummary(): {
  agentCountByHealth: Record<RuntimeHealth, number>;
  bindingCountByHealth: Record<RuntimeHealth, number>;
  unhealthyAgents: RuntimeAgent[];
  unhealthyBindings: RuntimeCapabilityBinding[];
} {
  ensureLoaded();
  const agentCountByHealth: Record<RuntimeHealth, number> = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unavailable: 0,
  };
  const bindingCountByHealth: Record<RuntimeHealth, number> = {
    healthy: 0,
    degraded: 0,
    unhealthy: 0,
    unavailable: 0,
  };
  const agents = Object.values(store.agents);
  const bindings = Object.values(store.bindings);
  for (const a of agents) {
    agentCountByHealth[a.health] += 1;
  }
  for (const b of bindings) {
    bindingCountByHealth[b.healthStatus] += 1;
  }
  return {
    agentCountByHealth,
    bindingCountByHealth,
    unhealthyAgents: agents.filter((a) => a.health !== "healthy"),
    unhealthyBindings: bindings.filter((b) => b.healthStatus !== "healthy"),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 公共 API：Governance
// ─────────────────────────────────────────────────────────────────────────

export function getGovernanceConfig(): GovernanceDetectorConfig {
  ensureLoaded();
  return { ...store.governanceConfig };
}

export function updateGovernanceConfig(
  patch: Partial<GovernanceDetectorConfig>,
): GovernanceDetectorConfig {
  ensureLoaded();
  for (const [k, v] of Object.entries(patch)) {
    if (typeof v === "number" && (!Number.isFinite(v) || v < 0)) {
      throw new AgentRuntimeStoreError(`${k} must be a non-negative finite number`);
    }
  }
  store.governanceConfig = { ...store.governanceConfig, ...patch };
  persist();
  return { ...store.governanceConfig };
}

export function recordIssueAcknowledgement(input: {
  issueId: string;
  reviewerId: string;
  note: string | null;
}): IssueAcknowledgement {
  ensureLoaded();
  const ack: IssueAcknowledgement = {
    reviewerId: input.reviewerId,
    acknowledgedAt: Date.now(),
    note: input.note,
  };
  store.acknowledgements[input.issueId] = ack;
  persist();
  return ack;
}

export function getIssueAcknowledgement(issueId: string): IssueAcknowledgement | null {
  ensureLoaded();
  return store.acknowledgements[issueId] ?? null;
}

// ─────────────────────────────────────────────────────────────────────────
// 公共 API：KPI 派生（纯函数读）
// ─────────────────────────────────────────────────────────────────────────

export function computeKpi(): {
  agentCountTotal: number;
  agentCountByLifecycle: Record<RuntimeLifecycle, number>;
  bindingCountTotal: number;
  bindingCountByState: Record<BindingState, number>;
  bindingCountByType: Record<BindingType, number>;
  avgBindingsPerAgent: number;
  healthyAgentRatio: number;
  tenantCoverageTotal: number;
  activeSessionCount: number;
} {
  ensureLoaded();
  const agents = Object.values(store.agents);
  const bindings = Object.values(store.bindings);

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

  const bindingCountByState: Record<BindingState, number> = {
    active: 0,
    warming: 0,
    degraded: 0,
    disabled: 0,
  };
  const bindingCountByType: Record<BindingType, number> = {
    "tenant-installed": 0,
    "platform-default": 0,
    "dynamic-runtime": 0,
    fallback: 0,
    skill: 0,
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

  return {
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
}

// ─────────────────────────────────────────────────────────────────────────
// 测试辅助导出（仅供单元测试 / 集成测试使用，生产路径不应调用）
// ─────────────────────────────────────────────────────────────────────────

export const __agentRuntimeStoreInternals = {
  reset(): void {
    store = makeEmptyStore();
    loadAttempted = true; // 避免再从磁盘加载
  },
  /** 注入测试夹具数据。 */
  seed(data: Partial<StoreShape>): void {
    store = {
      ...makeEmptyStore(),
      ...data,
    };
    loadAttempted = true;
  },
};
