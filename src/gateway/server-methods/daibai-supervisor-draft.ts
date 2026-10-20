/**
 * Daibai → Development Supervisor task draft builder (chat bridge).
 */

import fs from "node:fs";
import path from "node:path";
import { loadConfig } from "../../config/config.js";
import { resolveUserPath } from "../../utils.js";

export type SupervisorTaskDraft = {
  goal: string;
  repoRoot: string;
  workerBackendId: string;
  templateId?: string;
  impactedPaths?: string[];
};

const DEVELOPMENT_SUPERVISOR_KEYWORDS = [
  "开发监督",
  "监督任务",
  "codex",
  "cursor",
  "devin",
  "重构",
  "refactor",
  "改代码",
  "改 ui",
  "ui 优化",
  "ui重构",
  "界面",
  "布局",
  "现代化",
  "开发任务",
  "supervisor",
  "worker",
  "employee-supervisor",
  "supervisor-task",
  "supervisor-center",
];

const EXPLICIT_IDE_TOOL_NEEDLES = [
  "cursor-agent",
  "cursor agent",
  "claude code",
  "claude-code",
  "codex",
  "cursor",
  "devin",
  "kiro",
  "windsurf",
] as const;

const EXPLICIT_IDE_LAUNCH_PATTERNS = [
  /(?:启动|打开|用)\s*(?:codex|cursor(?:-agent)?|devin|kiro|windsurf|claude\s*code)/i,
  /(?:codex|cursor(?:-agent)?|devin|kiro|windsurf|claude\s*code)\s*(?:跑|执行|运行)/i,
  /用\s*(?:codex|cursor(?:-agent)?|devin|kiro|windsurf|claude\s*code)/i,
];

const PATH_HINT_PATTERNS = [
  /(?:ui\/src\/[\w./-]+\.(?:ts|tsx|css))/gi,
  /(?:src\/[\w./-]+\.(?:ts|tsx))/gi,
];

/** Broad dev/supervisor lexicon — kept for diagnostics; not used to drive Mode B chips. */
export function isDevelopmentSupervisorIntent(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return DEVELOPMENT_SUPERVISOR_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

/**
 * Mode B gate: only explicit external IDE requests (or launch phrases) spawn supervisor chips.
 * Generic "改 UI / 布局" without naming an IDE stays in Mode A (大白自执行).
 */
export function isExplicitIdeRequest(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (EXPLICIT_IDE_TOOL_NEEDLES.some((needle) => normalized.includes(needle))) {
    return true;
  }
  return EXPLICIT_IDE_LAUNCH_PATTERNS.some((pattern) => pattern.test(message));
}

function resolveWorkerBackendIdFromMessage(message: string): string {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("cursor")) {
    return "cursor-agent";
  }
  if (normalized.includes("devin")) {
    return "devin";
  }
  if (normalized.includes("kiro")) {
    return "kiro";
  }
  if (normalized.includes("windsurf")) {
    return "windsurf";
  }
  return "codex-cli";
}

function extractImpactedPaths(message: string): string[] {
  const paths = new Set<string>();
  for (const pattern of PATH_HINT_PATTERNS) {
    for (const match of message.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) {
        paths.add(value);
      }
    }
  }
  return [...paths];
}

function normalizeGoal(message: string): string {
  const trimmed = message.trim();
  if (trimmed.length <= 500) {
    return trimmed;
  }
  return `${trimmed.slice(0, 497)}…`;
}

function isGitWorkingTree(dir: string): boolean {
  try {
    const git = fs.statSync(path.join(dir, ".git"));
    return git.isDirectory() || git.isFile();
  } catch {
    return false;
  }
}

/** Gateway-side default repo root for supervisor drafts. Must be a git working tree. */
export function resolveSupervisorDefaultRepoRoot(): string {
  const cfg = loadConfig();
  const candidates = [
    cfg.agents?.defaults?.repoRoot,
    process.cwd(),
    cfg.collaboration?.defaults?.workspace,
    cfg.agents?.defaults?.workspace,
  ];
  for (const candidate of candidates) {
    const configured = typeof candidate === "string" ? candidate.trim() : "";
    if (!configured) {
      continue;
    }
    const resolved = path.resolve(resolveUserPath(configured));
    if (isGitWorkingTree(resolved)) {
      return resolved;
    }
  }
  return process.cwd();
}

export function buildSupervisorTaskDraft(params: {
  message: string;
  defaultRepoRoot?: string;
  preferredWorkerBackendId?: string;
}): SupervisorTaskDraft | null {
  if (!isExplicitIdeRequest(params.message)) {
    return null;
  }
  const repoRoot = params.defaultRepoRoot?.trim() || "";
  if (!repoRoot) {
    return null;
  }
  const impactedPaths = extractImpactedPaths(params.message);
  const workerBackendId =
    params.preferredWorkerBackendId?.trim() || resolveWorkerBackendIdFromMessage(params.message);
  return {
    goal: normalizeGoal(params.message),
    repoRoot,
    workerBackendId,
    templateId: "repo-auto",
    ...(impactedPaths.length > 0 ? { impactedPaths } : {}),
  };
}
