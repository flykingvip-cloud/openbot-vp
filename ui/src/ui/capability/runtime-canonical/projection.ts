/**
 * Runtime Canonical Projection — Platform Runtime Layer 与下游层之间的强制屏障。
 *
 * 架构作用：
 * 本模块是 `RuntimeCanonical*` 类型流向企业端 / 员工端的**唯一**合法翻译入口。
 * 任何下游层若需消费 Runtime 数据，必须经由本模块的纯函数投影；不得直接访问
 * `RuntimeCapabilityBinding` 等 Runtime 内部字段。这一约束由属性测试持续验证
 * （`__tests__/projection.property.test.ts` 中的 Property 1/2/3）。
 *
 * 设计准则：
 * - 所有投影函数为纯函数（pure function）：相同输入永远返回 deep-equal 输出，
 *   不依赖外部状态、不修改入参。
 * - 投影是单向的：本模块只导出 Runtime → Enterprise / Employee 的方向；
 *   反向修改只能通过 `agent-runtime.*` Gateway RPC 端点触发。
 * - 投影输出在结构上不再承载 Runtime 内部字段，由 `isProjectionClean` 提供
 *   运行期校验（用于属性测试断言）。
 *
 * 三层映射规则总览：
 *
 * | Runtime 源                              | 企业端投影                  | 员工端投影         |
 * |-----------------------------------------|-----------------------------|--------------------|
 * | RuntimeHealth = healthy                 | "效果稳定"                  | "运行稳定"         |
 * | RuntimeHealth = degraded                | "偶尔结果不理想"            | "偶尔异常"         |
 * | RuntimeHealth = unhealthy               | "建议重新整理"              | "需要重新整理"     |
 * | RuntimeHealth = unavailable             | "已不适合继续推广"          | null（不展示）     |
 * | RuntimeLifecycle = deployed             | （无通知）                  | （无通知）         |
 * | RuntimeLifecycle = draining/suspended   | （无通知）                  | （无通知）         |
 * | RuntimeLifecycle = deprecated           | "即将下线"通知              | "即将下线"通知     |
 * | RuntimeLifecycle = archived             | "已下线"通知                | "已下线"通知       |
 * | BindingType = tenant-installed          | "员工自主安装"              | —                  |
 * | BindingType = platform-default          | "管理员推送"                | —                  |
 * | BindingType = dynamic-runtime           | "管理员推送"                | —                  |
 * | BindingType = fallback                  | "管理员推送"                | —                  |
 * | BindingState = active                   | "正常运行"                  | —                  |
 * | BindingState = warming                  | "待更新"                    | —                  |
 * | BindingState = degraded                 | "正常运行"（仍在工作）      | —                  |
 * | BindingState = disabled                 | "已暂停"                    | —                  |
 *
 * 上表对应 design.md "Property 1/2/3" 中描述的完备性、纯净性、幂等性要求。
 */

