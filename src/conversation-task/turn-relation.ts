/**
 * Relation of an incoming user turn to the current session task.
 * Only `new_work` may park, cut context, and abort the in-flight run.
 * Group correction routing uses the same prior-utterance predicate.
 */
import { isWeakNewWorkCueOnly } from "./qualification.js";

export type TurnRelation = "amend" | "aside" | "new_work";

const INBOUND_STAMP_RE = /^\[[A-Za-z]{3} \d{4}-\d{2}-\d{2} [0-9:]{4,8} GMT[+-]\d+\]\s*/;

const DECORATIVE_TITLE_LINE = /^(?:[「」『』【】（）()[\]"'“”‘’*#\-_—…·`\s])+$/u;

/** Language follow-up. One-to-one turns are aside; groups route them to the last speaker. */
export const LANGUAGE_ASIDE_RE =
  /^(请)?(输出|用|改成|换成)?(简体)?中文(回复|回答|输出)?[!！。.\s]*$/u;

export const PRIOR_UTTERANCE_CORRECTION_MAX_CHARS = 80;

/**
 * Starts a correction of the previous sentence.
 * Deliberately does not match 「另外…」 or 「新任务」 openers.
 */
export const PRIOR_UTTERANCE_CORRECTION_START_RE =
  /^(?:我(?:并)?(?:没有|没|不是|并不是)|我(?:是说|的意思是|说的是|指的是|要的是|问的是|刚才说|刚刚说)|不是|不对|并不是|并没有|错了|搞错了?|理解错了?|你(?:理解错|搞错|误会|说错|弄错|没理解|没明白|没看懂)|其实|为什么|为啥|怎么会|补充一下|再(?:解释|展开|详细)|继续)/u;

export const PRIOR_UTTERANCE_CORRECTION_ANYWHERE_RE =
  /误会了|理解错|搞错了|弄错了|不是这个意思|并没有让你|我没有让你|我没说|你说的不对/u;

const AMEND_CONSTRAINT_RE =
  /继续|接着|然后|再补|补一|补上|加上|补充|加一节|多写一节|交叉验证|在此基础上|同样按照|进度|做到哪|怎么样了|还差|约束|口径|改成|改为|改一下|不要超过|当前(?:你做的)?(?:这个|这份)?工作|刚才/u;

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

export function stripInboundStamp(text: string): string {
  return text.replace(INBOUND_STAMP_RE, "").trim();
}

function normalizeTitleLine(line: string): string {
  return line
    .replace(/^#+\s*/, "")
    .replace(/^\*+\s*|\s*\*+$/g, "")
    .replace(/^[「『【]\s*|\s*[」』】]$/g, "")
    .trim();
}

export function titleFromGoal(text: string): string {
  const cleaned = stripInboundStamp(text);
  const first = cleaned
    .split(/\r?\n/)
    .map((line) => normalizeTitleLine(line))
    .find(
      (line) =>
        line &&
        !line.startsWith("[") &&
        !DECORATIVE_TITLE_LINE.test(line) &&
        !line.startsWith("任务目标"),
    );
  const compactTitle = (first ?? normalizeTitleLine(cleaned.replace(/\s+/g, " ")))
    .replace(/\s+/g, " ")
    .trim();
  return compactTitle.length > 36 ? `${compactTitle.slice(0, 36)}…` : compactTitle;
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

/** Same prior-utterance judgment the group correction window uses. */
export function isPriorUtteranceCorrection(message: string | undefined): boolean {
  const compactText = message?.replace(/\s+/g, "").trim() ?? "";
  if (
    !compactText ||
    compactText.includes("@") ||
    compactText.length > PRIOR_UTTERANCE_CORRECTION_MAX_CHARS
  ) {
    return false;
  }
  return (
    PRIOR_UTTERANCE_CORRECTION_START_RE.test(compactText) ||
    PRIOR_UTTERANCE_CORRECTION_ANYWHERE_RE.test(compactText)
  );
}

/**
 * Classify before the task board mutates focus.
 * `amend` and `aside` stay on the current task. Only `new_work` may cut context.
 */
export function classifyTurnRelation(incoming: string, currentGoal: string): TurnRelation {
  const text = stripInboundStamp(incoming);
  if (!text || text.startsWith("/")) {
    return "aside";
  }
  if (isLanguageAsideMessage(text)) {
    return "aside";
  }
  if (LEAVE_CURRENT_RE.test(text)) {
    return "new_work";
  }
  if (isPriorUtteranceCorrection(text)) {
    return "amend";
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
    return "aside";
  }
  if (isWeakNewWorkCueOnly(text)) {
    return "aside";
  }
  if (DISTINCT_IMPERATIVE_RE.test(text) && !sharesDistinctivePhrase(text, currentGoal)) {
    return "new_work";
  }
  return "aside";
}

/** In-flight runs abort with task-park only when the turn actually cuts context. */
export function shouldTaskParkAbortInFlight(cutContext: boolean): boolean {
  return cutContext;
}
