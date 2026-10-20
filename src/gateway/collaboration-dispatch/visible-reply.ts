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

export function formatCollaborationRoundAbortNotice(params: {
  agentName?: string;
  skipReason?: CollaborationSkipReason;
  errorMessage?: string;
}): string {
  const who = params.agentName?.trim() || "数字人";
  if (params.skipReason === "crash" || params.errorMessage) {
    const detail = params.errorMessage?.trim();
    return detail
      ? `本轮没有形成可见回复：${detail}。可稍后重试，或 @其他成员接手。`
      : `本轮没有形成可见回复：${who}执行中断。可稍后重试，或 @其他成员接手。`;
  }
  if (params.skipReason === "silent") {
    return `本轮没有形成可见回复：${who}返回了静默回执。请换个更具体的问题，或 @某位成员点名回答。`;
  }
  if (params.skipReason === "pure_ack") {
    return `本轮没有形成可见回复：${who}只回了占位确认。请补充目标/约束后再发，或 @主答继续展开。`;
  }
  if (params.skipReason === "language") {
    return `本轮没有形成可见回复：${who}的回复未通过语言检查。请用群约定语言重发，或 @该成员改用正确语言。`;
  }
  if (params.skipReason === "duplicate") {
    return `本轮没有形成可见回复：${who}的回复被判为重复。请补充新角度或证据，避免重复上一轮。`;
  }
  if (params.skipReason === "empty") {
    return `本轮没有形成可见回复：${who}未产出正文。请缩短问题后重发，或 @备用成员接手。`;
  }
  if (params.skipReason === "timeout") {
    return `本轮没有形成可见回复：主答超时，回合已中止。请缩短问题、@备用成员，或稍后再试。`;
  }
  return `本轮没有形成可见回复：主答未完成可见交稿，回合已中止。请补充约束后重发，或 @具体成员点名。`;
}

export function formatCollaborationDispatchFailure(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("workspace_authorization_failed")) {
    return "协作回合无法启动：工作区未授权";
  }
  if (message.includes("ERR_MODULE_NOT_FOUND") || message.includes("Cannot find module")) {
    return "数字人执行中断，请再试一次";
  }
  return "协作回合执行失败";
}
