import { formatDockerCliMissingUserMessage } from "../../agents/sandbox/docker-engine-client.js";
import { isSilentReplyText, SILENT_REPLY_TOKEN } from "../../auto-reply/tokens.js";
import {
  asMessageList,
  extractMessageVisibleText,
} from "../../shared/text/visible-message-text.js";
import { stripInlineDirectiveTagsForDisplay } from "../../utils/directive-tags.js";
import { classifyPlaceholderReply } from "./completion-contract.js";
import { isNoReplyText } from "./quality-classifier.js";

export type CollaborationSkipReason =
  | "silent"
  | "empty"
  | "pure_ack"
  | "language"
  | "duplicate"
  | "crash"
  | "timeout";

const RECOVERY_TIMESTAMP_SLACK_MS = 1_000;

/** Assistant body for every collaboration bot. Non-text parts do not erase sibling text. */
export function extractAssistantVisibleText(message: unknown): string | undefined {
  return extractMessageVisibleText(message, { role: "assistant" });
}

export function messageTimestampMs(message: unknown): number | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const ts = (message as { timestamp?: unknown }).timestamp;
  if (typeof ts === "number" && Number.isFinite(ts)) {
    return ts;
  }
  if (typeof ts === "string") {
    const parsed = Date.parse(ts);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export function normalizeVisibleCollaborationReply(text: string): string | null {
  const stripped = stripInlineDirectiveTagsForDisplay(text).text.trim();
  if (!stripped) {
    return null;
  }
  if (isSilentReplyText(stripped, SILENT_REPLY_TOKEN) || isNoReplyText(stripped)) {
    return null;
  }
  if (classifyPlaceholderReply(stripped)) {
    return null;
  }
  return stripped;
}

export function recoverLatestVisibleAssistantText(params: {
  messages: unknown;
  sinceMs: number;
}): string | null {
  const messages = asMessageList(params.messages);
  const floor = params.sinceMs - RECOVERY_TIMESTAMP_SLACK_MS;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const timestamp = messageTimestampMs(message);
    if (timestamp == null || timestamp < floor) {
      continue;
    }
    const raw = extractAssistantVisibleText(message);
    if (!raw) {
      continue;
    }
    const visible = normalizeVisibleCollaborationReply(raw);
    if (visible) {
      return visible;
    }
  }
  return null;
}

/** When the visible reply is missing, a stored NO_REPLY is silence, not an empty body. */
export function collaborationSkipReasonForMissingReply(params: {
  combinedReplyRaw: string;
  messages: unknown;
  sinceMs: number;
}): "silent" | "empty" {
  if (
    isSilentReplyText(params.combinedReplyRaw, SILENT_REPLY_TOKEN) ||
    isNoReplyText(params.combinedReplyRaw)
  ) {
    return "silent";
  }
  const messages = asMessageList(params.messages);
  const floor = params.sinceMs - RECOVERY_TIMESTAMP_SLACK_MS;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const timestamp = messageTimestampMs(message);
    if (timestamp == null || timestamp < floor) {
      continue;
    }
    const raw = extractAssistantVisibleText(message);
    if (!raw?.trim()) {
      continue;
    }
    return isSilentReplyText(raw, SILENT_REPLY_TOKEN) || isNoReplyText(raw) ? "silent" : "empty";
  }
  return "empty";
}

const INFRA_PRE_REPLY_RE =
  /AccountWorkerFailedError|DOCKER_CLI_MISSING|OPENCLAW_INSTALL_DOCKER_CLI|docker command was not found|Sandbox mode requires Docker|云电脑没有启动|Embedded agent failed before reply|Agent failed before reply/i;

/**
 * A pre-reply sandbox failure is not an empty draft. Surface the operator
 * reason so the round abort is not skipReason=empty.
 */
