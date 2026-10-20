/**
 * EnterpriseCapabilityProjection — 企业能力中心的"网关边界投影层"。
 *
 * 架构作用：
 * 本模块是企业资产层与平台运行时层之间的强制屏障。所有从后端流向企业前端的
 * 数据必须经过 {@link projectToEnterpriseView} 处理，剥离任何运行时字段
 * （prompt / workflowJson / toolchain / modelRouting / provider /
 * memoryStrategy / executionPolicy / routingHints / modelPreferences），
 * 确保企业管理员界面仅暴露业务能力视图。
 *
 * 设计契约（参见 design.md "Property 1: EnterpriseCapabilityProjection 投影正确性"）：
 *
 *   ∀ input. fields(projectToEnterpriseView(input)) ∩ RUNTIME_FIELDS = ∅
 *
 * 即对任意输入（含嵌套对象、数组、混合结构），投影输出在任意深度均不再包含
 * 任何 RUNTIME_FIELDS 中列出的键名。该不变量由属性测试持续验证
 * （ui/src/ui/capability/enterprise-capability/__tests__/projection.property.test.ts）。
 *
 * 实现要点：
 * - 纯函数，不修改入参（深度复制经过的对象/数组）
 * - 仅展开"普通对象"与数组；保留 Date、Map、Set 等宿主对象原样不动
 * - 返回类型沿用入参泛型 T，调用方可直接类型断言；
 *   运行时由本模块统一保证字段剥离
 */

/**
 * 运行时字段黑名单。任何键名命中此列表的属性均会在投影时被剔除（任意深度）。
 *
 * 与需求 12.1 / 21.1 / 21.2 中列举的运行时字段一一对应。
 */
export const RUNTIME_FIELDS = [
  "prompt",
  "workflowJson",
  "toolchain",
  "modelRouting",
  "provider",
  "memoryStrategy",
  "executionPolicy",
  "routingHints",
  "modelPreferences",
] as const;

/** 运行时字段名称的字面量联合类型，由 {@link RUNTIME_FIELDS} 派生。 */
export type RuntimeField = (typeof RUNTIME_FIELDS)[number];

/** 用于 O(1) 命中判定的内部集合；值的字符串面与 RUNTIME_FIELDS 完全一致。 */
const RUNTIME_FIELD_SET: ReadonlySet<string> = new Set<string>(RUNTIME_FIELDS);

/**
 * 仅当值为"普通对象"（即字面量对象 `{}` 或 `Object.create(null)`）时返回 true。
 * 数组、Date、Map、Set、类实例等宿主/容器对象均返回 false，避免被错误地展开。
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
 * 递归构造投影副本。对原始值 / null / undefined / Date / 非普通对象按引用透传，
 * 对数组逐项递归，对普通对象逐键过滤后递归。
 */
function projectValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => projectValue(entry));
  }

  if (!isPlainObject(value)) {
    // 原始值（含 null/undefined）、Date、Map、Set 等保持原样。
    return value;
  }

  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (RUNTIME_FIELD_SET.has(key)) {
      continue;
    }
    projected[key] = projectValue(value[key]);
  }
  return projected;
}

/**
 * 将任意网关响应载荷投影为企业视图：在任意深度递归剥离 {@link RUNTIME_FIELDS}
 * 中的字段，其余字段保持不变并被复制到新对象上。
 *
 * 类型签名沿用入参 `T`，调用方据此进行类型断言；运行时由本函数统一保证字段
 * 集合与 RUNTIME_FIELDS 不相交（参见 design.md Property 1）。
 *
 * 行为约定：
 * - 不修改入参（数组 / 对象均产生新引用）
 * - 处理：普通对象、数组（含嵌套数组）、null / undefined、字符串 / 数字 / 布尔
 * - 保留：Date 等宿主对象按引用原样返回
 *
 * @param raw 任意原始数据（通常来自 gateway RPC 响应）
 * @returns  投影后的同构副本，在任意深度均不含 RUNTIME_FIELDS
 */
export function projectToEnterpriseView<T>(raw: T): T {
  return projectValue(raw) as T;
}

/**
 * 判定值在任意深度是否已不含 {@link RUNTIME_FIELDS} 中的键。
 * 用于属性测试断言：`isProjectionClean(projectToEnterpriseView(x)) === true`。
 *
 * @param obj 任意被检验的对象 / 数组 / 原始值
 * @returns   true 表示干净（无运行时字段泄露），false 表示存在泄露
 */
export function isProjectionClean(obj: unknown): boolean {
  if (Array.isArray(obj)) {
    for (const entry of obj) {
      if (!isProjectionClean(entry)) {
        return false;
      }
    }
    return true;
  }

  if (!isPlainObject(obj)) {
    // 原始值、Date、Map、Set 等不可能承载运行时字段名 → 视为干净。
    return true;
  }

  for (const key of Object.keys(obj)) {
    if (RUNTIME_FIELD_SET.has(key)) {
      return false;
    }
    if (!isProjectionClean(obj[key])) {
      return false;
    }
  }
  return true;
}
