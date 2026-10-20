import fs from "node:fs";
import path from "node:path";
import { listAgentEntries, resolveDefaultAgentId } from "../agents/agent-scope.js";
import { resolveDefaultAgentWorkspaceDir } from "../agents/workspace.js";
import type { OpenBotConfig } from "../config/config.js";
import { resolveDataRoot } from "../config/data-space.js";
import { resolveStateDir } from "../config/paths.js";
import { normalizeAgentId } from "../routing/session-key.js";

/**
 * `verify-migration-readiness` — local Data Space collection checker (SaaS tenant
 * data architecture §8, P1 deliverable).
 *
 * Before a dev/pilot machine can be packaged into a `tenant-import` bundle, its Data
 * Space must be "collected": data.root set, the Data Space tree present, and no legacy
 * layout left behind (`agents.list[].workspace` absolute paths, `~/.openbot/workspace-<id>`
 * per-agent dirs). This module is the pure, env-injectable engine behind the CLI/RPC so
 * it stays unit-testable against temp dirs (mirrors `doctor-data-space.ts`).
 *
 * Exit-code contract (doc §8.2, SAAS-T-05): with `failOnLegacyWorkspace`, any legacy
 * workspace finding is promoted to `fail` → `ready=false`, `exitCode=1`. Without it,
 * legacy findings are `warn` (Phase 1 tolerates read-only legacy) → `exitCode=0`.
 */

export type MigrationReadinessSeverity = "pass" | "warn" | "fail";

export type MigrationReadinessCheckId =
  | "data-root-configured"
  | "data-space-tree"
  | "no-absolute-workspace"
  | "no-legacy-workspace-dirs"
  | "no-legacy-knowledge-dir";

/** A source→target hint for a legacy path that should be collected before packaging. */
export type MigrationRemediation = {
  from: string;
  to: string;
};

export type MigrationReadinessFinding = {
  checkId: MigrationReadinessCheckId;
  severity: MigrationReadinessSeverity;
  title: string;
  detail: string;
  remediations?: MigrationRemediation[];
};

export type MigrationReadinessOptions = {
  /** Run filesystem checks (Data Space tree, legacy workspace/knowledge dirs). Default true. */
  checkPaths?: boolean;
  /** Run config checks (data.root configured, absolute agents.list[].workspace). Default true. */
  checkAgentsConfig?: boolean;
  /** Promote legacy workspace findings to `fail` (packaging gate). Default false. */
  failOnLegacyWorkspace?: boolean;
};

export type MigrationReadinessReport = {
  dataRoot: string;
  dataRootConfigured: boolean;
  /** True when there are no `fail`-severity findings. */
  ready: boolean;
  /** 0 when ready, 1 otherwise. Mirrors the CLI exit code. */
  exitCode: 0 | 1;
  findings: MigrationReadinessFinding[];
};

function isDir(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/** A workspace config value is legacy/non-derived when it is absolute or home-anchored. */
function isNonDerivedWorkspacePath(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) {
    return false;
  }
  return path.isAbsolute(trimmed) || trimmed.startsWith("~");
}

function legacyWorkspaceSeverity(failOnLegacyWorkspace: boolean): MigrationReadinessSeverity {
  return failOnLegacyWorkspace ? "fail" : "warn";
}

/** Data Space tree is considered present when both `agents/` and `.meta/` exist. */
function checkDataSpaceTree(dataRoot: string): MigrationReadinessFinding {
  const agentsDir = path.join(dataRoot, "agents");
  const metaDir = path.join(dataRoot, ".meta");
  const missing: string[] = [];
  if (!isDir(agentsDir)) {
    missing.push(agentsDir);
  }
  if (!isDir(metaDir)) {
    missing.push(metaDir);
  }
  if (missing.length === 0) {
    return {
      checkId: "data-space-tree",
      severity: "pass",
      title: "Data Space 树完整",
      detail: `agents/ 与 .meta/ 均存在（${dataRoot}）`,
    };
  }
  return {
    checkId: "data-space-tree",
    severity: "warn",
    title: "Data Space 树不完整",
    detail: `缺失：${missing.join(", ")}。运行 openbot setup 以修复最小目录树。`,
  };
}

