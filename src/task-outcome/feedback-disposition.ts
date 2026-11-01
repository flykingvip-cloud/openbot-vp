/**
 * Decides whether one inbound sentence may change task state.
 * Free text never selects a TaskOutcome. Quotes, paraphrases, vague
 * negations, and added requirements do not change any task.
 */

export type InboundFeedbackDisposition =
  | { kind: "none" }
  | { kind: "ignore"; reason: "quoted" | "paraphrase" | "vague_negation" | "new_requirement" }
  | { kind: "clarify_unbound_task" }
  | { kind: "workspace_goal" };

const QUOTED = /[「“"][^」”"]{0,80}(?:不对|错了|重做)|(?:他说|她说|别人说|有人说|引用|原话)/u;
const PARAPHRASE = /转述|据说|据他|据她|意思是说/u;
const NEGATION = /不对|错了|搞错|不是我要的|重做|仍未解决|没用|不行/u;
const ARTIFACT = /这个结果|上次|刚才|交付|成果|原任务|那份/u;
const ADDITION = /再加|另外|还要|新增|同时要/u;
const GOAL_LEAD = /应该是|目标是|要让|请(?:让|改为|改成)|真正(?:的)?目标是/u;

export const UNBOUND_TASK_NEGATION_CLARIFY =
  "这句话像是在否定某次结果，但没有绑定到具体任务。不要猜测最近的任务，也不要修改任务状态。请让用户在对应结果上选择「结果不符合要求」。";

export function planInboundFeedbackDisposition(text: string): InboundFeedbackDisposition {
  const trimmed = text.trim();
  if (!trimmed) {
    return { kind: "none" };
  }
  if (QUOTED.test(trimmed)) {
    return { kind: "ignore", reason: "quoted" };
  }
  if (PARAPHRASE.test(trimmed) && NEGATION.test(trimmed)) {
    return { kind: "ignore", reason: "paraphrase" };
  }
  const artifactNegation = ARTIFACT.test(trimmed) && NEGATION.test(trimmed);
  if (ADDITION.test(trimmed) && !artifactNegation) {
    return { kind: "ignore", reason: "new_requirement" };
  }
  if (artifactNegation) {
    return { kind: "clarify_unbound_task" };
  }
  if (GOAL_LEAD.test(trimmed)) {
    return { kind: "workspace_goal" };
  }
  if (NEGATION.test(trimmed)) {
    return { kind: "ignore", reason: "vague_negation" };
  }
  return { kind: "none" };
}
