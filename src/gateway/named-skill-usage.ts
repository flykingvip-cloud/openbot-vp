/**
 * Named skills one robot has actually used.
 * Counts a skill only when a read tool opens that skill's own SKILL.md,
 * or a skill-invocation event names it. Directory listings and primitive
 * tools (browser, search, command) are not skills.
 */

import fs from "node:fs";
import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import type { OpenBotConfig } from "../config/config.js";
import { loadConfig } from "../config/config.js";
import { readSkillInvocationEvents } from "./skill-invocation/event-store.js";

const MAX_TRANSCRIPT_BYTES = 2_000_000;
const SKILL_FILE = /skills\/([A-Za-z0-9][A-Za-z0-9._-]{0,64})\/SKILL\.md/g;
const PRIMITIVE_TOOLS = new Set([
  "browser",
  "web_search",
  "web_fetch",
  "exec",
  "read",
  "write",
  "process",
  "memory_search",
  "memory_get",
  "conversation_send",
  "sessions_spawn",
  "message",
]);

export type NamedSkillUse = {
  name: string;
  count: number;
};

export function countExplicitSkillReads(jsonl: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const line of jsonl.split("\n")) {
    if (!line.includes("SKILL.md") || !line.includes("toolCall")) {
      continue;
    }
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch {
      continue;
    }
    const message = asRecord(asRecord(row)?.message);
    const content = message?.content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const entry of content) {
      const call = asRecord(entry);
      const type = asString(call?.type);
      if (type !== "toolCall" && type !== "tool_use") {
        continue;
      }
      const tool = asString(call?.name) || asString(call?.toolName);
      if (tool !== "read" && tool !== "Read") {
        continue;
      }
      const args = call?.arguments ?? call?.input;
      const text = typeof args === "string" ? args : JSON.stringify(args ?? {});
      if (text.length > 2000) {
        continue;
      }
      const names = [...text.matchAll(SKILL_FILE)].map((match) => match[1] ?? "");
      const unique = [...new Set(names.filter((name) => isNamedSkill(name)))];
      if (unique.length !== 1) {
        continue;
      }
      const name = unique[0] ?? "";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
  }
  return counts;
}

export function listNamedSkillUses(
  agentId: string,
  opts?: { cfg?: OpenBotConfig; sessionsDir?: string },
): NamedSkillUse[] {
  const id = agentId.trim();
  if (!id) {
    return [];
  }
  const counts = new Map<string, number>();
  const sessionsDir =
    opts?.sessionsDir ??
    path.join(path.dirname(resolveAgentDir(opts?.cfg ?? loadConfig(), id)), "sessions");
  addTranscriptReads(sessionsDir, counts);
  for (const event of readSkillInvocationEvents({ agentId: id })) {
    if (!isNamedSkill(event.skillId)) {
      continue;
    }
    counts.set(event.skillId, (counts.get(event.skillId) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

function addTranscriptReads(sessionsDir: string, counts: Map<string, number>): void {
  if (!fs.existsSync(sessionsDir)) {
    return;
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(sessionsDir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".jsonl")) {
      continue;
    }
    const filePath = path.join(sessionsDir, name);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > MAX_TRANSCRIPT_BYTES) {
        continue;
      }
      const text = fs.readFileSync(filePath, "utf8");
      for (const [skill, count] of countExplicitSkillReads(text)) {
        counts.set(skill, (counts.get(skill) ?? 0) + count);
      }
    } catch {
      // One unreadable transcript does not hide the others.
    }
  }
}

function isNamedSkill(name: string): boolean {
  const trimmed = name.trim();
  return Boolean(trimmed) && !PRIMITIVE_TOOLS.has(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
