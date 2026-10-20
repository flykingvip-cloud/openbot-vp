import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";
import {
  resolveAgentConversationArchiveDir,
  resolveConversationArchiveIndexPath,
  type ConversationArchiveIndex,
} from "../data/conversation-archive.js";
import { readSessionMessages } from "../gateway/session-utils.js";

export type ConversationExportResult = {
  sessionId: string;
  agentId: string;
  format: "markdown";
  content: string;
  sources: Array<{ kind: "runtime" | "archive"; path: string; messageCount: number }>;
};

async function readArchiveIndex(indexPath: string): Promise<ConversationArchiveIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(raw) as ConversationArchiveIndex;
  } catch {
    return null;
  }
}

function messageRoleLabel(role: unknown): string {
  return typeof role === "string" && role.trim() ? role.trim() : "unknown";
}

function messageText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (!block || typeof block !== "object") {
          return "";
        }
        const record = block as Record<string, unknown>;
        if (typeof record.text === "string") {
          return record.text;
        }
        if (typeof record.content === "string") {
          return record.content;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function formatMessagesMarkdown(params: { title: string; messages: unknown[] }): string {
  const lines = [`## ${params.title}`, ""];
  for (const message of params.messages) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const role = messageRoleLabel(record.role);
    const text = messageText(record.content).trim();
    if (!text) {
      continue;
    }
    lines.push(`### ${role}`, "", text, "");
  }
  return lines.join("\n").trim();
}

/** Merge runtime transcript + archived copy for user export (TC-CL-08). */
export async function exportConversationTranscript(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  sessionId: string;
}): Promise<ConversationExportResult> {
  const agentId = params.agentId.trim();
  const sessionId = params.sessionId.trim();
  if (!agentId || !sessionId) {
    throw new Error("agentId and sessionId are required");
  }

  const cfg = params.cfg;
  const dataRoot = resolveDataRoot(cfg);
  const storePath = path.join(resolveStateDir(), "agents", agentId, "sessions");
  const runtimePath = resolveSessionFilePath(
    sessionId,
    undefined,
    resolveSessionFilePathOptions({ agentId, storePath }),
  );
  const runtimeMessages = readSessionMessages(sessionId, storePath, runtimePath);

  const archiveDir = resolveAgentConversationArchiveDir(dataRoot, agentId);
  const archivePath = path.join(archiveDir, `${sessionId}.jsonl`);
  let archiveMessages: unknown[] = [];
  try {
    archiveMessages = readSessionMessages(sessionId, undefined, archivePath);
  } catch {
    archiveMessages = [];
  }

  const index = await readArchiveIndex(resolveConversationArchiveIndexPath(dataRoot, agentId));
  const archivedAt =
    index?.sessions.find((entry) => entry.sessionId === sessionId)?.archivedAt ?? null;

  const sections = [
    `# Conversation export`,
    "",
    `- Agent: ${agentId}`,
    `- Session: ${sessionId}`,
    archivedAt ? `- Archived at: ${archivedAt}` : null,
    "",
    formatMessagesMarkdown({
      title: runtimeMessages.length > 0 ? "Runtime transcript" : "Runtime transcript (empty)",
      messages: runtimeMessages,
    }),
  ];
  if (archiveMessages.length > 0) {
    sections.push(
      "",
      formatMessagesMarkdown({ title: "Archived transcript", messages: archiveMessages }),
    );
  }

  const sources: ConversationExportResult["sources"] = [
    {
      kind: "runtime",
      path: "runtime",
      messageCount: runtimeMessages.length,
    },
  ];
  if (archiveMessages.length > 0) {
    sources.push({
      kind: "archive",
      path: "archive",
      messageCount: archiveMessages.length,
    });
  }

  return {
    sessionId,
    agentId,
    format: "markdown",
    content: sections.filter(Boolean).join("\n"),
    sources,
  };
}
