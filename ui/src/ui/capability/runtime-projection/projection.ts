/**
 * Runtime Projection — 「能力使用管理」（enterprise-capability-usage-management）模块的投影函数。
 *
 * 模块定位：
 * 本文件是 Platform Runtime Layer 数据流入企业端「能力使用管理」业务视图的**唯一**通道。
 * 上游来源是 `../runtime-canonical/types.ts` 暴露的运行时真理源（`RuntimeAgent` /
 * `RuntimeCapabilityBinding` / `RuntimeTelemetry` / `RuntimeHealth`），下游目标是
 * `./types.ts` 定义的企业端业务对象（`Robot` / `InstallRelationEnhanced` /
 * `RobotCapabilityUsageView` / `HealthStatus`）。
 *
 * 严格不变量（落实 Requirements 8.1 / 8.2 / 9.1 / 10.5、Properties 1 / 2 / 3）：
 *
 * 1. **纯函数**：相同输入永远返回 deep-equal 输出；不依赖外部状态、不发起 I/O、
 *    不修改入参。本文件的导入只允许是类型声明；运行时不持有任何模块级状态。
 *
 * 2. **单向投影**：本模块只导出 `Runtime* → Enterprise Business Type` 方向的纯函数，
 *    不提供反向映射。
 *
 * 3. **字段纯净**：输出对象在 TypeScript 类型层与运行时结构层都**不存在**任何
 *    运行时字段（`runtimeAgentId` / `runtimeVersion` / `bindingId` / `bindingType` /
 *    `bindingState` / `loadStrategy` / `routingPriority` / `policy` / `cpu` /
 *    `memory` / `nodeId` / `templateId` / `provider` / `modelRouting` / `qps` /
 *    `latency` / `p95` 等）。本模块统一使用 `Pick<>` 从 `Robot` 取业务字段，并以
 *    显式 `{ field: ... }` 字面量构造对象——**严禁** `...spread` 透传任何运行时
 *    入参。新增运行时字段不会无意渗透到企业端。
 *
 * 4. **健康降级**：未知 / null / undefined 的运行时健康值在投影层降级为渲染期占位
 *    `"暂无数据"`（`HEALTH_STATUS_NO_DATA`），不暴露原始枚举字符串。
 *
 * 5. **术语守卫**：所有可能源自上游的 `string` 字段（如 `robotName` / `capabilityName`）
 *    在生产构建路径上必须经过 `assertNoBlacklistedTerm`；命中黑名单时由
 *    `assertViewIsBusinessClean` 抛错，作为生产构建的最后一道扫描。
 *
 * 关联文档：
 * - `.kiro/specs/enterprise-capability-usage-management/design.md` §「Runtime_Projection_Layer」
 * - `.kiro/specs/enterprise-capability-usage-management/requirements.md` Requirement 8 / 9 / 10
 */

