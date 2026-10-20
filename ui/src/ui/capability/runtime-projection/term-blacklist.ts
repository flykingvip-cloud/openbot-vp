/**
 * Term Blacklist — 「能力使用管理」（enterprise-capability-usage-management）模块的术语守卫。
 *
 * 用途：
 * 防止平台运行时与平台技术术语（runtime / agent / template / cpu / memory ...）渗透到企业端
 * 「能力使用管理」模块的任意渲染输出（KPI 文案、表格单元格、徽章、提示语、错误信息、空状态、
 * 对话框、详情面板、图表 tooltip 等）。本模块是 Runtime_Projection_Layer 的一部分，
 * 与之配套的还有 `governance-detector.ts`、`projection.ts`、`format.ts`。
 *
 * 双重防御：
 *   1. **运行期 / 渲染期**：本模块的 {@link scanText}、{@link scanNode}、
 *      {@link assertNoBlacklistedTerm} 可在投影边界、渲染前、属性测试中被调用。
 *   2. **构建期**：与之配套的 `scripts/enterprise-usage-terminology-lint.ts`（Task 3.1）会
 *      读取本模块的 {@link TERM_BLACKLIST} 常量并扫描视图源文件 / i18n key 值，命中即拒绝构建。
 *
 * 落实需求：Requirements 8.1（术语黑名单），8.6（投影层降级）；
 *           Property 1（术语黑名单守卫，文本子集 + DOM 端到端）。
 *
 * 注意：本文件本身存放黑名单 token 的字符串字面量，是构建期 lint 扫描的**源头**；
 * 构建期 lint 必须忽略本文件，否则会自命中。
 */

// LINT-SCANNER-IGNORE: blacklist token source of truth
// 本文件包含术语黑名单 token 的 string literal；构建期 lint 必须跳过本文件。
// scripts/enterprise-usage-terminology-lint.ts 通过文件路径白名单实现忽略。
export const TERM_BLACKLIST = [
  "runtime",
  "agent",
  "template",
  "cpu",
  "memory",
  "node",
  "presence",
  "qps",
  "tps",
  "latency",
  "p95",
  "p99",
  "provider",
  "model routing",
  "workflow json",
  "toolchain",
] as const;

export type BlacklistedTerm = (typeof TERM_BLACKLIST)[number];

/** 渲染期的统一降级占位符；命中黑名单时由本模块替换为此值。 */
export const BLACKLIST_DOWNGRADE_PLACEHOLDER = "暂无数据";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 单一编译后的不区分大小写正则，覆盖全部黑名单 token：
 *   - 多 token 短语（如 "model routing"）以 `\s+` 连接两个转义后的 token
 *   - 所有 token 加上 `\b...\b` 单词边界，避免误伤合法业务词缀
 *
 * 已知 trade-off：所有 token 当前都是 ASCII 英文单词或短语；如未来扩展为含中文 / 标点
 * 的词条，需要重新评估 `\b` 边界规则（中文边界 `\b` 行为与 ASCII 不同）。
 */
const PATTERN_SOURCE = TERM_BLACKLIST.map((term) => {
  const parts = term.trim().split(/\s+/u).map(escapeRegExp);
  const body = parts.join("\\s+");
  return `\\b${body}\\b`;
}).join("|");

const SCAN_PATTERN = new RegExp(PATTERN_SOURCE, "iu");
const SCAN_PATTERN_GLOBAL_SOURCE = PATTERN_SOURCE;

/**
 * 扫描任意字符串。
 *
 * @returns 命中时返回首个命中 token（小写规范化以便与 {@link TERM_BLACKLIST} 对齐）；
 *          未命中返回 `null`。
 */
export function scanText(text: string): string | null {
  if (!text) {
    return null;
  }
  const match = text.match(SCAN_PATTERN);
  if (!match || !match[0]) {
    return null;
  }
  // 多空白短语（"Model   Routing"）规范化为单空格小写形式，确保返回值在 TERM_BLACKLIST 集合内
  return match[0].toLowerCase().replace(/\s+/gu, " ");
}

/**
 * 扫描 DOM 子树的所有文本节点。
 *
 * 用 `document.createTreeWalker` 仅遍历文本节点（`NodeFilter.SHOW_TEXT`）。命中后立即返回
 * 首个命中 token（小写）；未命中返回 `null`。
 *
 * 主要用于：
 *   - 渲染期属性测试（Task 13.3 DOM 端到端属性测试）
 *   - 开发期断言（在 view 渲染完成后扫描整棵 surface 子树）
 */
export function scanNode(root: Node): string | null {
  // root 自身可能就是 TextNode（TreeWalker 默认会跳过 root 自身），先单独检查
  if (root.nodeType === 3 /* TEXT_NODE */) {
    return scanText(root.textContent ?? "");
  }

  // root 可能是 Document 自身（nodeType === 9），或挂在某个 Document 上的 Element / DocumentFragment
  const ownerDoc: Document | null =
    root.nodeType === 9 /* DOCUMENT_NODE */ ? (root as unknown as Document) : root.ownerDocument;
  if (!ownerDoc) {
    return null;
  }

  const walker = ownerDoc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current: Node | null = walker.nextNode();
  while (current) {
    const text = current.textContent ?? "";
    if (text) {
      const hit = scanText(text);
      if (hit !== null) {
        return hit;
      }
    }
    current = walker.nextNode();
  }
  return null;
}

/**
 * 在投影边界 / 渲染前的字符串边界使用。
 *
 *   - `mode === "throw"`：命中即抛错（用于开发期 / 单元测试 / 构建期，让违规尽早暴露）。
 *   - `mode === "downgrade"`：命中时返回 {@link BLACKLIST_DOWNGRADE_PLACEHOLDER}（"暂无数据"）
 *     并通过 `console.warn` 记一条警告，附带命中 token + 入参文本片段（截断到 64 字符）。
 *
 * 未命中时原样返回入参字符串。
 */
export function assertNoBlacklistedTerm(
  text: string,
  opts: { mode: "throw" | "downgrade" },
): string {
  const hit = scanText(text);
  if (hit === null) {
    return text;
  }

  if (opts.mode === "throw") {
    throw new Error(
      `enterprise-capability-usage-management terminology violation: blacklisted token "${hit}" found in text: ${truncateForLog(text)}`,
    );
  }
  // downgrade —— 投影层降级路径需要可观测性
  console.warn(
    `[enterprise-usage] blacklisted term "${hit}" downgraded to "${BLACKLIST_DOWNGRADE_PLACEHOLDER}"; offending text: ${truncateForLog(text)}`,
  );
  return BLACKLIST_DOWNGRADE_PLACEHOLDER;
}

function truncateForLog(text: string, maxLength = 64): string {
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}…`;
}

// 仅供属性测试 / 调试使用：暴露 pattern 源串以便 mocha-/vitest-friendly 可读断言。
export const __INTERNAL_PATTERN_SOURCE_FOR_TESTS = SCAN_PATTERN_GLOBAL_SOURCE;
