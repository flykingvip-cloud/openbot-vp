/**
 * Plan-speak / "still working" detection for the **executor** continue path,
 * plus a reply-layer pass-through.
 *
 * Who decides task control (continue / wait / ask owner / complete):
 * - `executionContinueKind` + `runExecutionStallContinueLoop` (progress stall,
 *   false-confirm, recoverable tools, silent-exec, empty-after-tools)
 * - real human gates in stall-continue (`HARD_DECISION_RE`, waiting_confirmation,
 *   missing choice) and OGUI / turn-completion elsewhere
 * - `settleTurnCompletion` (delivered / permanent_block / true_fork)
 *
 * Reply outlets (`rewriteAttemptVisibleReply`, `parseReplyDirectives` →
 * partial/block) must **express** text, not invent pause/confirm/authorization
 * from keywords. Shopping CTA used to be such an invention; it is retired here.
 * Streaming may show progress before a stop result exists; it must not fabricate
 * a pause reason.
 *
 * Short holding lines such as 「正在收尾排版，稍等片刻。」 are detected by
 * `isExecutionStallFinal` so the run can continue — not rewritten into a
 * shopping or generic confirm template.
 */

/** @deprecated Retired reply-layer template; kept for tests that assert absence. */
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

/**
 * @deprecated Reply layer no longer invents shopping pause CTAs. Always false.
 * Kept so older call sites compile; do not use to drive task control.
 */
export function shouldApplyShoppingPauseCta(_text: string, _contextText = ""): boolean {
  return false;
}

/**
 * @deprecated Prefer `isPlanSpeakFinal`. Historically meant "do not rewrite to
 * shopping CTA"; all plan-speak is now left as progress text at reply layer.
 */
export function shouldPreserveNonShoppingPlanSpeak(text: string, _contextText = ""): boolean {
  return isPlanSpeakFinal(text);
}

/**
 * Reply-layer pass-through. Never invents pause / confirm / shopping takeover
 * from plan-speak keywords. Task control stays with the executor continue loop,
 * real human gates, and turn-completion. `contextText` is accepted for call-site
 * compatibility only.
 */
export function rewritePlanSpeakFinal(text: string, _contextText = ""): string {
  return text;
}