import type {
  RuntimeAgent,
  RuntimeCapabilityBinding,
  RuntimeHealth,
  RuntimeTelemetry,
} from "../runtime-canonical/types.ts";
import { assertNoBlacklistedTerm } from "./term-blacklist.ts";
import {
  HEALTH_STATUS_NO_DATA,
  type HealthStatus,
  type HealthStatusNoData,
  type InstallRelationBusinessSource,
  type InstallRelationEnhanced,
  type InstallRelationStatus,
  type InstallRelationUsageStats,
  type Robot,
  type RobotCapabilityUsageView,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// Health Status — RuntimeHealth → 业务效果语言
// ─────────────────────────────────────────────────────────────────────────

/**
 * 已知 4 个 `RuntimeHealth` 枚举值的业务效果语言映射（落实 Property 2 完备性）。
 *
 * 此处独立列出映射表（而不是 inline 在 switch 里）便于：
 * - 运行期断言映射完备
 * - 属性测试可对照本表迭代验证
 */
const RUNTIME_HEALTH_TO_ENTERPRISE: Readonly<Record<RuntimeHealth, HealthStatus>> = {
  healthy: "效果稳定",
  degraded: "偶尔不理想",
  unhealthy: "建议优化",
  unavailable: "已停用",
};

/**
 * 将上游 `RuntimeHealth` 投影为企业端业务效果语言。
 *
 * - 4 个已知值：精确映射到对应业务文本（{@link RUNTIME_HEALTH_TO_ENTERPRISE}）
 * - 未知字符串 / `null` / `undefined`：统一降级为 {@link HEALTH_STATUS_NO_DATA}（`"暂无数据"`）
 *
 * 入参类型刻意放宽到 `string | null | undefined`，以容忍上游接口在演进期
 * 返回新增 / 缺失枚举值时本模块仍能稳定降级（落实 Requirement 10.5、Property 2）。
 */
export function projectRuntimeHealthToEnterprise(
  raw: string | null | undefined,
): HealthStatus | HealthStatusNoData {
  if (raw === null || raw === undefined) {
    return HEALTH_STATUS_NO_DATA;
  }
  // 仅命中已知键时返回业务文本；其它字符串（含未来新增枚举）一律降级
  if (Object.prototype.hasOwnProperty.call(RUNTIME_HEALTH_TO_ENTERPRISE, raw)) {
    return RUNTIME_HEALTH_TO_ENTERPRISE[raw as RuntimeHealth];
  }
  return HEALTH_STATUS_NO_DATA;
}

// ─────────────────────────────────────────────────────────────────────────
// Robot — RuntimeAgent → Robot（业务字段子集）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 上游 `RuntimeAgent` 中本模块实际消费的字段子集。借助 `Pick<>` 显式列举，
 * 任何额外的运行时字段（`runtimeVersion` / `lifecycle` / `resourceUsage` 等）
 * 在编译期就无法被本模块访问，即使新增也不会无意渗透到投影输出。
 */
type RuntimeAgentBusinessFields = Pick<RuntimeAgent, "runtimeAgentId" | "name" | "lastActiveAt"> & {
  health: RuntimeAgent["health"];
};

/**
 * 将上游 `RuntimeAgent` 投影为企业端 {@link Robot}。
 *
 * 映射规则（落实 Requirement 9.7）：
 * - `Robot.robotId      ← RuntimeAgent.runtimeAgentId`（同值不同名）
 * - `Robot.robotName    ← RuntimeAgent.name`（经术语黑名单扫描后落地）
 * - `Robot.healthStatus ← projectRuntimeHealthToEnterprise(RuntimeAgent.health)`
 * - `Robot.lastActiveAt ← RuntimeAgent.lastActiveAt`
 *
 * 严禁透传 `runtimeVersion` / `lifecycle` / `tenantCoverage` / `boundCapabilityCount` /
 * `activeSessionCount` / `resourceUsage` / `deployedAt` 等运行时字段——构造时使用
 * 显式字段字面量（无 `...spread`），与 `Pick<>` 形成双重防御。
 */
export function projectRuntimeAgentToRobot(agent: RuntimeAgent): Robot {
  // Pick 仅取业务字段，类型层屏蔽其余运行时字段
  const source: RuntimeAgentBusinessFields = {
    runtimeAgentId: agent.runtimeAgentId,
    name: agent.name,
    lastActiveAt: agent.lastActiveAt,
    health: agent.health,
  };

  return {
    robotId: source.runtimeAgentId,
    robotName: assertNoBlacklistedTerm(source.name, { mode: "throw" }),
    healthStatus: projectRuntimeHealthToEnterprise(source.health),
    lastActiveAt: source.lastActiveAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Install Relation — RuntimeCapabilityBinding → InstallRelationEnhanced
// ─────────────────────────────────────────────────────────────────────────

/**
 * `bindingType` → 业务来源映射。
 *
 * - `tenant-installed` → `"员工沉淀"`（员工自主把能力安装到机器人）
 * - `platform-default` → `"企业发布"`（管理员在企业能力中心发布并下推的默认能力）
 *
 * 平台端的 `dynamic-runtime`（运行时智能编排）与 `fallback`（降级备选）属于运行时
 * 内部决策，业务管理员不应感知；为保留信息密度，将其归入 `"企业发布"`（管理员
 * 视角下的默认下推），同时在 JSDoc 中显式记录此默认选择，便于将来调整。
 */
function projectBindingTypeToBusinessSource(
  bindingType: RuntimeCapabilityBinding["bindingType"],
): InstallRelationBusinessSource {
  switch (bindingType) {
    case "tenant-installed":
      return "员工沉淀";
    case "platform-default":
    case "dynamic-runtime":
    case "fallback":
      return "企业发布";
  }
}

/**
 * `(bindingState, healthStatus)` → 业务状态映射。
 *
 * 规则（落实 design.md 与 `./types.ts` 中 InstallRelationStatus 的 JSDoc 约定）：
 * - `disabled` → `"已停用"`（与健康无关）
 * - `unavailable` 健康 → `"已停用"`（运行时已不可用）
 * - `active` + (`healthy` | `degraded`) → `"正常"`
 * - `active` + `unhealthy` → `"待优化"`
 * - `warming` → `"正常"`（热加载预热是运行时细节，对企业端等价正常）
 * - `degraded` 状态（仍在工作） → `"正常"`
 *
 * 任何未知组合一律落到 `"待优化"`——保证渲染层不出现"未知状态"破口，同时保留
 * 一定的业务信号（与 `"正常"`/`"已停用"` 区分开，便于排查）。
 */
function projectBindingStateToStatus(
  bindingState: RuntimeCapabilityBinding["bindingState"],
  healthStatus: RuntimeCapabilityBinding["healthStatus"],
): InstallRelationStatus {
  if (bindingState === "disabled") {
    return "已停用";
  }
  if (healthStatus === "unavailable") {
    return "已停用";
  }
  if (bindingState === "active") {
    if (healthStatus === "unhealthy") {
      return "待优化";
    }
    if (healthStatus === "healthy" || healthStatus === "degraded") {
      return "正常";
    }
    // active + 未知健康（理论上不应发生）→ 兜底为待优化
    return "待优化";
  }
  if (bindingState === "warming" || bindingState === "degraded") {
    return "正常";
  }
  // 未知 bindingState（运行时新增枚举）→ 兜底为待优化
  return "待优化";
}

/**
 * `RuntimeCapabilityBinding.invocationMetrics` 中本模块实际消费的字段子集。
 * 借助 `Pick<>` 屏蔽 `avgLatencyMs` / `p95LatencyMs` / `errorCount7d` /
 * `tokenConsumption7d` 等运行时性能指标。
 */
type BindingMetricsBusinessFields = Pick<
  RuntimeCapabilityBinding["invocationMetrics"],
  "calls7d" | "successRate7d"
>;

/**
 * 由 `RuntimeCapabilityBinding.invocationMetrics` 派生 30 日业务统计。
 *
 * 注意：当前上游仅暴露 7 日窗口指标（`calls7d` / `successRate7d`），此处直接以 7 日
 * 数据近似填充 30 日字段；未来上游增加 30 日窗口后，可在 `ctx.usageStats` 中传入
 * 精确值覆盖。下游 UI 与黑名单扫描不感知具体窗口语义。
 */
function deriveUsageStatsFromMetrics(
  metrics: RuntimeCapabilityBinding["invocationMetrics"],
): InstallRelationUsageStats {
  const business: BindingMetricsBusinessFields = {
    calls7d: metrics.calls7d,
    successRate7d: metrics.successRate7d,
  };
  return {
    executions30d: business.calls7d,
    successRate: business.successRate7d,
  };
}

/**
 * `projectBindingToInstallRelation` 上下文。
 *
 * 由调用方提供能力 / 机器人显示名（来自 `enterprise-capability-asset-library` 与
 * `RuntimeAgent.name` 投影后的 {@link Robot.robotName}），可选 `usageStats` 覆盖
 * 当上游能提供精确 30 日统计时使用。
 */
export type ProjectBindingToInstallRelationContext = {
  /** 能力显示名称（来自能力中心，非运行时字段） */
  capabilityName: string;
  /** 机器人显示名称（已经过 `projectRuntimeAgentToRobot` 投影） */
  robotName: string;
  /** 可选：精确 30 日统计；未提供时由 `binding.invocationMetrics` 推导 */
  usageStats?: InstallRelationUsageStats;
};

/**
 * 将运行时绑定 {@link RuntimeCapabilityBinding} 投影为企业端 {@link InstallRelationEnhanced}。
 *
 * 严格剥离运行时字段：`capabilityVersion` / `routingPriority` / `loadStrategy` /
 * `policy`（含 `sandbox` / `resourceQuota` / `hotReloadable`）/ `fallbackBindingId` /
 * `bindingType` / `bindingState` / `healthStatus` / `runtimeAgentId` 等均**不**进入
 * 输出对象——通过显式字段字面量构造，杜绝 `...spread` 透传。
 *
 * `id` 字段保留 `bindingId` 数值用作 React key 与卸载请求标识，但语义层**不**以
 * "binding" 暴露（详见 `./types.ts` 中 `InstallRelationEnhanced.id` 的 JSDoc）。
 */
export function projectBindingToInstallRelation(
  binding: RuntimeCapabilityBinding,
  ctx: ProjectBindingToInstallRelationContext,
): InstallRelationEnhanced {
  const usageStats = ctx.usageStats ?? deriveUsageStatsFromMetrics(binding.invocationMetrics);
  return {
    id: binding.bindingId,
    capabilityId: binding.capabilityId,
    capabilityName: assertNoBlacklistedTerm(ctx.capabilityName, { mode: "throw" }),
    robotId: binding.runtimeAgentId,
    robotName: assertNoBlacklistedTerm(ctx.robotName, { mode: "throw" }),
    installedAt: binding.createdAt,
    source: projectBindingTypeToBusinessSource(binding.bindingType),
    usageStats: {
      executions30d: usageStats.executions30d,
      successRate: usageStats.successRate,
    },
    status: projectBindingStateToStatus(binding.bindingState, binding.healthStatus),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Telemetry → Business Metrics（聚合）
// ─────────────────────────────────────────────────────────────────────────

/**
 * `RuntimeTelemetry` 中本模块实际消费的字段子集。借助 `Pick<>` 屏蔽
 * `avgLatencyMs` / `p95LatencyMs` / `errorCount7d` / `tokenConsumption7d` /
 * `queueDepth` / `memoryPressure` 等运行时指标。
 */
type TelemetryBusinessFields = Pick<RuntimeTelemetry, "calls7d" | "successRate7d">;

/**
 * 将一组运行时遥测样本聚合为业务指标 `{ monthlyExecutions, successRate }`。
 *
 * 计算口径（落实 Requirement 8.2、8.3、10.5）：
 * - `monthlyExecutions` = `Σ calls7d`（窗口由上游决定；本模块不暴露具体窗口名）
 * - `successRate`       = `Σ (calls7d × successRate7d) / Σ calls7d`，归一化到 [0, 1]
 * - 输入为空数组或总调用为 0 时：返回 `{ monthlyExecutions: 0, successRate: 0 }`，
 *   由展示层（`./format.ts`）决定是否进一步降级为 `"暂无数据"` 文案
 */
export function projectTelemetryToBusinessMetrics(telemetry: readonly RuntimeTelemetry[]): {
  monthlyExecutions: number;
  successRate: number;
} {
  let totalCalls = 0;
  let weightedSuccess = 0;
  for (const entry of telemetry) {
    const business: TelemetryBusinessFields = {
      calls7d: entry.calls7d,
      successRate7d: entry.successRate7d,
    };
    totalCalls += business.calls7d;
    weightedSuccess += business.calls7d * business.successRate7d;
  }
  if (totalCalls <= 0) {
    return { monthlyExecutions: 0, successRate: 0 };
  }
  return {
    monthlyExecutions: totalCalls,
    successRate: weightedSuccess / totalCalls,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Robot Capability Usage View — 主聚合
// ─────────────────────────────────────────────────────────────────────────

/**
 * `buildRobotCapabilityUsageView` 入参。
 *
 * - `agent`                   单个机器人的运行时实例
 * - `bindings`                该机器人下的全部运行时绑定（已按 `runtimeAgentId` 过滤）
 * - `telemetry`               该机器人维度的遥测样本（agent 级 + 各 capability 级）
 * - `capabilityNames`         能力 ID → 业务名称映射（来自 enterprise-capability-asset-library）
 * - `monthlyEmployeeCoverage` 机器人 ID → 30 日去重员工数映射（业务后端汇总）
 */
export type BuildRobotCapabilityUsageViewInput = {
  agent: RuntimeAgent;
  bindings: readonly RuntimeCapabilityBinding[];
  telemetry: readonly RuntimeTelemetry[];
  capabilityNames: ReadonlyMap<string, string>;
  monthlyEmployeeCoverage: ReadonlyMap<string, number>;
};

/** 当上游 `capabilityNames` 缺失对应 ID 时使用的兜底名称（不暴露 capabilityId）。 */
const UNKNOWN_CAPABILITY_NAME = "未知能力";

/** Top 能力数量上限（产品规范：最多 3 个）。 */
const TOP_CAPABILITIES_LIMIT = 3;

/**
 * 取每条绑定的"本月调用量"代理值。优先使用该 capabilityId 维度的 telemetry
 * 样本（更贴近"按能力维度的本月调用量"），缺失时回退到绑定自身的
 * `invocationMetrics.calls7d`，再缺失则记为 0。
 */
function pickPerBindingMonthlyExecutions(
  binding: RuntimeCapabilityBinding,
  telemetryByCapability: ReadonlyMap<string, RuntimeTelemetry>,
): number {
  const sample = telemetryByCapability.get(binding.capabilityId);
  if (sample) {
    return sample.calls7d;
  }
  return binding.invocationMetrics.calls7d ?? 0;
}

/**
 * 主聚合函数：把"机器人 + 绑定 + 遥测 + 能力名称 + 员工覆盖"合成一行
 * {@link RobotCapabilityUsageView}。
 *
 * 字段计算口径（落实 Requirement 4.4、Property 4）：
 * - `capabilityCount`   = 该机器人下 `status ∈ {"正常", "待优化"}` 的安装关系
 *                         去重 `capabilityId` 数量（`"已停用"` 不计入）
 * - `monthlyExecutions` = `projectTelemetryToBusinessMetrics(telemetry).monthlyExecutions`
 * - `employeeCoverage`  = `monthlyEmployeeCoverage.get(robotId) ?? 0`
 * - `successRate`       = `projectTelemetryToBusinessMetrics(telemetry).successRate`
 * - `healthStatus`      = 自 {@link projectRuntimeHealthToEnterprise} 派生
 * - `topCapabilities`   = 按每条绑定的本月调用量降序，取 top 3 能力名称；缺失名称
 *                         降级为 `"未知能力"`，**不**暴露 `capabilityId` 作为名称
 *
 * 严禁通过 `...spread` 透传任何运行时入参；输出对象使用显式字段字面量构造，
 * 与类型层 `Pick<>` 形成双重防御。
 */
export function buildRobotCapabilityUsageView(
  input: BuildRobotCapabilityUsageViewInput,
): RobotCapabilityUsageView {
  const robot = projectRuntimeAgentToRobot(input.agent);

  // 1. capabilityCount —— 排除"已停用"的去重 capabilityId
  const activeCapabilityIds = new Set<string>();
  for (const binding of input.bindings) {
    const status = projectBindingStateToStatus(binding.bindingState, binding.healthStatus);
    if (status === "正常" || status === "待优化") {
      activeCapabilityIds.add(binding.capabilityId);
    }
  }

  // 2. monthlyExecutions / successRate —— 走纯函数聚合
  const businessMetrics = projectTelemetryToBusinessMetrics(input.telemetry);

  // 3. employeeCoverage —— 来自业务后端汇总，缺失补 0
  const employeeCoverage = input.monthlyEmployeeCoverage.get(input.agent.runtimeAgentId) ?? 0;

  // 4. topCapabilities —— 按每条绑定的本月调用量降序取前 3
  const telemetryByCapability = new Map<string, RuntimeTelemetry>();
  for (const sample of input.telemetry) {
    if (sample.capabilityId !== null && sample.capabilityId !== undefined) {
      telemetryByCapability.set(sample.capabilityId, sample);
    }
  }

  // 仅基于 active 能力（与 capabilityCount 一致），避免"已停用"能力混入 Top 排行
  const ranked = input.bindings
    .filter((binding) => {
      const status = projectBindingStateToStatus(binding.bindingState, binding.healthStatus);
      return status === "正常" || status === "待优化";
    })
    .map((binding) => ({
      capabilityId: binding.capabilityId,
      executions: pickPerBindingMonthlyExecutions(binding, telemetryByCapability),
    }))
    .toSorted((a, b) => b.executions - a.executions);

  // 同一 capabilityId 可能出现多次绑定，去重后取前 3
  const seen = new Set<string>();
  const topCapabilities: string[] = [];
  for (const entry of ranked) {
    if (topCapabilities.length >= TOP_CAPABILITIES_LIMIT) {
      break;
    }
    if (seen.has(entry.capabilityId)) {
      continue;
    }
    seen.add(entry.capabilityId);
    const rawName = input.capabilityNames.get(entry.capabilityId) ?? UNKNOWN_CAPABILITY_NAME;
    // 名称源自上游字符串，需经过术语黑名单扫描；命中即抛错（生产构建时由
    // assertViewIsBusinessClean 二次兜底）
    topCapabilities.push(assertNoBlacklistedTerm(rawName, { mode: "throw" }));
  }

  return {
    robotId: robot.robotId,
    robotName: robot.robotName,
    capabilityCount: activeCapabilityIds.size,
    monthlyExecutions: businessMetrics.monthlyExecutions,
    employeeCoverage,
    successRate: businessMetrics.successRate,
    healthStatus: robot.healthStatus,
    topCapabilities,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Final Guard — 生产构建最后一道扫描
// ─────────────────────────────────────────────────────────────────────────

/**
 * 在视图被写入 DOM 前对 {@link RobotCapabilityUsageView} 的所有字符串字段执行
 * 术语黑名单扫描，命中即抛错。
 *
 * 这是与 `term-blacklist.ts` 配套的"最后一道防线"——即便上游绕过了投影函数
 * 直接构造视图（违反约定），本函数也能拦截。生产构建中由能力中心运行态面板
 * （`capability-center-usage-panels.ts` 及其子页）在每次渲染前调用。
 *
 * 扫描字段：
 * - `robotName`        来自 `RuntimeAgent.name`
 * - `healthStatus`     来自映射表（应为 4 业务文本或 `"暂无数据"`）
 * - `topCapabilities`  来自 `capabilityNames` 映射
 *
 * `robotId` 等纯 ID 字段不扫描（业务 ID 与运行时 ID 共享，且产品规范
 * 不在 UI 上展示）。
 */
export function assertViewIsBusinessClean(view: RobotCapabilityUsageView): void {
  assertNoBlacklistedTerm(view.robotName, { mode: "throw" });
  assertNoBlacklistedTerm(view.healthStatus, { mode: "throw" });
  for (const name of view.topCapabilities) {
    assertNoBlacklistedTerm(name, { mode: "throw" });
  }
}
