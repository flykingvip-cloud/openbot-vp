/**
 * Read-only orchestration invoke.
 *
 * Calls existing memory search, web fetch/search, or the cron skill snapshot
 * reader. Browser, node command, spawn, exec, and outbound send stay out.
 * Does not write the Progress Ledger.
 *
 * Kept out of surface-binding.ts so that file stays execute:false / name-only.
 */

import type { SkillSnapshot } from "../agents/skills/types.js";
import { createMemorySearchTool } from "../agents/tools/memory-tool.js";
import { createWebFetchTool } from "../agents/tools/web-fetch.js";
import { createWebSearchTool } from "../agents/tools/web-search.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveCronSkillsSnapshot } from "../cron/isolated-agent/skills-snapshot.js";
import type { ExecutionSurface } from "./types.js";

const UNTRUSTED_TEXT_MAX = 2_000;

export type ReadonlyInvokeDeps = {
  createMemorySearchTool?: typeof createMemorySearchTool;
  createWebFetchTool?: typeof createWebFetchTool;
  createWebSearchTool?: typeof createWebSearchTool;
  resolveCronSkillsSnapshot?: typeof resolveCronSkillsSnapshot;
};

export type InvokeReadonlySurfaceInput = {
  surface: ExecutionSurface;
  query: string;
  skillId?: string;
  config?: OpenBotConfig;
  agentSessionKey?: string;
  workspaceDir?: string;
  agentId?: string;
  isFastTestEnv?: boolean;
  existingSkillsSnapshot?: SkillSnapshot;
  deps?: ReadonlyInvokeDeps;
};

export type InvokeReadonlySurfaceResult = {
  invokedTool: boolean;
  reason?: string;
  toolName?: string;
  /** Truncated adapter text. Not ProgressEvidence. */
  untrustedText?: string;
};

export function formatReadonlyUntrustedPrompt(text: string | undefined): string {
  const trimmed = text?.trim() ?? "";
  if (!trimmed) {
    return "";
  }
  return [
    "Untrusted read-only context. Not completion evidence. Do not record this text as progress-ledger evidence.",
    trimmed,
  ].join("\n");
}

function truncate(text: string): string {
  if (text.length <= UNTRUSTED_TEXT_MAX) {
    return text;
  }
  return text.slice(0, UNTRUSTED_TEXT_MAX);
}

function isHttpUrl(query: string): boolean {
  try {
    const url = new URL(query.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function untrustedTextFromToolResult(result: unknown): string {
  if (!result || typeof result !== "object") {
    return "";
  }
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const record = block as { type?: unknown; text?: unknown };
    if (record.type === "text" && typeof record.text === "string" && record.text.trim()) {
      parts.push(record.text);
    }
  }
  return truncate(parts.join("\n"));
}

function excerptAround(prompt: string, needle: string): string {
  const index = prompt.indexOf(needle);
  if (index < 0) {
    return "";
  }
  const start = Math.max(0, index - 200);
  return prompt.slice(start, start + 1_500);
}

function skillSnapshotText(snapshot: SkillSnapshot, skillId: string): string {
  const id = skillId.trim();
  const entry = snapshot.skills.find((skill) => skill.name === id) ?? null;
  const resolved = (snapshot.resolvedSkills ?? []).find((skill) => {
    const name = (skill as { name?: unknown }).name;
    return typeof name === "string" && name === id;
  });
  const resolvedRecord = resolved as { name?: unknown; description?: unknown } | undefined;
  const payload = {
    skillId: id,
    entry,
    resolved: resolvedRecord
      ? {
          name: typeof resolvedRecord.name === "string" ? resolvedRecord.name : id,
          ...(typeof resolvedRecord.description === "string" && resolvedRecord.description.trim()
            ? { description: resolvedRecord.description }
            : {}),
        }
      : null,
    promptExcerpt: entry ? excerptAround(snapshot.prompt, id) : "",
  };
  return truncate(JSON.stringify(payload));
}

/**
 * Execute one already-selected read-only surface.
 * Connector, browser, node, and outbound surfaces never call an adapter.
 */
export async function invokeReadonlySurface(
  input: InvokeReadonlySurfaceInput,
): Promise<InvokeReadonlySurfaceResult> {
  if (input.surface === "connector") {
    return { invokedTool: false, reason: "connector_readonly_unavailable" };
  }
  if (input.surface !== "memory" && input.surface !== "skill" && input.surface !== "web_read") {
    return { invokedTool: false, reason: "readonly_invoke_refused" };
  }

  try {
    if (input.surface === "memory") {
      const factory = input.deps?.createMemorySearchTool ?? createMemorySearchTool;
      const tool = factory({
        config: input.config,
        agentSessionKey: input.agentSessionKey,
      });
      if (!tool) {
        return { invokedTool: false, reason: "memory_search_unavailable" };
      }
      const query = input.query.trim();
      if (!query) {
        return { invokedTool: false, reason: "memory_search_unavailable" };
      }
      const result = await tool.execute("orch-readonly-memory", { query });
      return {
        invokedTool: true,
        toolName: "memory_search",
        untrustedText: untrustedTextFromToolResult(result),
      };
    }

    if (input.surface === "web_read") {
      const query = input.query.trim();
      if (isHttpUrl(query)) {
        const factory = input.deps?.createWebFetchTool ?? createWebFetchTool;
        const tool = factory({ config: input.config });
        if (!tool) {
          return { invokedTool: false, reason: "web_read_unavailable" };
        }
        const result = await tool.execute("orch-readonly-web-fetch", { url: query });
        return {
          invokedTool: true,
          toolName: "web_fetch",
          untrustedText: untrustedTextFromToolResult(result),
        };
      }
      const factory = input.deps?.createWebSearchTool ?? createWebSearchTool;
      const tool = factory({ config: input.config });
      if (!tool) {
        return { invokedTool: false, reason: "web_read_unavailable" };
      }
      if (!query) {
        return { invokedTool: false, reason: "web_read_unavailable" };
      }
      const result = await tool.execute("orch-readonly-web-search", { query });
      return {
        invokedTool: true,
        toolName: "web_search",
        untrustedText: untrustedTextFromToolResult(result),
      };
    }

    const resolveSnapshot = input.deps?.resolveCronSkillsSnapshot ?? resolveCronSkillsSnapshot;
    const snapshot = resolveSnapshot({
      workspaceDir: input.workspaceDir ?? "",
      config: input.config ?? ({} as OpenBotConfig),
      agentId: input.agentId ?? "",
      existingSnapshot: input.existingSkillsSnapshot,
      isFastTestEnv: input.isFastTestEnv ?? false,
    });
    const skillId = input.skillId?.trim() ?? "";
    return {
      invokedTool: true,
      toolName: "skill_snapshot",
      untrustedText: skillSnapshotText(snapshot, skillId),
    };
  } catch {
    if (input.surface === "memory") {
      return { invokedTool: false, reason: "memory_search_unavailable" };
    }
    if (input.surface === "web_read") {
      return { invokedTool: false, reason: "web_read_unavailable" };
    }
    return { invokedTool: false, reason: "skill_snapshot_unavailable" };
  }
}
