import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveStateDir } from "../config/paths.js";
import { resolveSessionFilePath, resolveSessionFilePathOptions } from "../config/sessions/paths.js";

export type ConversationArchiveIndexEntry = {
  sessionId: string;
  archivedAt: string;
  relativePath: string;
  bytes?: number;
};

export type ConversationArchiveIndex = {
  schemaVersion: 1;
  updatedAt: string;
  sessions: ConversationArchiveIndexEntry[];
};

export function resolveAgentConversationArchiveDir(dataRoot: string, agentId: string): string {
  return path.join(dataRoot, "agents", agentId, "conversations", "archive");
}

export function resolveConversationArchiveIndexPath(dataRoot: string, agentId: string): string {
  return path.join(dataRoot, "agents", agentId, "conversations", "index.json");
}

async function readArchiveIndex(indexPath: string): Promise<ConversationArchiveIndex> {
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ConversationArchiveIndex>;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sessions)) {
      return emptyArchiveIndex();
    }
    return {
      schemaVersion: 1,
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : new Date().toISOString(),
      sessions: parsed.sessions.filter(
        (entry): entry is ConversationArchiveIndexEntry =>
          Boolean(entry) &&
          typeof entry === "object" &&
          typeof entry.sessionId === "string" &&
          typeof entry.archivedAt === "string" &&
          typeof entry.relativePath === "string",
      ),
    };
  } catch {
    return emptyArchiveIndex();
  }
}

function emptyArchiveIndex(): ConversationArchiveIndex {
  const now = new Date().toISOString();
  return { schemaVersion: 1, updatedAt: now, sessions: [] };
}

async function writeArchiveIndex(
  indexPath: string,
  index: ConversationArchiveIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  const payload = `${JSON.stringify(index, null, 2)}\n`;
  await fs.writeFile(indexPath, payload, "utf-8");
}

export async function archiveConversationToDataSpace(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  sessionId: string;
  runtimePath?: string;
}): Promise<{ archivePath: string; skipped?: boolean }> {
  const cfg = params.cfg;
  const dataRoot = resolveDataRoot(cfg);
  const archiveDir = resolveAgentConversationArchiveDir(dataRoot, params.agentId);
  await fs.mkdir(archiveDir, { recursive: true });

  const archivePath = path.join(archiveDir, `${params.sessionId}.jsonl`);
  if (params.runtimePath) {
    try {
      await fs.access(params.runtimePath);
      await fs.copyFile(params.runtimePath, archivePath);
    } catch {
      try {
        await fs.access(archivePath);
        return { archivePath, skipped: true };
      } catch {
        throw new Error(`runtime transcript not found for session ${params.sessionId}`);
      }
    }
  } else {
    const storePath = path.join(resolveStateDir(), "agents", params.agentId, "sessions");
    const runtimePath = resolveSessionFilePath(
      params.sessionId,
      undefined,
      resolveSessionFilePathOptions({ agentId: params.agentId, storePath }),
    );
    try {
      await fs.access(runtimePath);
      await fs.copyFile(runtimePath, archivePath);
    } catch {
      try {
        await fs.access(archivePath);
        return { archivePath, skipped: true };
      } catch {
        throw new Error(`runtime transcript not found for session ${params.sessionId}`);
      }
    }
  }

  let bytes = 0;
  try {
    bytes = (await fs.stat(archivePath)).size;
  } catch {
    // best-effort
  }

  const indexPath = resolveConversationArchiveIndexPath(dataRoot, params.agentId);
  const index = await readArchiveIndex(indexPath);
  const relativePath = path.posix.join("archive", `${params.sessionId}.jsonl`);
  const now = new Date().toISOString();
  const existing = index.sessions.find((entry) => entry.sessionId === params.sessionId);
  if (existing) {
    existing.archivedAt = now;
    existing.relativePath = relativePath;
    existing.bytes = bytes;
  } else {
    index.sessions.push({
      sessionId: params.sessionId,
      archivedAt: now,
      relativePath,
      bytes,
    });
  }
  index.updatedAt = now;
  await writeArchiveIndex(indexPath, index);

  return { archivePath };
}

/** Best-effort archive when a session transcript is retired from runtime. */
export async function maybeArchiveConversationToDataSpace(params: {
  cfg?: OpenBotConfig;
  agentId?: string;
  sessionId?: string;
  runtimePath?: string;
}): Promise<string | null> {
  if (!params.agentId || !params.sessionId) {
    return null;
  }
  try {
    const result = await archiveConversationToDataSpace({
      cfg: params.cfg,
      agentId: params.agentId,
      sessionId: params.sessionId,
      runtimePath: params.runtimePath,
    });
    return result.archivePath;
  } catch {
    return null;
  }
}
