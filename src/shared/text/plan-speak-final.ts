/**
 * M2 finalization gate: plan-speak / "still working" prose must not be a
 * terminal assistant final. Rewrite to an explicit pause that asks the user
 * to confirm or take over (covers 高密度分析 early-final class).
 *
 * Short holding lines such as 「正在收尾排版，稍等片刻。」 are a different
 * class: the user already said go, and the line is not a decision. They are
 * detected by `isExecutionStallFinal` so the run can continue. Do not fold
 * them into `PLAN_SPEAK_MARKERS_RE` — that rewrite asks about price, spec,
 * and payment, which is the wrong pause for typeset/publish.
 *
 * Shopping CTA uses **positive admission** (checkout/cart/order/compare-price
 * markers, or a shopping user goal + lexicon). Bare 「价格」「支付」 words are
 * not enough. Non-shopping plan-speak stays progress text so stall continuation
 * can keep the turn moving. This module only rewrites visible text — it must
 * not create task pause or authorization state.
 */

/** User-facing pause when the model ends mid-plan without asking. */
export const PLAN_SPEAK_PAUSE_CTA =
  "任务还没做完。请确认下一步（选哪个价/规格/支付方式），或点「接管」在电脑里自己操作；也可以回我「继续」。";

/**
 * Incomplete action announcements that look like thinking / work-in-progress,
 * not a delivered answer or an explicit ask.
 */
const PLAN_SPEAK_MARKERS_RE =
  /(?:这一步正在做|正在做(?:中)?|我需要(?:把|先|再)?|我继续|随后我会|接下来我会|下一步我(?:会|要)|让我先|我会先|正在(?:排序|打开|加载|搜索|比价|结算)|稍等(?:一下|我)|马上(?:就|去)|我先去)/u;

/** Explicit user-facing pause / handoff — keep as a valid final. */
const EXPLICIT_PAUSE_RE = /请(?:确认|选择|接管|扫码|支付)|点「接管」|交给你|轮到你|你来扫|请你/u;

/**
 * Real user-directed questions. Must NOT match plan prose that merely mentions
 * 「哪一单」 (e.g. 「再决定下哪一单——这一步正在做」) — that is still early-final.
 * Require 「？」 or a clear ask stem (选哪个 / 要不要 / 下哪一单？).
 */
const ASKS_USER_RE =
  /[？?]|要不要|是否|选哪个|用哪个|(?:请?(?:你)?(?:选|要|买)|到底)哪[个一]|(?:哪[个一](?:个|款|件|双|家)?)[？?]|[下买选]哪一单[？?]/u;

/**
 * True when a stop-final assistant text is unfinished plan-speak rather than a
 * delivered result or an explicit confirm/takeover ask.
 */