function checkDataRootConfigured(cfg: OpenBotConfig, dataRoot: string): MigrationReadinessFinding {
  const configured = Boolean(cfg.data?.root?.trim());
  if (configured) {
    return {
      checkId: "data-root-configured",
      severity: "pass",
      title: "data.root 已设置",
      detail: dataRoot,
    };
  }
  return {
    checkId: "data-root-configured",
    severity: "warn",
    title: "data.root 未显式设置",
    detail: `当前使用默认根 ${dataRoot}；迁移前建议通过 openbot config set data.root 显式固定。`,
  };
}

/** Flag any `agents.list[].workspace` that is an absolute/home-anchored path (doc §8.1). */
function checkAbsoluteWorkspaceConfig(
  cfg: OpenBotConfig,
  dataRoot: string,
  failOnLegacyWorkspace: boolean,
): MigrationReadinessFinding {
  const remediations: MigrationRemediation[] = [];
  for (const entry of listAgentEntries(cfg)) {
    const workspace = typeof entry.workspace === "string" ? entry.workspace : "";
    if (!isNonDerivedWorkspacePath(workspace)) {
      continue;
    }
    const id = normalizeAgentId(entry.id);
    remediations.push({
      from: workspace.trim(),
      to: path.join(dataRoot, "agents", id, "workspace"),
    });
  }
  if (remediations.length === 0) {
    return {
      checkId: "no-absolute-workspace",
      severity: "pass",
      title: "无 agents.list[].workspace 绝对路径",
      detail: "所有 agent 工作区均由 data.root 派生。",
    };
  }
  return {
    checkId: "no-absolute-workspace",
    severity: legacyWorkspaceSeverity(failOnLegacyWorkspace),
    title: `发现 ${remediations.length} 处 agents.list[].workspace 绝对路径`,
    detail: "这些路径不会在 SaaS 侧生效，须废弃并由 data.root 派生（见架构文档 §8.1/§10.3）。",
    remediations,
  };
}

/**
 * Scan the state dir for legacy per-agent workspaces (`workspace-<id>`) and the flat
 * legacy default workspace, mapping each to its Data Space target (doc §8.1).
 */
function checkLegacyWorkspaceDirs(
  cfg: OpenBotConfig,
  dataRoot: string,
  env: NodeJS.ProcessEnv,
  failOnLegacyWorkspace: boolean,
): MigrationReadinessFinding {
  const stateDir = resolveStateDir(env);
  const defaultAgentId = resolveDefaultAgentId(cfg);
  const remediations: MigrationRemediation[] = [];
  const seen = new Set<string>();

  const addRemediation = (from: string, agentId: string): void => {
    const resolvedFrom = path.resolve(from);
    if (seen.has(resolvedFrom) || !isDir(resolvedFrom)) {
      return;
    }
    // Skip anything already inside the Data Space (nothing to collect).
    const rel = path.relative(dataRoot, resolvedFrom);
    if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
      return;
    }
    seen.add(resolvedFrom);
    remediations.push({
      from: resolvedFrom,
      to: path.join(dataRoot, "agents", normalizeAgentId(agentId), "workspace"),
    });
  };

  // 1) `{stateDir}/workspace` (flat legacy default) and `{stateDir}/workspace-<id>`.
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(stateDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    if (entry.name === "workspace") {
      addRemediation(path.join(stateDir, entry.name), defaultAgentId);
      continue;
    }
    const match = /^workspace-(.+)$/.exec(entry.name);
    if (match?.[1]) {
      addRemediation(path.join(stateDir, entry.name), match[1]);
    }
  }

  // 2) The real default workspace resolver target (legacy `~/.openclaw/workspace`).
  addRemediation(resolveDefaultAgentWorkspaceDir(env), defaultAgentId);

  if (remediations.length === 0) {
    return {
      checkId: "no-legacy-workspace-dirs",
      severity: "pass",
      title: "无遗留 workspace 目录",
      detail: `状态目录内无 workspace-* 遗留目录（${stateDir}）。`,
    };
  }
  return {
    checkId: "no-legacy-workspace-dirs",
    severity: legacyWorkspaceSeverity(failOnLegacyWorkspace),
    title: `发现 ${remediations.length} 处遗留 workspace 目录`,
    detail: "打包 tenant-import 前须迁入 Data Space 的 per-agent workspace（见架构文档 §8.1）。",
    remediations,
  };
}

