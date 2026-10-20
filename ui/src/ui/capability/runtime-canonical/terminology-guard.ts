/**
 * Runtime Terminology Guard — Agent Runtime Center 的术语边界守卫。
 *
 * 用途：
 * 防止业务语言（"贡献绩效"、"企业价值"、"复用价值评分"）和员工语言
 * （"我的能力"、"机器人会做什么"、"能力积累"）渗透到平台运行时层的 UI 输出，
 * 维护三层架构的术语隔离。
 *
 * 双重防御：
 * 1. **运行期属性测试**：本模块导出的纯函数 {@link containsForbiddenBusinessTerm}
 *    可在任意字符串 / DOM 渲染输出上执行。
 * 2. **构建期扫描**：与之配套的 `scripts/check-platform-runtime-terminology.mjs`
 *    （未来落地）会读取本模块的黑名单常量并扫描 `ports/platform/agents/`、
 *    `capability/agent-runtime/`、`capability/runtime-canonical/` 目录下的所有
 *    源文件与 i18n 资源，命中即拒绝构建。
 *
 * 注意：本守卫**不**对 RuntimeLifecycle / RuntimeHealth 枚举常量本身做拦截，
 * 因为这些是平台运行时层的合法术语；它仅拦截**业务语言**与**员工语言**。
 */

/**
 * 业务术语黑名单（企业端的业务语言）。
 *
 * 这些词汇属于 enterprise-capability 模块，不应出现在 Agent Runtime Center 的
 * UI / i18n / Source code 字符串字面量中。
 */
export const FORBIDDEN_BUSINESS_TERMS = [
  "贡献绩效",
  "企业价值",
  "复用价值",
  "复用价值评分",
  "覆盖部门",
  "部门覆盖",
  "业务场景",
  "使用场景", // 与"业务场景"近义；运维侧应使用"调用场景"
  "适用对象",
  "能力成熟度",
  "已不适合继续推广",
  "建议重新整理", // 企业端业务效果语言；运行时层使用 "unhealthy"
  "偶尔结果不理想", // 企业端业务效果语言；运行时层使用 "degraded"
  "效果稳定", // 企业端业务效果语言；运行时层使用 "healthy"
  "企业能力中心",
  "企业能力资产库",
  "企业认证",
  "企业标准",
  "核心资产",
  "初步形成",
  "稳定使用",
  "多人复用",
  "贡献排行榜",
  "贡献者",
  "本月活跃贡献者",
] as const;

/**
 * 员工语言术语黑名单（员工端的工作台语言）。
 *
 * 这些词汇属于 employee-capability 模块的"员工能力层"，运维侧的 Agent Runtime
 * Center 不应出现这些表达。
 */
export const FORBIDDEN_EMPLOYEE_TERMS = [
  "我的能力",
  "我的能力积累",
  "能力积累",
  "机器人会做什么",
  "运行稳定", // 员工语言；运行时层使用 "healthy"
  "偶尔异常", // 员工语言；运行时层使用 "degraded"
  "需要重新整理", // 员工语言；运行时层使用 "unhealthy"
  "草稿：系统正在帮你整理",
  "正在被这些机器人使用",
  "来源机器人",
] as const;

/**
 * 完整的禁用术语集合（业务 + 员工语言）。
 */
export const FORBIDDEN_TERMS_ALL: readonly string[] = [
  ...FORBIDDEN_BUSINESS_TERMS,
  ...FORBIDDEN_EMPLOYEE_TERMS,
];

/**
 * 检查给定字符串是否包含任何禁用术语。
 *
 * 本函数为纯函数：相同输入永远返回相同结果，不修改入参。
 *
 * @param text          被检测的字符串（通常是 DOM 文本输出或 i18n 资源值）
 * @param customDenyList 可选的额外黑名单；若提供，则与默认黑名单合并
 * @returns 命中术语数组（未命中返回空数组）。返回**全部**命中条目而非提前 short-circuit，
 *          以便构建期扫描可一次性报告所有违规位置。
 */
export function findForbiddenTermsIn(text: string, customDenyList?: readonly string[]): string[] {
  const list: readonly string[] = customDenyList
    ? [...FORBIDDEN_TERMS_ALL, ...customDenyList]
    : FORBIDDEN_TERMS_ALL;
  const found: string[] = [];
  for (const term of list) {
    if (text.includes(term)) {
      found.push(term);
    }
  }
  return found;
}

/**
 * 二值化版本：仅返回是否存在违规。
 */
export function containsForbiddenBusinessTerm(text: string): boolean {
  return findForbiddenTermsIn(text).length > 0;
}