export function isPlanSpeakFinal(text: string): boolean {
  const t = text.trim();
  if (!t) {
    return false;
  }
  if (EXPLICIT_PAUSE_RE.test(t) || ASKS_USER_RE.test(t)) {
    return false;
  }
  if (
    /\b(I('ll| will) (now |next )?(sort|open|check|continue|need to)|Let me (first|continue|sort))\b/i.test(
      t,
    )
  ) {
    return true;
  }
  return PLAN_SPEAK_MARKERS_RE.test(t);
}

/**
 * Completion-claim substitute (`FIXED_PROGRESS_TEMPLATE`). Already a deliberate
 * hold after a blocked completion claim — not a stall to auto-continue.
 */
const BLOCKED_COMPLETION_PROGRESS = "正在处理，结果尚未对外公布。";

/**
 * Whole-message holding lines the M2 marker list misses. Kept narrow so a
 * finished article that mentions 排版 is not treated as unfinished.
 */
const SHORT_HOLDING_MAX_CHARS = 80;
const SHORT_HOLDING_RE =
  /(?:正在收尾|收尾排版|正在排版|稍等片刻|请稍[等候]|马上就好|马上好了|正在渲染)/u;

/**
 * True when a stop-final is unfinished work the run should keep executing.
 * Includes M2 plan-speak and short wait lines such as 「正在收尾排版，稍等片刻。」.
 * Questions, explicit permission/payment pauses, and the blocked-completion
 * template stay terminal.
 */
export function isExecutionStallFinal(text: string): boolean {
  const t = text.trim();
  if (!t || t === BLOCKED_COMPLETION_PROGRESS) {
    return false;
  }
  if (EXPLICIT_PAUSE_RE.test(t) || ASKS_USER_RE.test(t)) {
    return false;
  }
  if (isPlanSpeakFinal(t)) {
    return true;
  }
  if (t.length > SHORT_HOLDING_MAX_CHARS) {
    return false;
  }
  return SHORT_HOLDING_RE.test(t);
}

/** Short factual lead before the first plan-speak marker (prices / status). */
function extractFactualLead(text: string): string {
  const match = PLAN_SPEAK_MARKERS_RE.exec(text);
  if (!match || match.index === undefined || match.index < 8) {
    const firstLine = text.split(/\n+/)[0]?.trim() ?? "";
    if (
      firstLine.length >= 8 &&
      firstLine.length <= 120 &&
      !PLAN_SPEAK_MARKERS_RE.test(firstLine) &&
      /[\u4e00-\u9fff\d¥￥]/.test(firstLine)
    ) {
      return firstLine;
    }
    return "";
  }
  const lead = text
    .slice(0, match.index)
    .replace(/[，,。；;、\s]+$/u, "")
    .trim();
  if (lead.length < 8 || lead.length > 160) {
    return "";
  }
  if (!/[\u4e00-\u9fff\d¥￥]/.test(lead)) {
    return "";
  }
  return lead;
}

/**
 * Weak shopping lexicon. Alone (e.g. 「价格」「支付」 in a research/analysis
 * sentence) does **not** prove the user needs a shopping decision pause.
 */
const SHOPPING_LEXICON_RE =
  /(?:价格|规格|尺码|支付|付款|收银台|购物车|下单|比价|结算|最低价|接管|[¥￥])/u;

/**
 * Positive admission markers in plan-speak itself: checkout / cart / order /
 * compare-price workflows, not bare price words.
 */
const SHOPPING_PAUSE_ADMISSION_RE =
  /(?:购物车|结算(?:页)?|收银台|下单|比价|加购|付款码|扫码支付|选哪个价|哪个规格|最低价|哪一单|尺码)/u;

/** User goal that positively frames the turn as shopping. */
const SHOPPING_GOAL_CONTEXT_RE =
  /(?:帮我买|去买|购买|下单|比价|加购|购物车|结算|京东|淘宝|拼多多|得物|买鞋|买件)/u;

/**
 * True when shopping pause CTA is positively admitted.
 * Bare 「价格」「支付」 / currency mentions are not enough without checkout-ish
 * admission or a shopping user goal.
 */
export function shouldApplyShoppingPauseCta(text: string, contextText = ""): boolean {
  const raw = text.trim();
  if (!raw || !isPlanSpeakFinal(raw)) {
    return false;
  }
  if (SHOPPING_PAUSE_ADMISSION_RE.test(raw)) {
    return true;
  }
  if (SHOPPING_GOAL_CONTEXT_RE.test(contextText) && SHOPPING_LEXICON_RE.test(raw)) {
    return true;
  }
  return false;
}

/**
 * Backward-compatible helper: plan-speak that must not become the shopping CTA.
 * Equivalent to plan-speak finals that fail positive shopping admission.
 */
export function shouldPreserveNonShoppingPlanSpeak(text: string, contextText = ""): boolean {
  const raw = text.trim();
  if (!raw || !isPlanSpeakFinal(raw)) {
    return false;
  }
  return !shouldApplyShoppingPauseCta(raw, contextText);
}

/**
 * If `text` is a plan-speak terminal **and** shopping pause is positively
 * admitted, rewrite to a pause CTA. Otherwise leave plan-speak alone (progress
 * / stall continue can keep moving). Keeps a short factual lead when present.
 * Reply rewrite never creates task pause or auth state — text only.
 */
export function rewritePlanSpeakFinal(text: string, contextText = ""): string {
  const raw = text.trim();
  if (!raw || !isPlanSpeakFinal(raw)) {
    return text;
  }
  if (!shouldApplyShoppingPauseCta(raw, contextText)) {
    return text;
  }
  const lead = extractFactualLead(raw);
  if (lead && lead !== PLAN_SPEAK_PAUSE_CTA) {
    return `${lead}\n\n${PLAN_SPEAK_PAUSE_CTA}`;
  }
  return PLAN_SPEAK_PAUSE_CTA;
}
