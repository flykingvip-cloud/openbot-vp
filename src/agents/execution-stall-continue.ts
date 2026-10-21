/**
 * Hidden continuations when an authorized run stops before the work is done.
 *
 * The embedded prompt loop returns as soon as the assistant stops without a
 * tool call. A wait line, a repeated 「请确认」 after the user already said go,
 * or an empty final after successful tools is a successful stop today, so
 * typeset/publish never finishes. Each case continues a small bounded number
 * of times. A real question, permission, payment, scan, or authorization
 * pause stays terminal. There is no open-ended loop.
 */
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import { isExecutionStallFinal } from "../shared/text/plan-speak-final.js";
import { isSilentExecFishingStop } from "./turn-completion/contract.js";

export const EXECUTION_STALL_CONTINUE_LIMIT = 2;
export const FALSE_CONFIRM_CONTINUE_LIMIT = 1;
export const EMPTY_AFTER_TOOLS_CONTINUE_LIMIT = 1;
export const SILENT_EXEC_CONTINUE_LIMIT = 1;

export const EXECUTION_STALL_CONTINUE_PROMPT =
  "Internal execution continue: the previous assistant message only told the user to wait or that work is still in progress. That is not a finished turn. Continue the work the user already authorized. Call the tools and deliver the result in this turn. Stop and ask only if you need a permission you do not have, a payment or QR scan, or a fact only the user knows. Do not send another wait sentence.";

export const FALSE_CONFIRM_CONTINUE_PROMPT =
  "Internal execution continue: the user already authorized this act (start, typeset, publish, or continue). The previous assistant message asked them to confirm again without a missing price, spec, payment, scan, or authorization. That confirm is not a finished turn. Continue the authorized work. Call the tools and deliver the result. Stop only for a real permission you do not have, a payment or QR scan, or a fact only the user knows.";

export const EMPTY_AFTER_TOOLS_CONTINUE_PROMPT =
  "Internal execution continue: tools in this turn succeeded, but the visible reply is empty and there is no deliverable or draft-box result yet. The task is not finished. Continue from the tool results and deliver the result in this turn. Do not ask the user to restate the goal.";

export const SILENT_EXEC_CONTINUE_PROMPT =
  "Internal execution continue: the user said to continue and wants the result. Do not ask open parameters. Do not ask whether 绑定 means WeChat, email, or a knowledge source; in a skill smoke, 绑定 means analysis-review to task.json sha256. A task_ledger or non-deliverable permission failure is a side path: skip it, add one bypass line, and write an openable deliverable or a text degradation in this turn. Stop only for a true fork of two mutually exclusive choices, or one permanent mainline block with a reason, the degradation already tried, and one user action.";

const INTERNAL_CONTINUE_PREFIX = "Internal execution continue:";

/**
 * Soft 「请确认」 with no missing decision. Price, spec, payment, scan, and
 * authorization stay in the hard set so a real pause is not continued.
 */
const SOFT_CONFIRM_RE = /请(?:你)?确认/u;
const HARD_DECISION_RE =
  /(?:扫码|二维码|支付|付款|收银台|价格|规格|尺码|哪一单|选哪个|授权|登录|验证码|绑定|权限|封面|标题|[¥￥])/u;
const MISSING_CHOICE_RE = /(?:哪个|哪一|选哪)/u;
const AUTHORIZED_GO_RE = /(?:开始|继续|接着|发布|\bGO\b|排版|草稿箱|调研|撰写|写完|写出来)/iu;

const DELIVERABLE_OR_DRAFT_RE =
  /<<DELIVERABLE|mediaId\s*[=:]|草稿已写入|已写入草稿|已推(?:送|到|进)草稿|executed\s*[=:]\s*true|"executed"\s*:\s*true/iu;

type StopMessage = {
  role?: string;
  stopReason?: string;
  content?: unknown;
};

export type AssistantStopKind = "text" | "empty" | "tool" | "error" | "none";

