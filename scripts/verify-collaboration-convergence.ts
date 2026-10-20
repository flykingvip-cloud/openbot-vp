/**
 * 协作收敛验收探针（设计文档 §8 / §9）。
 *
 * 用法：
 *   bun scripts/verify-collaboration-convergence.ts \
 *     --group-id grp-daniel-hhd-gmail-com-upbeyond
 *
 * 可选：
 *   --json          输出 JSON
 *   --run-tests     同时跑 AC 自动化单测
 *   --fail-on-warn  有 warning 时也以非零退出
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { resolveAgentWorkspaceDir, resolveDefaultAgentId } from "../src/agents/agent-scope.js";
import { loadConfig } from "../src/config/config.js";
import { resolveStateDir } from "../src/config/paths.js";
import { resolveGroupCollaborationPaths } from "../src/gateway/collaboration-learning/collaboration-paths.js";
import {
  discoverLegacyGroupDirs,
  resolveManagedSpaceProfilePath,
} from "../src/gateway/collaboration-learning/group-storage-migration.js";

const execFileAsync = promisify(execFile);

type CheckResult = {
  id: string;
  status: "pass" | "warn" | "fail";
  detail: string;
};

function readArg(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1]?.trim() || null;
}

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function countTaskLedgers(groupId: string): Promise<string[]> {
  const cfg = loadConfig();
  const stateDir = resolveStateDir();
  const defaultWorkspaceDir = resolveAgentWorkspaceDir(cfg, resolveDefaultAgentId(cfg));
  const legacyDirs = await discoverLegacyGroupDirs({
    stateDir,
    groupId,
    extraRoots: [defaultWorkspaceDir],
  });
  const hits: string[] = [];
  for (const dir of legacyDirs) {
    const candidate = path.join(dir, "memory", "task_ledger.json");
    if (await pathExists(candidate)) {
      hits.push(candidate);
    }
  }
  const paths = resolveGroupCollaborationPaths(groupId, cfg);
  const canonical = path.join(paths.memoryDir, "task_ledger.json");
  if (await pathExists(canonical)) {
    hits.push(canonical);
  }
  return [...new Set(hits)];
}

async function runChecks(groupId: string): Promise<CheckResult[]> {
  const cfg = loadConfig();
  const paths = resolveGroupCollaborationPaths(groupId, cfg);
  const results: CheckResult[] = [];

  results.push({
    id: "AC-0-collaboration-root",
    status: paths.collaborationWorkspaceRoot ? "pass" : "warn",
    detail: paths.collaborationWorkspaceRoot
      ? `collaboration.defaults.workspace=${paths.collaborationWorkspaceRoot}`
      : "collaboration.defaults.workspace is not configured; runtime uses legacy agent workspace root",
  });

  results.push({
    id: "AC-2-workspace-materialized",
    status: (await pathExists(paths.workspacePath)) ? "pass" : "fail",
    detail: paths.workspacePath,
  });

  const taskLedgers = await countTaskLedgers(groupId);
  results.push({
    id: "AC-3-single-task-ledger",
    status: taskLedgers.length === 1 ? "pass" : taskLedgers.length === 0 ? "warn" : "fail",
    detail:
      taskLedgers.length === 0
        ? "no task_ledger.json found yet"
        : taskLedgers.map((entry) => `- ${entry}`).join("\n"),
  });

  results.push({
    id: "AC-4-capsules-at-resolver-root",
    status: (await pathExists(path.join(paths.groupDir, "capsules.json"))) ? "pass" : "warn",
    detail: path.join(paths.groupDir, "capsules.json"),
  });

  results.push({
    id: "AC-3-charter-present",
    status: (await pathExists(paths.groupCharterFile)) ? "pass" : "warn",
    detail: paths.groupCharterFile,
  });

  const profilePath = resolveManagedSpaceProfilePath(resolveStateDir(), groupId);
  results.push({
    id: "AC-2-managed-profile-workspacePath",
    status: (await pathExists(profilePath)) ? "pass" : "warn",
    detail: profilePath,
  });

  try {
    if (hasFlag("--run-tests")) {
      await execFileAsync(
        "pnpm",
        [
          "exec",
          "vitest",
          "run",
          "--config",
          "vitest.gateway.config.ts",
          "src/gateway/collaboration-learning/convergence-acceptance.test.ts",
          "ui/src/ui/controllers/collaboration-round-plan.test.ts",
          "ui/src/ui/ports/employee/views/workbench-stage-collaboration.node.test.ts",
        ],
        {
          cwd: process.cwd(),
          env: process.env,
        },
      );
      results.push({
        id: "AC-1-AC-6-automated-tests",
        status: "pass",
        detail: "convergence acceptance + round plan + reason drawer tests passed",
      });
    }
  } catch (error) {
    results.push({
      id: "AC-1-AC-6-automated-tests",
      status: "fail",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  return results;
}

async function main(): Promise<void> {
  const groupId = readArg("--group-id");
  if (!groupId) {
    throw new Error("--group-id is required");
  }
  const json = hasFlag("--json");
  const failOnWarn = hasFlag("--fail-on-warn");
  const results = await runChecks(groupId);
  const failed = results.some((entry) => entry.status === "fail");
  const warned = results.some((entry) => entry.status === "warn");

  if (json) {
    console.log(JSON.stringify({ groupId, results, failed, warned }, null, 2));
  } else {
    console.log(`Collaboration convergence verification — ${groupId}\n`);
    for (const entry of results) {
      console.log(`[${entry.status.toUpperCase()}] ${entry.id}`);
      console.log(entry.detail);
      console.log("");
    }
    console.log(failed ? "RESULT: FAIL" : warned ? "RESULT: WARN" : "RESULT: PASS");
  }

  if (failed || (failOnWarn && warned)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
