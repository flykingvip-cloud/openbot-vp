import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";

export type AgentMemoryDisposalMode = "delete_all" | "keep_artifacts_conversations" | "soft_unbind";

export function resolveAgentDataSpaceDir(dataRoot: string, agentId: string): string {
  return path.join(dataRoot, "agents", agentId);
}

function resolveMemoryCandidatePaths(
  dataRoot: string,
  agentId: string,
  memoryKey: string,
): string[] {
  const trimmed = memoryKey.trim().replace(/^\/+/, "");
  if (!trimmed) {
    return [];
  }
  const agentRoot = resolveAgentDataSpaceDir(dataRoot, agentId);
  return [
    path.join(agentRoot, "memory", "agent", trimmed),
    path.join(agentRoot, "memory", "workspace", trimmed),
    path.join(dataRoot, "memory", "personal", trimmed),
    path.join(agentRoot, trimmed),
  ];
}

/** Delete a single memory artifact under the Data Space (best-effort). */
export async function forgetMemoryEntry(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  memoryKey: string;
}): Promise<{ deletedPath: string | null }> {
  const dataRoot = resolveDataRoot(params.cfg);
  for (const candidate of resolveMemoryCandidatePaths(dataRoot, params.agentId, params.memoryKey)) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isFile()) {
        await fs.unlink(candidate);
        return { deletedPath: candidate };
      }
      if (stat.isDirectory()) {
        await fs.rm(candidate, { recursive: true, force: true });
        return { deletedPath: candidate };
      }
    } catch {
      // try next candidate
    }
  }
  return { deletedPath: null };
}

/** Remove agent-scoped memory paths according to disposal mode. */
export async function applyAgentMemoryDisposal(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  mode: AgentMemoryDisposalMode;
}): Promise<{ removedPaths: string[] }> {
  if (params.mode === "soft_unbind") {
    return { removedPaths: [] };
  }

  const dataRoot = resolveDataRoot(params.cfg);
  const agentRoot = resolveAgentDataSpaceDir(dataRoot, params.agentId);
  const removedPaths: string[] = [];

  const targets =
    params.mode === "keep_artifacts_conversations"
      ? [
          path.join(agentRoot, "memory", "agent"),
          path.join(agentRoot, "memory", "workspace"),
          path.join(agentRoot, "workspace"),
        ]
      : [agentRoot];

  for (const target of targets) {
    try {
      await fs.rm(target, { recursive: true, force: true });
      removedPaths.push(target);
    } catch {
      // best-effort
    }
  }

  return { removedPaths };
}