/** Detect a legacy `{stateDir}/knowledge/` doc store (doc §8.1). Always informational. */
function checkLegacyKnowledgeDir(
  dataRoot: string,
  env: NodeJS.ProcessEnv,
): MigrationReadinessFinding {
  const stateDir = resolveStateDir(env);
  const legacyKnowledge = path.join(stateDir, "knowledge");
  if (!isDir(legacyKnowledge)) {
    return {
      checkId: "no-legacy-knowledge-dir",
      severity: "pass",
      title: "无遗留 knowledge 目录",
      detail: `状态目录内无 knowledge/ 遗留目录（${stateDir}）。`,
    };
  }
  return {
    checkId: "no-legacy-knowledge-dir",
    severity: "warn",
    title: "发现遗留 knowledge 目录",
    detail: "用户知识文档建议迁入 Data Space（或 tenant-shared）后再打包（见架构文档 §8.1）。",
    remediations: [{ from: legacyKnowledge, to: path.join(dataRoot, "shared", "knowledge") }],
  };
}

/**
 * Evaluate local migration readiness. Pure aside from filesystem reads; `env` is injected
 * so tests can point state dir / data root at temp dirs.
 */
export function evaluateMigrationReadiness(params: {
  cfg: OpenBotConfig;
  dataRoot?: string;
  env?: NodeJS.ProcessEnv;
  options?: MigrationReadinessOptions;
}): MigrationReadinessReport {
  const env = params.env ?? process.env;
  const cfg = params.cfg;
  const checkPaths = params.options?.checkPaths !== false;
  const checkAgentsConfig = params.options?.checkAgentsConfig !== false;
  const failOnLegacyWorkspace = params.options?.failOnLegacyWorkspace === true;

  const dataRoot = params.dataRoot ?? resolveDataRoot(cfg, env);
  const dataRootConfigured = Boolean(cfg.data?.root?.trim());
  const findings: MigrationReadinessFinding[] = [];

  if (checkAgentsConfig) {
    findings.push(checkDataRootConfigured(cfg, dataRoot));
    findings.push(checkAbsoluteWorkspaceConfig(cfg, dataRoot, failOnLegacyWorkspace));
  }
  if (checkPaths) {
    findings.push(checkDataSpaceTree(dataRoot));
    findings.push(checkLegacyWorkspaceDirs(cfg, dataRoot, env, failOnLegacyWorkspace));
    findings.push(checkLegacyKnowledgeDir(dataRoot, env));
  }

  const ready = !findings.some((finding) => finding.severity === "fail");
  return {
    dataRoot,
    dataRootConfigured,
    ready,
    exitCode: ready ? 0 : 1,
    findings,
  };
}

/** Human-readable single-line summary per finding (CLI/doctor rendering helper). */
export function formatMigrationReadinessFinding(finding: MigrationReadinessFinding): string {
  const glyph = finding.severity === "pass" ? "✓" : finding.severity === "warn" ? "⚠" : "✗";
  const lines = [`${glyph} ${finding.title} — ${finding.detail}`];
  for (const remediation of finding.remediations ?? []) {
    lines.push(`    ${remediation.from} → ${remediation.to}`);
  }
  return lines.join("\n");
}