export type ExecutionContinueKind = "progress-stall" | "false-confirm" | "silent-exec";

type AssistantStop =
  | { kind: "text"; text: string }
  | { kind: "empty" }
  | { kind: "tool" }
  | { kind: "error" }
  | { kind: "none" };

function asStopMessage(value: unknown): StopMessage | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  return value as StopMessage;
}

function visibleText(message: StopMessage): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const entry = block as { type?: unknown; text?: unknown };
      return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function hasToolCall(message: StopMessage): boolean {
  if (!Array.isArray(message.content)) {
    return false;
  }
  return message.content.some((block) => {
    if (!block || typeof block !== "object") {
      return false;
    }
    const type = (block as { type?: unknown }).type;
    return type === "toolCall" || type === "toolUse" || type === "functionCall";
  });
}

function lastAssistantStop(messages: readonly unknown[]): AssistantStop {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asStopMessage(messages[index]);
    if (!message || message.role !== "assistant") {
      continue;
    }
    if (message.stopReason === "toolUse" || hasToolCall(message)) {
      return { kind: "tool" };
    }
    if (message.stopReason === "error" || message.stopReason === "aborted") {
      return { kind: "error" };
    }
    const text = visibleText(message).trim();
    if (!text || isSilentReplyText(text, SILENT_REPLY_TOKEN)) {
      return { kind: "empty" };
    }
    return { kind: "text", text };
  }
  return { kind: "none" };
}

/**
 * Text of the latest assistant stop, or empty when that message is a tool
 * call, an error, an abort, or a silent/empty final. Earlier turns are
 * ignored so a previous real answer cannot schedule a continuation.
 */
export function lastAssistantStopText(messages: readonly unknown[]): string {
  const stop = lastAssistantStop(messages);
  return stop.kind === "text" ? stop.text : "";
}

export function lastAssistantStopKind(messages: readonly unknown[]): AssistantStopKind {
  return lastAssistantStop(messages).kind;
}

/** Latest real user turn. Hidden continuation prompts are not a new GO. */
export function latestUserText(messages: readonly unknown[] | null | undefined): string {
  if (!messages) {
    return "";
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = asStopMessage(messages[index]);
    if (!message || message.role !== "user") {
      continue;
    }
    const text = visibleText(message).trim();
    if (!text || text.startsWith(INTERNAL_CONTINUE_PREFIX)) {
      continue;
    }
    return text;
  }
  return "";
}

type ActDomain = "typeset" | "research" | "shopping" | "generic";

function actDomain(text: string): ActDomain {
  if (/(?:价格|规格|尺码|支付|付款|购物车|下单|比价|收银台)/u.test(text)) {
    return "shopping";
  }
  if (/(?:排版|草稿箱|公众号|typeset|wechat|weixin|official account)/iu.test(text)) {
    return "typeset";
  }
  if (/(?:调研|撰写|研究报告|写完|写出来)/u.test(text)) {
    return "research";
  }
  return "generic";
}

function sameAuthorizedAct(userText: string, assistantText: string): boolean {
  const userDomain = actDomain(userText);
  const assistantDomain = actDomain(assistantText);
  if (userDomain === "shopping" || assistantDomain === "shopping") {
    return false;
  }
  if (userDomain === "generic") {
    return AUTHORIZED_GO_RE.test(userText);
  }
  return assistantDomain === "generic" || assistantDomain === userDomain;
}

/**
 * True when the assistant asked 「请确认」 for an act the latest user message
 * already authorized, and the sentence does not name a missing decision.
 */
export function isSoftConfirmAfterAuthorizedGo(
  assistantText: string,
  latestUserText: string,
): boolean {
  const assistant = assistantText.trim();
  const user = latestUserText.trim();
  if (!assistant || !user || !SOFT_CONFIRM_RE.test(assistant)) {
    return false;
  }
  if (HARD_DECISION_RE.test(assistant) || MISSING_CHOICE_RE.test(assistant)) {
    return false;
  }
  if (!sameAuthorizedAct(user, assistant)) {
    return false;
  }
  return true;
}

