/**
 * 席位 AI 规则长度上限。
 * 不要复用工作区引导文件的 20_000 / 150_000，否则席位文本会淹没岗位和机器人指令。
 * 见 docs/design/seat-ai-rules-and-execution-policy-priority-2026-10-07.md
 */
export const SEAT_RULE_MAX_CHARS = 500;
export const SEAT_RULES_MAX_TOTAL_CHARS = 2_000;
export const SEAT_RULES_MAX_COUNT = 8;

/** 与 JS 字符串长度一致，空白计入。超限整次拒绝，不截断。 */
export function countSeatRuleChars(text: string): number {
  return text.length;
}