import type {
  BindingState,
  BindingType,
  RuntimeCapabilityBinding,
  RuntimeHealth,
  RuntimeLifecycle,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 投影目标类型 — 企业端
// ─────────────────────────────────────────────────────────────────────────

/**
 * 企业端健康状态投影（业务效果语言）。
 *
 * 与 `enterprise-capability/types.ts` 中的 `EnterpriseHealthStatus` 字面量一致；
 * 此处独立声明是为了保证 `runtime-canonical` 模块**零外部依赖**——`runtime-canonical`
 * 是上游模块，不可反向依赖企业端模块。两侧字面量必须完全相等才能在边界处赋值。
 */
export type EnterpriseHealthProjection =
  | "效果稳定"
  | "偶尔结果不理想"
  | "建议重新整理"
  | "已不适合继续推广";

/** 企业端 InstallRelation 投影（与 `enterprise-capability/types.ts` 中 InstallRelation 字段一致）。 */
export type EnterpriseInstallRelationProjection = {
  capabilityId: string;
  capabilityName: string;
  robotId: string;
  robotName: string;
  installedAt: number;
  source: "管理员推送" | "员工自主安装";
  status: "正常运行" | "已暂停" | "待更新";
};

/**
 * 生命周期通知。Runtime 进入 `deprecated` / `archived` 时，下游展示需要的通知载荷；
 * 其他生命周期下返回 null（不产生通知）。
 */
export type LifecycleNotificationProjection =
  | { kind: "deprecation-warning"; message: "即将下线" }
  | { kind: "archived-notice"; message: "已下线" }
  | null;

// ─────────────────────────────────────────────────────────────────────────
// 投影目标类型 — 员工端
// ─────────────────────────────────────────────────────────────────────────

/**
 * 员工端健康标签投影（员工语言，三态）。
 *
 * 注意：Runtime `unavailable` 投影到员工端时返回 null —— 员工端能力已不可用，
 * 整张能力卡片应被通知"已下线"或"即将下线"覆盖，而不是展示一个糟糕的健康标签。
 */
export type EmployeeHealthProjection = "运行稳定" | "偶尔异常" | "需要重新整理";

// ─────────────────────────────────────────────────────────────────────────
// 投影函数 — Runtime → Enterprise
// ─────────────────────────────────────────────────────────────────────────

/**
 * 将 RuntimeHealth 投影为企业端健康状态。
 *
 * 完备性保证：枚举的全部 4 个值都有非 undefined 的对应业务标签
 * （由 Property 1 验证）。
 */
export function projectHealthToEnterprise(health: RuntimeHealth): EnterpriseHealthProjection {
  switch (health) {
    case "healthy":
      return "效果稳定";
    case "degraded":
      return "偶尔结果不理想";
    case "unhealthy":
      return "建议重新整理";
    case "unavailable":
      return "已不适合继续推广";
  }
}

/**
 * 将 BindingType 投影为企业端"安装来源"。
 *
 * 业务语义：员工自主在工作台中点击安装的归为 `tenant-installed`，其余三类
 * （平台默认、动态运行时编排、降级备选）均由平台/管理员策略决定，统一展示
 * 为"管理员推送"。
 */
export function projectBindingTypeToSource(
  type: BindingType,
): EnterpriseInstallRelationProjection["source"] {
  switch (type) {
    case "tenant-installed":
      return "员工自主安装";
    case "platform-default":
    case "dynamic-runtime":
    case "fallback":
      return "管理员推送";
  }
}

/**
 * 将 BindingState 投影为企业端"安装状态"。
 *
 * 投影规则解释：
 * - `active`     → "正常运行"
 * - `warming`    → "待更新"（预热阶段对企业端等价于"等待版本就绪"）
 * - `degraded`   → "正常运行"（仍在服务，劣化由健康投影另行表达，不展示在状态徽章上）
 * - `disabled`   → "已暂停"
 */
export function projectBindingStateToStatus(
  state: BindingState,
): EnterpriseInstallRelationProjection["status"] {
  switch (state) {
    case "active":
    case "degraded":
      return "正常运行";
    case "warming":
      return "待更新";
    case "disabled":
      return "已暂停";
  }
}

/**
 * 将 RuntimeCapabilityBinding 投影为企业端 InstallRelation。
 *
 * 投影输出严格只承载企业端业务字段：能力 ID/名称、机器人 ID/名称、安装时间、
 * 安装来源、安装状态。Runtime 内部字段（bindingId、capabilityVersion、
 * routingPriority、loadStrategy、policy、fallbackBindingId、invocationMetrics 等）
 * **不**进入投影输出，由 Property 2（纯净性）验证。
 *
 * 投影 ID 的处理：考虑到企业端 InstallRelation 的 `id` 字段对应"安装关系"
 * 而非绑定本身，我们将 bindingId 作为稳定标识传递（同一绑定永远投影出相同 id），
 * 满足 Property 3（幂等性）。
 */
export function projectBindingToInstallRelation(
  binding: RuntimeCapabilityBinding,
  agentName: string,
  capabilityName: string,
): EnterpriseInstallRelationProjection {
  return {
    capabilityId: binding.capabilityId,
    capabilityName,
    robotId: binding.runtimeAgentId,
    robotName: agentName,
    installedAt: binding.createdAt,
    source: projectBindingTypeToSource(binding.bindingType),
    status: projectBindingStateToStatus(binding.bindingState),
  };
}

/**
 * 将 RuntimeLifecycle 投影为企业端/员工端共享的生命周期通知。
 *
 * 仅 `deprecated` 与 `archived` 产生通知，其他生命周期阶段返回 null
 * （`deployed`/`draining`/`suspended` 是运维内部状态，不应惊动业务侧）。
 */
export function projectLifecycleToNotification(
  lifecycle: RuntimeLifecycle,
): LifecycleNotificationProjection {
  switch (lifecycle) {
    case "deprecated":
      return { kind: "deprecation-warning", message: "即将下线" };
    case "archived":
      return { kind: "archived-notice", message: "已下线" };
    case "deployed":
    case "draining":
    case "suspended":
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 投影函数 — Runtime → Employee
// ─────────────────────────────────────────────────────────────────────────

/**
 * 将 RuntimeHealth 投影为员工端能力健康标签。
 *
 * `unavailable` 返回 null —— 此时应通过 `projectLifecycleToNotification` 配合的
 * "即将下线"/"已下线"通知告知员工，而不是把"已不适合继续推广"暴露给员工
 * （后者是企业管理员看到的运营语言）。
 */
export function projectHealthToEmployee(health: RuntimeHealth): EmployeeHealthProjection | null {
  switch (health) {
    case "healthy":
      return "运行稳定";
    case "degraded":
      return "偶尔异常";
    case "unhealthy":
      return "需要重新整理";
    case "unavailable":
      return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Projection Purity Guard — 运行期纯净性校验
// ─────────────────────────────────────────────────────────────────────────

/**
 * Runtime 内部字段黑名单。本列表中的任意键名出现在投影输出中即视为投影泄漏，
 * 应由 Property 2 在属性测试中拦截。
 *
 * 本数组对外公开（`as const` 字面量元组），方便属性测试直接迭代验证。
 */
export const RUNTIME_INTERNAL_FIELDS = [
  "bindingId",
  "routingPriority",
  "loadStrategy",
  "sandbox",
  "sandboxPolicy",
  "resourceQuota",
  "hotReloadable",
  "fallbackBindingId",
  "queueDepth",
  "memoryPressure",
  "runtimeVersion",
  "cpuPercent",
  "memoryPercent",
  "tokenBudgetUsedPercent",
  "policy",
  "invocationMetrics",
  "capabilityVersion",
  "bindingType",
  "bindingState",
  "healthStatus",
] as const;

export type RuntimeInternalField = (typeof RUNTIME_INTERNAL_FIELDS)[number];

const RUNTIME_INTERNAL_FIELD_SET: ReadonlySet<string> = new Set<string>(RUNTIME_INTERNAL_FIELDS);

/**
 * 仅当值为"普通对象"（即字面量对象 `{}` 或 `Object.create(null)`）时返回 true。
 * 数组、Date、Map、Set、类实例等宿主对象均返回 false，避免被错误地展开。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (Array.isArray(value)) {
    return false;
  }
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * 判定值在任意深度是否已不含 {@link RUNTIME_INTERNAL_FIELDS} 中的键。
 *
 * 用于属性测试断言：例如对 `projectBindingToInstallRelation(...)` 的输出
 * 调用 `isProjectionClean(output)` 必须始终为 true。
 *
 * 行为约定：
 * - 数组：递归检查每个元素
 * - 普通对象：检查每个键，命中黑名单则返回 false；否则递归检查值
 * - 原始值 / Date / Map / Set 等：视为干净（不可能承载这些键名）
 */
export function isProjectionClean(value: unknown): boolean {
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!isProjectionClean(entry)) {
        return false;
      }
    }
    return true;
  }

  if (!isPlainObject(value)) {
    return true;
  }

  for (const key of Object.keys(value)) {
    if (RUNTIME_INTERNAL_FIELD_SET.has(key)) {
      return false;
    }
    if (!isProjectionClean(value[key])) {
      return false;
    }
  }
  return true;
}
