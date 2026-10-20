/**
 * Format Utilities — 「能力使用管理」（enterprise-capability-usage-management）模块的业务化展示格式器。
 *
 * 模块定位：
 * 本文件是 `Runtime_Projection_Layer` 的展示降级层。投影层（`./projection.ts`）输出的纯数值
 * 字段（成功率、调用量、健康状态、最近活跃时间）在这里被格式化为业务语言展示串，并对越界 /
 * 缺失输入统一降级为占位文本 `"暂无数据"`。
 *
 * 落实需求：
 * - Requirement 8.3：成功率使用百分比格式（保留 1 位小数），不展示原始小数。
 * - Requirement 8.4：调用量使用千位分隔符整数格式，不展示科学计数法 / 频率单位。
 * - Requirement 8.5：健康状态只允许出现 4 个业务文本之一。
 * - Requirement 8.6：上游缺失或越界时降级为 `"暂无数据"`，不暴露原始值。
 * - Property 8（属性测试）：成功率与调用量格式化的正则不变量。
 *
 * 纯函数约束：
 * 本模块所有导出函数均为纯函数（无副作用、相同输入恒等输出），不发起网络调用、不读写
 * 持久化存储；可在 SSR / 浏览器 / 测试环境无差别复用。
 */

import {
  HEALTH_STATUSES,
  HEALTH_STATUS_NO_DATA,
  type HealthStatus,
  type HealthStatusNoData,
} from "./types.ts";

// ─────────────────────────────────────────────────────────────────────────
// 公共占位
// ─────────────────────────────────────────────────────────────────────────

/**
 * 格式化降级占位。与 `term-blacklist.ts` 中的 `BLACKLIST_DOWNGRADE_PLACEHOLDER` 在文本上等价
 * （都是 `"暂无数据"`），但语义来源不同：
 * - 此处占位代表"输入越界 / 缺失 / 不可格式化"
 * - 黑名单占位代表"上游字符串命中术语黑名单"
 * 二者在 UI 上呈现一致的"暂无数据"文本，落实 Requirement 8.6。
 */
export const FORMAT_NO_DATA_PLACEHOLDER = "暂无数据" as const;

// ─────────────────────────────────────────────────────────────────────────
// 数字千位格式器（en-US）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 调用量格式化使用 en-US locale 而非 zh-CN，原因：
 * - 跨平台一致性：部分 Node / 浏览器 / 移动 WebView 在 zh-CN 下会产出非 ASCII 千位分隔
 *   （如 `'1,000'` vs `'1\u00A01,000'` vs 阿拉伯数字符号），导致 `^[\d,]+$` 正则不变量失败。
 * - en-US 在所有主流引擎下均稳定输出 ASCII 半角逗号 `,` + ASCII 数字。
 * - 业务展示侧不依赖小数 / 货币，只需"千位分组的整数串"，en-US 完全满足。
 *
 * 落实 Requirement 8.4 与 Property 8（`^[\d,]+$`）。
 */
const EXECUTIONS_FORMATTER = new Intl.NumberFormat("en-US", {
  useGrouping: true,
  maximumFractionDigits: 0,
});

// ─────────────────────────────────────────────────────────────────────────
// 时间格式器（zh-CN，固定 YYYY-MM-DD HH:mm）
// ─────────────────────────────────────────────────────────────────────────

/**
 * 最近活跃时间使用 zh-CN locale 输出 `YYYY-MM-DD HH:mm` 形式（24 小时制）。
 *
 * 时区策略：使用宿主默认时区。理由：
 * - 企业管理后台用户分布在不同时区，强制 `Asia/Shanghai` 反而会让海外管理员看到与本地
 *   时间错位的时间戳；
 * - SSR 场景（如有）由调用方 `formatLastActiveAt(ts, { timeZone: "..." })` 显式传参覆盖。
 *
 * 落实业务降级展示需求（任务 1.4）。
 */
const LAST_ACTIVE_FORMATTER_DEFAULT = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

// ─────────────────────────────────────────────────────────────────────────
// 公共校验工具
// ─────────────────────────────────────────────────────────────────────────

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// ─────────────────────────────────────────────────────────────────────────
// formatSuccessRate
// ─────────────────────────────────────────────────────────────────────────

/**
 * 将成功率（[0, 1]）格式化为百分比展示串（保留 1 位小数）。
 *
 * 规则（Property 8）：
 * - 有效输入：`Number.isFinite(v) === true` 且 `v >= 0` 且 `v <= 1`
 * - 输出：`(v * 100).toFixed(1) + "%"`，匹配 `^\d{1,3}\.\d%$`
 * - 越界：`NaN` / `null` / `undefined` / 负数 / `>1` / 非有限数 → 返回 {@link FORMAT_NO_DATA_PLACEHOLDER}
 *
 * 示例：
 * - `formatSuccessRate(0.965)`  → `"96.5%"`
 * - `formatSuccessRate(0)`      → `"0.0%"`
 * - `formatSuccessRate(1)`      → `"100.0%"`
 * - `formatSuccessRate(-0.1)`   → `"暂无数据"`
 * - `formatSuccessRate(1.5)`    → `"暂无数据"`
 * - `formatSuccessRate(NaN)`    → `"暂无数据"`
 * - `formatSuccessRate(null)`   → `"暂无数据"`
 *
 * @param v 成功率原值（[0, 1] 区间内的有限数）
 */
