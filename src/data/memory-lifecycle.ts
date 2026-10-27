import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { isIndexedWorkspaceMemoryKey } from "./memory-list.js";

export type AgentMemoryDisposalMode = "delete_all" | "keep_artifacts_conversations" | "soft_unbind";

export function resolveAgentDataSpaceDir(dataRoot: string, agentId: string): string {
  return path.join(dataRoot, "agents", agentId);
}

/**
 * Delete a single memory artifact from the indexed workspace corpus (DS path1).
 * Only MEMORY.md / memory.md / memory/*.md (recursive) under the agent workspace.
 */
export async function forgetMemoryEntry(params: {
  cfg?: OpenBotConfig;
  agentId: string;
  memoryKey: string;
}): Promise<{ deletedPath: string | null }> {
  const agentId = params.agentId.trim();
  const key = params.memoryKey.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!agentId || !isIndexedWorkspaceMemoryKey(key)) {
    return { deletedPath: null };
  }
  const cfg = params.cfg ?? ({} as OpenBotConfig);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const workspaceRoot = await fs.realpath(workspaceDir).catch(() => path.resolve(workspaceDir));
  const candidate = path.resolve(workspaceRoot, key);
  const rel = path.relative(workspaceRoot, candidate).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    return { deletedPath: null };
  }
  if (!isIndexedWorkspaceMemoryKey(rel)) {
    return { deletedPath: null };
  }
  try {
    const stat = await fs.stat(candidate);
    if (stat.isFile()) {
      await fs.unlink(candidate);
      return { deletedPath: candidate };
    }
  } catch {
    return { deletedPath: null };
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
