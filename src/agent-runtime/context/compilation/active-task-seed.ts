import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { readVisibleMessageText } from "./shrink-unit.js";

const MIN_EXPLICIT_GOAL_CHARS = 12;
const LONG_INSTRUCTION_CHARS = 24;
const ACTIVE_TASK_SEED_MAX_CHARS = 2_000;

const CONTINUATION_ONLY_RE =
  /^(?:继续|接着|然后呢?|好的?|嗯+|哦+|啊+|收到|谢谢|感谢|明白了?|可以|行|对|是的|ok|okay|hi|hello)[!！。.…?\s]*$/iu;

const EXPLICIT_GOAL_RE =
  /帮我|请你|请帮|麻烦|我要|我想|需要你|打开|下单|购买|挑选|搜索|查找|买一|支付|结算|加入|buy|order|purchase|open|search|find|help me|please/iu;

function isUserMessage(message: AgentMessage): boolean {
  return (message as { role?: unknown }).role === "user";
}

export function isExplicitUserGoal(text: string): boolean {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length < MIN_EXPLICIT_GOAL_CHARS) {
    return false;
  }
  if (
    trimmed.startsWith("[Compiled operating context") ||
    trimmed.startsWith("[HEARTBEAT") ||
    trimmed.startsWith("[CRON_") ||
    trimmed.startsWith("[FOCUS_")
  ) {
    return false;
  }
  if (CONTINUATION_ONLY_RE.test(trimmed)) {
    return false;
  }
  if (EXPLICIT_GOAL_RE.test(trimmed)) {
    return true;
  }
  return trimmed.length >= LONG_INSTRUCTION_CHARS;
}

/**
 * Last user turn that states a goal. Short follow-ups such as "继续" or
 * "帮我进行支付" do not replace an earlier explicit request.
 */
export function seedActiveTaskFromMessages(messages: AgentMessage[]): string {
  let last = "";
  for (const message of messages) {
    if (!isUserMessage(message)) {
      continue;
    }
    const text = readVisibleMessageText(message).replace(/\s+/g, " ").trim();
    if (!isExplicitUserGoal(text)) {
      continue;
    }
    last = text;
  }
  return last.length > ACTIVE_TASK_SEED_MAX_CHARS
    ? last.slice(0, ACTIVE_TASK_SEED_MAX_CHARS)
    : last;
}
