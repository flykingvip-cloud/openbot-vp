import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import {
  resolveAgentConversationArchiveDir,
  resolveConversationArchiveIndexPath,
  type ConversationArchiveIndex,
} from "../data/conversation-archive.js";
import { resolveAgentDataSpaceDir } from "../data/memory-lifecycle.js";
import { resolveConversationRetentionPolicy, retentionDaysToMs } from "./retention-policy.js";

export type ConversationRetentionScanResult = {
  scannedAgents: number;
  deletedSessions: number;
  deletedBytes: number;
  dryRun: boolean;
  audit: Array<{
    agentId: string;
    sessionId: string;
    archivedAt: string;
    action: "delete" | "would_delete";
  }>;
};

async function readArchiveIndex(indexPath: string): Promise<ConversationArchiveIndex | null> {
  try {
    const raw = await fs.readFile(indexPath, "utf-8");
    return JSON.parse(raw) as ConversationArchiveIndex;
  } catch {
    return null;
  }
}

async function writeArchiveIndex(
  indexPath: string,
  index: ConversationArchiveIndex,
): Promise<void> {
  await fs.mkdir(path.dirname(indexPath), { recursive: true });
  await fs.writeFile(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf-8");
}

async function listAgentIds(dataRoot: string): Promise<string[]> {
  const agentsRoot = path.join(dataRoot, "agents");
  try {
    const names = await fs.readdir(agentsRoot);
    const ids: string[] = [];
    for (const name of names) {
      const stat = await fs.stat(path.join(agentsRoot, name)).catch(() => null);
      if (stat?.isDirectory()) {
        ids.push(name);
      }
    }
    return ids.toSorted();
  } catch {
    return [];
  }
}

/** Scan archived conversations and delete entries past tenant deleteAfterDays policy. */
export async function runConversationRetentionEnforcement(params: {
  cfg?: OpenBotConfig;
  tenantId?: string | null;
  agentId?: string;
  dryRun?: boolean;
  nowMs?: number;
}): Promise<ConversationRetentionScanResult> {
  const cfg = params.cfg;
  const policy = resolveConversationRetentionPolicy(cfg, params.tenantId);
  const cutoffMs = (params.nowMs ?? Date.now()) - retentionDaysToMs(policy.deleteAfterDays);
  const dataRoot = resolveDataRoot(cfg);
  const agentIds = params.agentId?.trim() ? [params.agentId.trim()] : await listAgentIds(dataRoot);

  const result: ConversationRetentionScanResult = {
    scannedAgents: agentIds.length,
    deletedSessions: 0,
    deletedBytes: 0,
    dryRun: params.dryRun === true,
    audit: [],
  };

  for (const agentId of agentIds) {
    const indexPath = resolveConversationArchiveIndexPath(dataRoot, agentId);
    const index = await readArchiveIndex(indexPath);
    if (!index || index.sessions.length === 0) {
      continue;
    }
    const archiveDir = resolveAgentConversationArchiveDir(dataRoot, agentId);
    const kept = [...index.sessions];
    index.sessions = [];

    for (const entry of kept) {
      const archivedAtMs = Date.parse(entry.archivedAt);
      const expired = Number.isFinite(archivedAtMs) && archivedAtMs < cutoffMs;
      if (!expired) {
        index.sessions.push(entry);
        continue;
      }

      const archivePath = path.join(archiveDir, `${entry.sessionId}.jsonl`);
      let bytes = entry.bytes ?? 0;
      if (!params.dryRun) {
        try {
          const stat = await fs.stat(archivePath);
          bytes = stat.size;
          await fs.unlink(archivePath);
        } catch {
          // best-effort delete
        }
      }

      result.deletedSessions += 1;
      result.deletedBytes += bytes;
      result.audit.push({
        agentId,
        sessionId: entry.sessionId,
        archivedAt: entry.archivedAt,
        action: params.dryRun ? "would_delete" : "delete",
      });
    }

    if (!params.dryRun) {
      index.updatedAt = new Date().toISOString();
      await writeArchiveIndex(indexPath, index);
    }
  }

  return result;
}

/** Summarize tenant retention rules for employee-facing copy (no internal paths). */
export function buildRetentionPolicySummary(cfg?: OpenBotConfig, tenantId?: string | null): string {
  const policy = resolveConversationRetentionPolicy(cfg, tenantId);
  return [
    `会话归档保留 ${policy.archiveDays} 天，`,
    `归档数据 ${policy.deleteAfterDays} 天后永久删除。`,
    `合规档位：${policy.complianceProfile}。`,
  ].join("");
}

/** Resolve on-disk agent data root (used by tests). */
export function resolveAgentDataRoot(dataRoot: string, agentId: string): string {
  return resolveAgentDataSpaceDir(dataRoot, agentId);
}