export function executionContinueKind(params: {
  text: string;
  toolsDisabled: boolean;
  continuesUsed?: number;
  latestUserText?: string;
  falseConfirmContinuesUsed?: number;
  silentExecContinuesUsed?: number;
}): ExecutionContinueKind | null {
  if (params.toolsDisabled) {
    return null;
  }
  const silentUsed = params.silentExecContinuesUsed ?? 0;
  if (
    silentUsed < SILENT_EXEC_CONTINUE_LIMIT &&
    isSilentExecFishingStop(params.text, params.latestUserText ?? "")
  ) {
    return "silent-exec";
  }
  const stallUsed = params.continuesUsed ?? 0;
  if (stallUsed < EXECUTION_STALL_CONTINUE_LIMIT && isExecutionStallFinal(params.text)) {
    return "progress-stall";
  }
  const confirmUsed = params.falseConfirmContinuesUsed ?? 0;
  if (
    confirmUsed < FALSE_CONFIRM_CONTINUE_LIMIT &&
    isSoftConfirmAfterAuthorizedGo(params.text, params.latestUserText ?? "")
  ) {
    return "false-confirm";
  }
  return null;
}

export function shouldContinueAfterExecutionStall(params: {
  text: string;
  toolsDisabled: boolean;
  continuesUsed?: number;
  latestUserText?: string;
  falseConfirmContinuesUsed?: number;
  silentExecContinuesUsed?: number;
}): boolean {
  return executionContinueKind(params) !== null;
}

export type EmptyToolFinalTool = {
  toolName?: string;
  meta?: string;
  success?: boolean;
};

/**
 * One hidden continue when tools succeeded and the stop is empty, with no
 * deliverable and no draft-box result. A turn that never called a tool stays
 * on the honest-empty reply.
 */
export function shouldContinueAfterEmptyToolFinal(params: {
  stopKind: AssistantStopKind;
  toolsDisabled: boolean;
  continuesUsed?: number;
  tools: readonly EmptyToolFinalTool[];
  visibleTexts?: readonly string[];
}): boolean {
  if (params.toolsDisabled) {
    return false;
  }
  if ((params.continuesUsed ?? 0) >= EMPTY_AFTER_TOOLS_CONTINUE_LIMIT) {
    return false;
  }
  if (params.stopKind !== "empty") {
    return false;
  }
  const succeeded = params.tools.filter((tool) => tool.success === true);
  if (succeeded.length === 0) {
    return false;
  }
  const blob = [
    ...(params.visibleTexts ?? []),
    ...succeeded.map((tool) => `${tool.toolName ?? ""}\n${tool.meta ?? ""}`),
  ].join("\n");
  if (DELIVERABLE_OR_DRAFT_RE.test(blob)) {
    return false;
  }
  return true;
}

/** Drop the premature wait line from channel payloads after work actually continued. */
export function dropContinuedStallText(texts: string[], stall: string): void {
  const target = stall.trim();
  if (!target) {
    return;
  }
  for (let index = texts.length - 1; index >= 0; index -= 1) {
    if (texts[index]?.trim() === target) {
      texts.splice(index, 1);
    }
  }
}

/**
 * Remove wait lines the run already continued past. If the final text is
 * still one of those lines, that latest line stays visible.
 */
export function dropSupersededStallTexts(
  texts: string[],
  stalls: readonly string[],
  finalText: string,
): void {
  const final = finalText.trim();
  const finalIsStall = stalls.some((stall) => stall.trim() === final);
  for (const stall of stalls) {
    const trimmed = stall.trim();
    if (!trimmed || (finalIsStall && trimmed === final)) {
      continue;
    }
    dropContinuedStallText(texts, trimmed);
  }
}
