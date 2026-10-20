/**
 * Dialogue P2 confirmation tiers — prompt contract only.
 *
 * Replaces the vague confirm_first sentence. High-takeover learning still
 * stores `decisionPreference: "confirm_first"`; the rendered text is these two
 * tiers, not "ask more often".
 *
 * Must-ask starts from `classifySideEffect` / `SIDE_EFFECT_CLASSES` (broadcast,
 * external write, outbound message) and adds delete plus credentials. This
 * module does not change the classifier, the growth gate, or any runtime latch.
 */
import { SIDE_EFFECT_CLASSES, type SideEffectClass } from "../conversation-task/types.js";

/** Internal steps after the task is already clear. Do them; do not ask. */
export const CONFIRMATION_INTERNAL_STEPS = [
  "检索",
  "起草",
  "改一节",
  "换格式",
  "再出一版",
  "继续写",
  "改标题",
  "出下一节",
] as const;

/**
 * Must-ask actions beyond the side-effect classes.
 * Delete and credentials are prompt-only additions (see the P2 risk note);
 * they are not new `SideEffectClass` values.
 */
export const CONFIRMATION_MUST_ASK_EXTRAS = [
  "对外发送",
  "删除",
  "发布",
  "改权限",
  "写凭证",
  "重置密钥",
  "不可逆覆盖",
] as const;

function isActionableSideEffect(kind: SideEffectClass): kind is Exclude<SideEffectClass, "none"> {
  return kind !== "none";
}

/** Chinese label for each non-none side-effect class. Exhaustive on the union. */
function sideEffectLabel(kind: Exclude<SideEffectClass, "none">): string {
  switch (kind) {
    case "outbound_message":
      return "出站消息";
    case "external_write":
      return "外部写入";
    case "broadcast":
      return "广播";
    default: {
      const unreachable: never = kind;
      return unreachable;
    }
  }
}

function sideEffectClause(): string {
  return SIDE_EFFECT_CLASSES.filter(isActionableSideEffect)
    .map((kind) => `${sideEffectLabel(kind)}（${kind}）`)
    .join("、");
}

/**
 * Two-tier confirmation text shared by working-style render and the steward preamble.
 * The internal-step sentence does not model a 「要不要我…」 question.
 */
export function renderConfirmationTierInstructions(): string {
  const internal = CONFIRMATION_INTERNAL_STEPS.join("、");
  const extras = CONFIRMATION_MUST_ASK_EXTRAS.join("、");
  return [
    `不必问：当前任务已经说清之后的内部步骤直接完成，包括${internal}。`,
    `必须问：${extras}，以及侧效分类 ${sideEffectClause()}，先向用户确认，得到同意后再执行。`,
  ].join("\n");
}

export function confirmationTierLines(): string[] {
  return renderConfirmationTierInstructions().split("\n");
}