export function collaborationInfraFailureDetail(params: {
  combinedReplyRaw: string;
  messages: unknown;
  sinceMs: number;
}): string | null {
  const chunks = [params.combinedReplyRaw];
  const floor = params.sinceMs - RECOVERY_TIMESTAMP_SLACK_MS;
  for (const message of asMessageList(params.messages)) {
    const timestamp = messageTimestampMs(message);
    if (timestamp == null || timestamp < floor) {
      continue;
    }
    const raw = extractAssistantVisibleText(message);
    if (raw?.trim()) {
      chunks.push(raw);
    }
  }
  const joined = chunks.join("\n");
  if (!INFRA_PRE_REPLY_RE.test(joined)) {
    return null;
  }
  if (
    /AccountWorkerFailedError|DOCKER_CLI_MISSING|docker command was not found|Sandbox mode requires Docker|OPENCLAW_INSTALL_DOCKER_CLI/i.test(
      joined,
    )
  ) {
    return formatDockerCliMissingUserMessage();
  }
  const direct = chunks
    .map((chunk) => chunk.trim())
    .find((chunk) => chunk.includes("云电脑没有启动"));
  if (direct) {
    return direct.slice(0, 400);
  }
  return "云电脑没有启动：账号沙箱未能创建容器。请确认网关镜像包含 docker 命令（OPENCLAW_INSTALL_DOCKER_CLI=1），或已挂载 docker.sock / podman.sock。";
}

export type CollaborationAbortIntent = "continue" | "nudge" | "deliver" | "divert" | "none";

/** Lightweight keyword heuristics — not a per-turn LLM. */
export function classifyCollaborationAbortIntent(userText?: string): CollaborationAbortIntent {
  const text = userText?.trim() ?? "";
  if (!text) {
    return "none";
  }
  if (/电脑|占用|divert/i.test(text)) {
    return "divert";
  }
  if (/交付|binding|成果|验收/i.test(text)) {
    return "deliver";
  }
  if (/催办|立刻续跑|催一下|马上办|CEO催|催进度/i.test(text)) {
    return "nudge";
  }
  if (/续写|请继续|接着写|下一章|继续写|接着做|往下写/i.test(text)) {
    return "continue";
  }
  return "none";
}

function collaborationAbortFactSentence(params: {
  who: string;
  skipReason?: CollaborationSkipReason;
  errorMessage?: string;
}): string {
  const detail = params.errorMessage?.trim();
  if (params.skipReason === "crash" || detail) {
    if (detail) {
      return `但这轮执行中断：${detail}。`;
    }
    return `但这轮${params.who}执行中断，没能交上正文。`;
  }
  if (params.skipReason === "silent") {
    return `但这轮只收到了静默回执，没有可见正文。`;
  }
  if (params.skipReason === "pure_ack") {
    return `但这轮只回了占位确认，没有展开正文。`;
  }
  if (params.skipReason === "language") {
    return `但这轮回复未通过语言检查，没有可用正文。`;
  }
  if (params.skipReason === "duplicate") {
    return `但这轮回复被判为重复，没有新的可见正文。`;
  }
  if (params.skipReason === "empty") {
    return `但这轮${params.who}没能交上正文。`;
  }
  if (params.skipReason === "timeout") {
    return `但主答超时，回合已中止，这轮没能交上正文。`;
  }
  return `但这轮没能交上正文。`;
}

function collaborationAbortUnderstanding(params: {
  who: string;
  intent: CollaborationAbortIntent;
  named: boolean;
}): string {
  const { who, intent, named } = params;
  switch (intent) {
    case "continue":
      return named ? `我理解你想让${who}续写或接着往下做，` : `我理解你想续写或接着往下做，`;
    case "nudge":
      return named ? `我理解你在催办${who}这轮协作，` : `我理解你在催办这轮协作，`;
    case "deliver":
      return named ? `我理解你在等${who}给出交付/成果，` : `我理解你在等交付或成果，`;
    case "divert":
      return `我理解你可能在担心电脑占用或想 divert 到其他人，`;
    case "none":
    default:
      return named ? `我理解你在等${who}给出可见回复，` : `我理解你在等这轮协作给出可见回复，`;
  }
}

