import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ObjectiveCommandSpec, ObjectiveCoverageSpec } from "./coding-evaluator.js";

export type PackageManager = "pnpm" | "npm" | "bun" | "yarn";

export interface WorkspaceObjectiveCommands {
  build?: ObjectiveCommandSpec;
  test?: ObjectiveCommandSpec;
  coverage?: ObjectiveCoverageSpec;
}

/** Infer package manager from lockfiles (defaults to pnpm for monorepos without a lock in cwd). */
export function detectPackageManager(workspace: string): PackageManager {
  if (existsSync(join(workspace, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (existsSync(join(workspace, "bun.lock")) || existsSync(join(workspace, "bun.lockb"))) {
    return "bun";
  }
  if (existsSync(join(workspace, "yarn.lock"))) {
    return "yarn";
  }
  if (existsSync(join(workspace, "package-lock.json"))) {
    return "npm";
  }
  return "pnpm";
}

function pmRunSpec(pm: PackageManager, script: string): ObjectiveCommandSpec {
  if (pm === "npm" || pm === "yarn") {
    return { command: pm, args: ["run", script] };
  }
  return { command: pm, args: [script] };
}

function readPackageScripts(workspace: string): Record<string, string> {
  const pkgPath = join(workspace, "package.json");
  if (!existsSync(pkgPath)) {
    throw new Error(`No package.json in workspace: ${workspace}`);
  }
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { scripts?: Record<string, string> };
  return pkg.scripts ?? {};
}

/**
 * Resolve build / test / coverage commands from a workspace `package.json`.
 * Explicit overrides win; otherwise scripts are mapped via the detected package manager.
 */
export function resolveWorkspaceObjectiveCommands(
  workspace: string,
  overrides: Partial<WorkspaceObjectiveCommands> = {},
): WorkspaceObjectiveCommands {
  const scripts = readPackageScripts(workspace);
  const pm = detectPackageManager(workspace);
  const out: WorkspaceObjectiveCommands = {};

  if (overrides.build) {
    out.build = overrides.build;
  } else if (scripts.build) {
    out.build = pmRunSpec(pm, "build");
  }

  if (overrides.test) {
    out.test = overrides.test;
  } else if (scripts.test) {
    out.test = pmRunSpec(pm, "test");
  }

  if (overrides.coverage !== undefined) {
    out.coverage = overrides.coverage;
  } else if (scripts["test:coverage"]) {
    out.coverage = pmRunSpec(pm, "test:coverage");
  } else if (scripts.coverage) {
    out.coverage = pmRunSpec(pm, "coverage");
  }

  if (!out.build && !out.test && out.coverage === undefined) {
    throw new Error(`Workspace ${workspace} has no build/test/coverage scripts in package.json`);
  }

  return out;
}
