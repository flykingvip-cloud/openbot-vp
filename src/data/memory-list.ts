import fs from "node:fs/promises";
import path from "node:path";
import { resolveAgentWorkspaceDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";

export type AgentMemoryListEntry = {
  key: string;
  bytes: number;
  updatedAtMs: number;
};

/**
 * DS path1: manageable memory keys align with manager.search memory corpus
 * (workspace MEMORY.md / memory.md + memory/*.md (recursive)). Does not scan Data Space
 * memory/agent|workspace|personal roots and does not expand the search index.
 */
export function isIndexedWorkspaceMemoryKey(memoryKey: string): boolean {
  const key = memoryKey.trim().replace(/^\/+/, "").replace(/\\/g, "/");
  if (!key || key.includes("\0") || key.split("/").includes("..")) {
    return false;
  }
  const lower = key.toLowerCase();
  if (lower === "memory.md") {
    return true;
  }
  if (lower.startsWith("memory/") && lower.endsWith(".md") && !lower.endsWith("/")) {
    return true;
  }
  return false;
}

async function pushFileEntry(params: {
  workspaceRoot: string;
  absPath: string;
  entries: AgentMemoryListEntry[];
  seen: Set<string>;
}): Promise<void> {
  try {
    const stat = await fs.stat(params.absPath);
    if (!stat.isFile()) {
      return;
    }
    const resolved = await fs.realpath(params.absPath).catch(() => params.absPath);
    const relKey = path.relative(params.workspaceRoot, resolved).split(path.sep).join("/");
    if (!relKey || relKey.startsWith("..") || path.isAbsolute(relKey)) {
      return;
    }
    if (!isIndexedWorkspaceMemoryKey(relKey)) {
      return;
    }
    const dedupe = relKey.toLowerCase();
    if (params.seen.has(dedupe)) {
      return;
    }
    params.seen.add(dedupe);
    params.entries.push({
      key: relKey,
      bytes: stat.size,
      updatedAtMs: stat.mtimeMs,
    });
  } catch {
    // best-effort
  }
}

async function walkMemoryMarkdown(params: {
  workspaceRoot: string;
  dir: string;
  entries: AgentMemoryListEntry[];
  seen: Set<string>;
}): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(params.dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(params.dir, name);
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await walkMemoryMarkdown({
          workspaceRoot: params.workspaceRoot,
          dir: fullPath,
          entries: params.entries,
          seen: params.seen,
        });
        continue;
      }
      if (stat.isFile() && name.toLowerCase().endsWith(".md")) {
        await pushFileEntry({
          workspaceRoot: params.workspaceRoot,
          absPath: fullPath,
          entries: params.entries,
          seen: params.seen,
        });
      }
    } catch {
      // best-effort
    }
  }
}

/**
 * List user-manageable memory artifacts that participate in the indexed search
 * corpus (DS path1 converge). Relative keys are workspace-relative.
 */
export async function listAgentMemoryEntries(params: {
  cfg?: OpenBotConfig;
  agentId: string;
}): Promise<{ entries: AgentMemoryListEntry[] }> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return { entries: [] };
  }
  const cfg = params.cfg ?? ({} as OpenBotConfig);
  const workspaceDir = resolveAgentWorkspaceDir(cfg, agentId);
  const workspaceRoot = await fs.realpath(workspaceDir).catch(() => workspaceDir);
  const entries: AgentMemoryListEntry[] = [];
  const seen = new Set<string>();

  for (const name of ["MEMORY.md", "memory.md"] as const) {
    await pushFileEntry({
      workspaceRoot,
      absPath: path.join(workspaceRoot, name),
      entries,
      seen,
    });
  }
  await walkMemoryMarkdown({
    workspaceRoot,
    dir: path.join(workspaceRoot, "memory"),
    entries,
    seen,
  });

  return {
    entries: entries.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs),
  };
}
