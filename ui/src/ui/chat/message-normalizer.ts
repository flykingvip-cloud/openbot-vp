/**
 * Message normalization utilities for chat rendering.
 */

import { stripInboundMetadata } from "../../../../src/auto-reply/reply/strip-inbound-meta.js";
import type { NormalizedMessage, MessageContentItem } from "../types/chat-types.ts";
import { stripClientAttachmentManifest } from "./message-extract.ts";
import { readPeerSentTargets } from "./peer-exchange.ts";

const ROBOT_HANDOFF_LINE =
  /^(?:\[(?:任务接收|任务发出|任务返回|诊断交接|数字人回复)\]|角色：|主会话：|对象会话：|客：|闭环：|已把任务 1:1 交给|未发出 1:1 任务|来自\s+\S+（1:1 会话)/u;

/** Drop robot-to-robot routing notes. The visible line is the words that were sent. */
export function stripRobotHandoffBanner(text: string): string {
  if (!ROBOT_HANDOFF_LINE.test(text) && !text.includes("\n")) {
    const line = text.trim();
    if (!ROBOT_HANDOFF_LINE.test(line)) {
      return text;
    }
  }
  const kept = text.split("\n").filter((line) => !ROBOT_HANDOFF_LINE.test(line.trim()));
  const next = kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return next || text.trim();
}

function messageText(content: MessageContentItem[]): string {
  return content
    .map((item) => (item.type === "text" && typeof item.text === "string" ? item.text : ""))
    .filter(Boolean)
    .join("\n");
}

function provenanceSender(message: Record<string, unknown>): {
  interSession: boolean;
  senderLabel: string;
} {
  const provenance = message.provenance;
  if (!provenance || typeof provenance !== "object") {
    return { interSession: false, senderLabel: "" };
  }
  const record = provenance as Record<string, unknown>;
  const sender =
    typeof record.sourceSenderLabel === "string" ? record.sourceSenderLabel.trim() : "";
  return { interSession: record.kind === "inter_session", senderLabel: sender };
}

function legacyStewardSpeaker(text: string): string {
  return /主会话：agent:main:employee:/u.test(text) ? "大白管家" : "";
}

/**
 * Normalize a raw message object into a consistent structure.
 */
export function normalizeMessage(message: unknown): NormalizedMessage {
  const m = message as Record<string, unknown>;
  let role = typeof m.role === "string" ? m.role : "unknown";

  // Detect tool messages by common gateway shapes.
  // Some tool events come through as assistant role with tool_* items in the content array.
  const hasToolId = typeof m.toolCallId === "string" || typeof m.tool_call_id === "string";

  const contentRaw = m.content;
  const contentItems = Array.isArray(contentRaw) ? contentRaw : null;
  const hasToolContent =
    Array.isArray(contentItems) &&
    contentItems.some((item) => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const x = item as Record<string, unknown>;
      const t = (typeof x.type === "string" ? x.type : "").toLowerCase();
      return t === "toolresult" || t === "tool_result";
    });

  const hasToolName = typeof m.toolName === "string" || typeof m.tool_name === "string";

  if (hasToolId || hasToolContent || hasToolName) {
    role = "toolResult";
  }

  // Extract content
  let content: MessageContentItem[] = [];

  if (typeof m.content === "string") {
    content = [{ type: "text", text: m.content }];
  } else if (Array.isArray(m.content)) {
    content = m.content.flatMap((item: unknown) => {
      if (!item || typeof item !== "object") {
        return [];
      }
      const record = item as Record<string, unknown>;
      return [
        {
          type: (record.type as MessageContentItem["type"]) || "text",
          text: record.text as string | undefined,
          name: record.name as string | undefined,
          fileName: (record.fileName ?? record.file_name) as string | undefined,
          mimeType: (record.mimeType ?? record.mime_type) as string | undefined,
          status: record.status as MessageContentItem["status"] | undefined,
          args: record.args || record.arguments,
        },
      ];
    });
  } else if (typeof m.text === "string") {
    content = [{ type: "text", text: m.text }];
  }

  const timestamp = typeof m.timestamp === "number" ? m.timestamp : Date.now();
  const id = typeof m.id === "string" ? m.id : undefined;
  let senderLabel =
    typeof m.senderLabel === "string" && m.senderLabel.trim() ? m.senderLabel.trim() : null;
  const agentId = typeof m.agentId === "string" && m.agentId.trim() ? m.agentId.trim() : null;

  // Strip AI-injected metadata prefix blocks from user messages before display.
  if (role === "user" || role === "User" || role === "peer") {
    content = content.map((item) => {
      if (item.type === "text" && typeof item.text === "string") {
        return { ...item, text: stripClientAttachmentManifest(stripInboundMetadata(item.text)) };
      }
      return item;
    });
  }

  const sentTo = role === "toolResult" ? [] : readPeerSentTargets(m);
  const speaker = provenanceSender(m);
  const visibleText = messageText(content);
  const handoff = stripRobotHandoffBanner(visibleText);
  const replaceHandoff = () => {
    if (handoff !== visibleText.trim()) {
      content = [{ type: "text", text: handoff }];
    }
  };
  if (sentTo.length > 0) {
    replaceHandoff();
    return { role: "peer-out", content, timestamp, id, senderLabel, agentId, sentTo };
  }
  const fromAnotherRobot =
    speaker.interSession || (role === "user" && handoff !== visibleText.trim());
  if (fromAnotherRobot && (role === "user" || role === "User")) {
    role = "peer";
    senderLabel =
      senderLabel || speaker.senderLabel || legacyStewardSpeaker(visibleText) || "数字人";
    replaceHandoff();
  }

  return { role, content, timestamp, id, senderLabel, agentId };
}

/**
 * Normalize role for grouping purposes.
 */
export function normalizeRoleForGrouping(role: string): string {
  const lower = role.toLowerCase();
  // Preserve original casing when it's already a core role.
  if (role === "user" || role === "User") {
    return role;
  }
  if (role === "assistant") {
    return "assistant";
  }
  if (role === "peer") {
    return "peer";
  }
  if (role === "peer-out") {
    return "peer-out";
  }
  if (role === "system") {
    return "system";
  }
  // Keep tool-related roles distinct so the UI can style/toggle them.
  if (
    lower === "toolresult" ||
    lower === "tool_result" ||
    lower === "tool" ||
    lower === "function"
  ) {
    return "tool";
  }
  return role;
}

/**
 * Check if a message is a tool result message based on its role.
 */
export function isToolResultMessage(message: unknown): boolean {
  const m = message as Record<string, unknown>;
  const role = typeof m.role === "string" ? m.role.toLowerCase() : "";
  return role === "toolresult" || role === "tool_result";
}