export function formatSuccessRate(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  if (v < 0 || v > 1) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  // toFixed(1) 在 JS 引擎上对 [0, 1] 输入稳定输出 "0.0" ~ "100.0"
  return `${(v * 100).toFixed(1)}%`;
}

// ─────────────────────────────────────────────────────────────────────────
// formatExecutions
// ─────────────────────────────────────────────────────────────────────────

/**
 * 将调用量（非负整数）格式化为千位分隔的整数串。
 *
 * 规则（Property 8）：
 * - 有效输入：`Number.isFinite(v) === true` 且 `Number.isInteger(v) === true` 且 `v >= 0`
 * - 输出：使用 en-US locale 的 `Intl.NumberFormat`（保证 ASCII 千位分隔符 `,`），
 *   匹配 `^[\d,]+$`
 * - 越界：`NaN` / `null` / `undefined` / 负数 / 小数（如 `21.4`）/ 非有限数
 *   → 返回 {@link FORMAT_NO_DATA_PLACEHOLDER}
 *
 * 示例：
 * - `formatExecutions(0)`      → `"0"`
 * - `formatExecutions(1284)`   → `"1,284"`
 * - `formatExecutions(1000000)`→ `"1,000,000"`
 * - `formatExecutions(21.4)`   → `"暂无数据"`（业务约定：调用量必须是整数）
 * - `formatExecutions(-1)`     → `"暂无数据"`
 * - `formatExecutions(NaN)`    → `"暂无数据"`
 *
 * @param v 调用量原值（非负整数）
 */
export function formatExecutions(v: number | null | undefined): string {
  if (!isFiniteNumber(v)) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  if (v < 0 || !Number.isInteger(v)) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  return EXECUTIONS_FORMATTER.format(v);
}

// ─────────────────────────────────────────────────────────────────────────
// formatHealthStatus
// ─────────────────────────────────────────────────────────────────────────

const HEALTH_STATUS_SET: ReadonlySet<HealthStatus> = new Set<HealthStatus>(HEALTH_STATUSES);

/**
 * 健康状态业务降级展示。
 *
 * 规则（Requirement 8.5）：
 * - 当输入恰好是 {@link HEALTH_STATUSES} 中的某个文本（`效果稳定` / `偶尔不理想` /
 *   `建议优化` / `已停用`）→ 原样返回。
 * - 其它任意输入（`null` / `undefined` / 空串 / 平台原始枚举如 `"healthy"` /
 *   未识别字符串）→ 降级返回 {@link HEALTH_STATUS_NO_DATA}（即 `"暂无数据"`）。
 *
 * 注意：本函数**不**做大小写归一化或同义映射；运行时枚举到业务文本的映射应先经
 * `projectRuntimeHealthToEnterprise()`（投影层）处理，本函数只在视图层做最后一道
 * "白名单守卫"。
 *
 * @param s 健康状态原值（应已是业务文本之一）
 */
export function formatHealthStatus(
  s: string | null | undefined,
): HealthStatus | HealthStatusNoData {
  if (typeof s !== "string") {
    return HEALTH_STATUS_NO_DATA;
  }
  if (HEALTH_STATUS_SET.has(s as HealthStatus)) {
    return s as HealthStatus;
  }
  return HEALTH_STATUS_NO_DATA;
}

// ─────────────────────────────────────────────────────────────────────────
// formatLastActiveAt
// ─────────────────────────────────────────────────────────────────────────

/**
 * 最近活跃时间业务降级展示。
 *
 * 规则：
 * - 有效输入：`Number.isFinite(ts) === true` 且 `ts >= 0`（可被 `new Date(ts)` 解析为有效日期）
 * - 输出：`YYYY-MM-DD HH:mm`（24 小时制，zh-CN locale；时区由宿主默认决定）
 * - 越界：`null` / `undefined` / `NaN` / 负数（业务上不可能出现的负时间戳）/ 非有限数
 *   → 返回 {@link FORMAT_NO_DATA_PLACEHOLDER}
 *
 * 示例：
 * - `formatLastActiveAt(0)`             → `"1970-01-01 08:00"`（CST 时区下；其它时区按宿主决定）
 * - `formatLastActiveAt(Date.UTC(2024, 4, 6, 7, 30))` → `"2024-05-06 15:30"`（CST 时区下）
 * - `formatLastActiveAt(null)`          → `"暂无数据"`
 * - `formatLastActiveAt(NaN)`           → `"暂无数据"`
 *
 * @param ts 毫秒时间戳
 */
export function formatLastActiveAt(ts: number | null | undefined): string {
  if (!isFiniteNumber(ts) || ts < 0) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }

  // Intl.DateTimeFormat 在 zh-CN 下输出形如 "2024/05/06 15:30"（不同引擎可能用 `/` 或 `-` 分隔）；
  // 我们手工拼装 `YYYY-MM-DD HH:mm` 以保证跨引擎稳定。
  const parts = LAST_ACTIVE_FORMATTER_DEFAULT.formatToParts(date);
  const lookup: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  for (const p of parts) {
    lookup[p.type] = p.value;
  }
  const year = lookup.year;
  const month = lookup.month;
  const day = lookup.day;
  const hour = lookup.hour;
  const minute = lookup.minute;
  if (!year || !month || !day || !hour || !minute) {
    return FORMAT_NO_DATA_PLACEHOLDER;
  }
  // hour12: false 在某些引擎下仍可能输出 "24" 而非 "00"；归一化为 "00"。
  const normalizedHour = hour === "24" ? "00" : hour;
  return `${year}-${month}-${day} ${normalizedHour}:${minute}`;
}
