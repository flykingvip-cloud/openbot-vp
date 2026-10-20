import fs from "node:fs/promises";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveAgentDataSpaceDir } from "./memory-lifecycle.js";

export type AgentMemoryListEntry = {
  key: string;
  bytes: number;
  updatedAtMs: number;
};

const MEMORY_SCAN_ROOTS = ["memory/agent", "memory/workspace", "workspace"] as const;

async function walkMemoryFiles(params: {
  rootDir: string;
  prefix: string;
  entries: AgentMemoryListEntry[];
  seen: Set<string>;
}): Promise<void> {
  let names: string[];
  try {
    names = await fs.readdir(params.rootDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (name.startsWith(".")) {
      continue;
    }
    const fullPath = path.join(params.rootDir, name);
    const relKey = params.prefix ? `${params.prefix}/${name}` : name;
    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        await walkMemoryFiles({
          rootDir: fullPath,
          prefix: relKey,
          entries: params.entries,
          seen: params.seen,
        });
        continue;
      }
      if (!stat.isFile() || params.seen.has(relKey)) {
        continue;
      }
      params.seen.add(relKey);
      params.entries.push({
        key: relKey.replace(/\\/g, "/"),
        bytes: stat.size,
        updatedAtMs: stat.mtimeMs,
      });
    } catch {
      // best-effort scan
    }
  }
}

/** List user-manageable memory artifacts under an agent Data Space (relative keys only). */
export async function listAgentMemoryEntries(params: {
  cfg?: OpenBotConfig;
  agentId: string;
}): Promise<{ entries: AgentMemoryListEntry[] }> {
  const agentId = params.agentId.trim();
  if (!agentId) {
    return { entries: [] };
  }
  const dataRoot = resolveDataRoot(params.cfg);
  const agentRoot = resolveAgentDataSpaceDir(dataRoot, agentId);
  const entries: AgentMemoryListEntry[] = [];
  const seen = new Set<string>();

  for (const relativeRoot of MEMORY_SCAN_ROOTS) {
    await walkMemoryFiles({
      rootDir: path.join(agentRoot, ...relativeRoot.split("/")),
      prefix: "",
      entries,
      seen,
    });
  }

  return {
    entries: entries.toSorted((left, right) => right.updatedAtMs - left.updatedAtMs),
  };
}