function collaborationAbortActions(params: {
  who: string;
  intent: CollaborationAbortIntent;
  skipReason?: CollaborationSkipReason;
}): string {
  const { who, intent, skipReason } = params;
  if (intent === "continue") {
    return (
      `你可以：① 再发「请继续」并@${who}；② @其他成员接手续写；` +
      `③ 说明从哪一段/哪一章接着写。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (intent === "nudge") {
    return (
      `你可以：① 再次@相关成员催办；② 说明要催的交付物与截止点；` +
      `③ 若电脑占用，可 divert 到其他成员。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (intent === "deliver") {
    return (
      `你可以：① 说明要交付的 binding/成果物与验收标准；② @负责成员接手；` +
      `③ 补充约束后重发。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (intent === "divert") {
    return (
      `你可以：① divert 到其他空闲成员；② 稍后再试或缩短问题重发；` +
      `③ @具体成员接手。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (skipReason === "silent") {
    return (
      `你可以：① 换个更具体的问题重试；② @某位成员点名回答；` +
      `③ 补充目标/约束后重发。若你说明想续写、催办还是交付，我可以按那个场景给出更具体的下一步。`
    );
  }
  if (skipReason === "pure_ack") {
    return (
      `你可以：① 补充目标/约束后再发；② @主答继续展开；` +
      `③ 说明想续写、催办还是交付。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (skipReason === "language") {
    return (
      `你可以：① 用群约定语言重发；② @该成员改用正确语言；` +
      `③ 补充约束后重试。若你说明想续写、催办还是交付，我可以按那个场景给出更具体的下一步。`
    );
  }
  if (skipReason === "duplicate") {
    return (
      `你可以：① 补充新角度或证据后重发；② @其他成员接手；` +
      `③ 说明想续写、催办还是交付。若你说清目标，我可以帮你改写成一句可执行指令。`
    );
  }
  if (skipReason === "empty") {
    return (
      `你可以：① 缩短问题后重发；② @备用成员接手；` +
      `③ 补充目标/约束后再试。若你说明想续写、催办还是交付，我可以按那个场景给出更具体的下一步。`
    );
  }
  if (skipReason === "timeout") {
    return (
      `你可以：① 缩短问题后重试；② @备用成员接手；` +
      `③ 稍后再试。若你说明想续写、催办还是交付，我可以按那个场景给出更具体的下一步。`
    );
  }
  if (skipReason === "crash") {
    return (
      `你可以：① 稍后重试；② @其他成员接手；` +
      `③ 说明想续写、催办还是交付，我帮你改成可执行的下一步。`
    );
  }
  // Generic shell (no intent / unknown skip)
  return (
    `你可以：① 稍后再发或缩短问题重试；② @其他成员接手；` +
    `③ 补充目标/约束后重发。若你说明想续写、催办还是交付，我可以按那个场景给出更具体的下一步。`
  );
}

export function formatCollaborationRoundAbortNotice(params: {
  agentName?: string;
  skipReason?: CollaborationSkipReason;
  errorMessage?: string;
  userText?: string;
}): string {
  const who = params.agentName?.trim() || "数字人";
  const named = Boolean(params.agentName?.trim());
  const intent = classifyCollaborationAbortIntent(params.userText);
  const understanding = collaborationAbortUnderstanding({ who, intent, named });
  const fact = collaborationAbortFactSentence({
    who,
    skipReason: params.skipReason,
    errorMessage: params.errorMessage,
  });
  const actions = collaborationAbortActions({
    who,
    intent,
    skipReason: params.skipReason,
  });
  return `${understanding}${fact}${actions}`;
}

export function formatCollaborationDispatchFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("workspace_authorization_failed")) {
    return (
      "协作回合无法启动：工作区未授权。" +
      "你可以：① 确认工作区授权后再试；② @其他成员接手；③ 换到已授权会话重发。"
    );
  }
  if (message.includes("ERR_MODULE_NOT_FOUND") || message.includes("Cannot find module")) {
    return "数字人执行中断，请再试一次；若仍失败，可 @其他成员接手。";
  }
  if (/timeout|TIMEOUT|ETIMEDOUT/i.test(message)) {
    return (
      "协作回合超时中止，这轮没能交上正文。" +
      "你可以：① 缩短问题后重试；② @备用成员接手；③ 稍后再试。"
    );
  }
  if (/abort|AbortError|cancelled|canceled/i.test(message)) {
    return (
      "协作回合被中断，这轮没能交上正文。" +
      "你可以：① 重新发起；② @其他成员接手；③ 补充目标后重发。"
    );
  }
  return (
    "协作回合没能完成：发生了未归类的执行问题。" +
    "你可以：① 稍后重试；② @其他成员接手；③ 补充刚才的目标后重发。"
  );
}
