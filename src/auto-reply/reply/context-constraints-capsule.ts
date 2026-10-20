import fs from "node:fs";
import path from "node:path";
import { DEFAULT_AGENTS_FILENAME } from "../../agents/workspace.js";
import type { OpenBotConfig } from "../../config/config.js";
import { buildRetentionPolicySummary } from "../../conversations/retention-enforcer.js";
import { openBoundaryFileSync } from "../../infra/boundary-file-read.js";
import { truncateUtf16Safe } from "../../utils.js";
import { extractSections } from "./post-compaction-context.js";

const MAX_CONSTRAINTS_CHARS = 1500;

function readAgentsConstraints(workspaceDir: string): string {
  const agentsPath = path.join(workspaceDir, DEFAULT_AGENTS_FILENAME);
  try {
    const opened = openBoundaryFileSync({
      absolutePath: agentsPath,
      rootPath: workspaceDir,
      boundaryLabel: "workspace root",
    });
    if (!opened.ok) {
      return "";
    }
    const content = (() => {
      try {
        return fs.readFileSync(opened.fd, "utf-8");
      } finally {
        fs.closeSync(opened.fd);
      }
    })();
    let sections = extractSections(content, ["Session Startup", "Red Lines"]);
    if (sections.length === 0) {
      sections = extractSections(content, ["Every Session", "Safety"]);
    }
    return sections.join("\n\n").trim();
  } catch {
    return "";
  }
}

/** AGENTS.md critical sections + tenant retention summary for the constraints budget segment. */
export function buildContextConstraintsCapsule(params: {
  cfg: OpenBotConfig;
  workspaceDir: string;
  tenantId?: string | null;
}): string {
  const parts: string[] = [];
  const agents = readAgentsConstraints(params.workspaceDir);
  if (agents) {
    parts.push(`Operating constraints (from agent instructions):\n${agents}`);
  }
  const retention = buildRetentionPolicySummary(params.cfg, params.tenantId);
  if (retention.trim()) {
    parts.push(`Data retention policy:\n${retention.trim()}`);
  }
  if (parts.length === 0) {
    return "";
  }
  return truncateUtf16Safe(parts.join("\n\n"), MAX_CONSTRAINTS_CHARS);
}
