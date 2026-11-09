import { stripInboundStamp } from "../agent-runtime/policy/index.js";
export { stripInboundStamp } from "../agent-runtime/policy/index.js";
import { titleFromGoal } from "../agent-runtime/context/sources/task-title.js";
export { titleFromGoal } from "../agent-runtime/context/sources/task-title.js";
export { shouldTaskParkAbortInFlight } from "../agent-runtime/policy/index.js";
import {
  isOwnerExecutionBarrierUtterance,
  isPriorUtteranceCorrection,
} from "../agent-runtime/policy/index.js";
export {
  PRIOR_UTTERANCE_CORRECTION_ANYWHERE_RE,
  PRIOR_UTTERANCE_CORRECTION_MAX_CHARS,
  PRIOR_UTTERANCE_CORRECTION_START_RE,
  isBareContinueCue,
  isOwnerConstraintFullReplace,
  isOwnerConstraintRevision,
  isOwnerExecutionBarrierUtterance,
  isPriorUtteranceCorrection,
  shouldPersistOwnerConstraint,
} from "../agent-runtime/policy/index.js";
/**
 * Relation of an incoming user turn to the current session task.
 * Only `new_work` may park, cut context, and abort the in-flight run.
 * Group correction routing uses the same prior-utterance predicate.
 */
import { isWeakNewWorkCueOnly } from "./qualification.js";

export type TurnRelation = "amend" | "conversation" | "new_work";

/** Language follow-up. One-to-one turns are aside; groups route them to the last speaker. */
export const LANGUAGE_ASIDE_RE =
  /^(请)?(输出|用|改成|换成)?(简体)?中文(回复|回答|输出)?[!！。.\s]*$/u;

const AMEND_CONSTRAINT_RE =
  /继续|接着|然后|再补|补一|补上|加上|增加|补充|加一节|多写一节|交叉验证|在此基础上|同样按照|进度|做到哪|怎么样了|还差|约束|口径|改成|改为|改一下|不要超过|当前(?:你做的)?(?:这个|这份)?工作|刚才|先别(?:发布|发出|发送|付款|支付|下单)|不要(?:付款|支付|发布|发出|发送|下单)|别发布|禁止(?:付款|支付|发布)/u;

/**
 * Same-goal appendix / next chapter / charts — stay amend (v2 wording).
 * Explicit pause-and-do-B / sure distinct goal still → new_work.
 */
const SAME_GOAL_APPENDIX_RE =
  /下一章|下[一]?章|附录|加[上个]?图表|补充图表|加图|(?<!继)续写(?:本章|本节)?|下一节|多写一[章节]|加一[章节]|出图表|补图表/u;

/** Explicit switch. Weak cues (输出 / 阅读 / 请先 / 调研) are not in this set. */
const EXPLICIT_NEW_WORK_RE =
  /不要做刚才|别做刚才|先放下|换[一个]个?题|现在改做|新任务|请不要先问我|请使用\s*[\w.-]+|做一次|生成今日|先出|交接给|另外[帮再]|调研问题[:：]|任务目标[:：]/u;

const LEAVE_CURRENT_RE = /不要做刚才|别做刚才|先放下|换[一个]个?题|现在改做|新任务|请不要先问我/u;

const DISTINCT_IMPERATIVE_RE = /请做|整理|起草|写一|出一份|分析|制作|列出/u;

const SHORT_ASIDE_RE =
  /^(?:好的?|嗯+|哦+|啊+|收到|谢谢|感谢|明白了?|可以|行|对|是的|没错|ok|okay|晚上好|早上好|你好|嗨|在吗)[!！。.?？\s]*$/iu;

const ADDRESS_ASIDE_RE = /叫我|怎么称呼|称呼我/u;

function compact(text: string): string {
  return text.replace(/\s+/g, "").trim();
}

