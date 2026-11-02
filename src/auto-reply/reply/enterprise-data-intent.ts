import { textMentionsEnterpriseData } from "../../gateway/knowledge/enterprise-data-query.js";

/**
 * Explicit cloud-PC operation. Bare 登录 is not enough: a 用友 warehouse question
 * that mentions 登录 must stay on the knowledge feed, not open a blank noVNC.
 */
const EXPLICIT_CLOUD_PC_RE = /打开(?:云端)?电脑|云端电脑|云电脑|account computer|cloud pc/iu;

/**
 * Employee questions about materialized 用友 T+ / warehouse / inventory data.
 * These must not stay on the chat lane: chat disables tools, DeepSeek then emits
 * body DSML, and the protocol gate replies 「本步工具调用未能执行，请重试。」
 * An explicit 云电脑 request still wins so the desktop path stays available.
 */
export function isEnterpriseDataKnowledgeTurn(text: string): boolean {
  const raw = text.trim();
  if (!raw || EXPLICIT_CLOUD_PC_RE.test(raw)) {
    return false;
  }
  return textMentionsEnterpriseData(raw);
}