function withoutRejections(text: string): string {
  return text
    .replace(/请不要先问我[。.]?/g, " ")
    .replace(/不要做刚才的?[^。；;\n]*/g, " ")
    .replace(/别做刚才的?[^。；;\n]*/g, " ")
    .replace(/不要输出[^。；;\n]*/g, " ")
    .replace(/不要生成[^。；;\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sharesDistinctivePhrase(incoming: string, currentGoal: string): boolean {
  const incomingClean = withoutRejections(incoming);
  const title = titleFromGoal(currentGoal).replace(/…$/, "").replace(/\s+/g, "");
  if (title.length >= 4 && incomingClean.includes(title.slice(0, Math.min(8, title.length)))) {
    return true;
  }
  let hits = 0;
  for (let i = 0; i + 4 <= title.length; i++) {
    const window = title.slice(i, i + 4);
    if (incomingClean.includes(window)) {
      hits += 1;
    }
  }
  return hits >= 2;
}

export function isLanguageAsideMessage(message: string | undefined): boolean {
  const compactText = message?.replace(/\s+/g, "").trim() ?? "";
  if (!compactText || compactText.includes("@")) {
    return false;
  }
  return LANGUAGE_ASIDE_RE.test(compactText);
}

export type TurnRelationContext = {
  /** Present so callers need not concatenate constraint history into `incoming`. Unused for regex. */
  activeConstraints?: readonly string[];
};

/**
 * Legacy semantic relation. Not a policy authority and not the live abort predicate.
 * Production abort uses {@link shouldTaskParkAbortInFlight}. This classifier stays
 * on the optional complex-task observer and must not be promoted to command policy.
 * `amend` and `conversation` stay on the current task. Only `new_work` may cut context.
 * Only `incoming` + `currentGoal` are scanned — never a pasted constraint history blob.
 * Title text comes from context `titleFromGoal`; this function does not own title generation.
 */
export function classifyTurnRelation(
  incoming: string,
  currentGoal: string,
  _context?: TurnRelationContext,
): TurnRelation {
  const text = stripInboundStamp(incoming);
  if (!text || text.startsWith("/")) {
    return "conversation";
  }
  if (isLanguageAsideMessage(text)) {
    return "conversation";
  }
  if (LEAVE_CURRENT_RE.test(text)) {
    return "new_work";
  }
  if (isPriorUtteranceCorrection(text)) {
    return "amend";
  }
  // Owner explicitly marks the turn as unrelated to the current task — ordinary
  // conversation, even when the body mentions words that also appear in constraint cues
  // (e.g. an essay topic containing「约束」). Do not swallow into amend/steer.
  if (/(?:与(?:当前)?任务无关|不(?:要|用)改(?:当前)?任务)/u.test(text.replace(/\s+/g, ""))) {
    return "conversation";
  }
  // Classify requests to recall a prior answer by their action, not a lane label.
  // Explicit task limits must still reach the task mutation path.
  if (
    !isOwnerExecutionBarrierUtterance(text) &&
    /(?:回顾|复述|回忆|重述|回答的.*(?:是什么|什么)|答案(?:是什么|是什么内容))/u.test(text) &&
    !/(?:增加|补充|改为|改成|必须|禁止)/u.test(text) &&
    !EXPLICIT_NEW_WORK_RE.test(text) &&
    !DISTINCT_IMPERATIVE_RE.test(text)
  ) {
    return "conversation";
  }
  // Same-goal appendix / next chapter / charts stay amend (v2); do not over-flip.
  if (SAME_GOAL_APPENDIX_RE.test(text) && !LEAVE_CURRENT_RE.test(text)) {
    return "amend";
  }
  // 「请继续」 alone amends the current focus. Continue + sure distinct goal
  // (non-overlapping topic / explicit new work) may insert — not proven as the
  // sole accident root cause; treat as product binding rule only.
  if (AMEND_CONSTRAINT_RE.test(text)) {
    if (sharesDistinctivePhrase(text, currentGoal)) {
      return "amend";
    }
    // Only escalate when the amend hit is a continue-family cue plus a distinct
    // topic. Do not flip 「当前这个工作…交接给…」 (amend + explicit) into new_work.
    const continueFamily = /(继续|接着|然后)/u.test(text);
    if (continueFamily) {
      if (EXPLICIT_NEW_WORK_RE.test(text) || DISTINCT_IMPERATIVE_RE.test(text)) {
        return "new_work";
      }
      const afterContinue = text.replace(/^(请)?(继续|接着|然后)[，,、。.\s]*/u, "").trim();
      if (afterContinue.length >= 8 && afterContinue !== text.trim()) {
        return "new_work";
      }
    }
    return "amend";
  }
  if (EXPLICIT_NEW_WORK_RE.test(text) && !sharesDistinctivePhrase(text, currentGoal)) {
    return "new_work";
  }
  if (SHORT_ASIDE_RE.test(compact(text)) || ADDRESS_ASIDE_RE.test(text)) {
    return "conversation";
  }
  if (isWeakNewWorkCueOnly(text)) {
    return "conversation";
  }
  if (DISTINCT_IMPERATIVE_RE.test(text) && !sharesDistinctivePhrase(text, currentGoal)) {
    return "new_work";
  }
  return "conversation";
}
