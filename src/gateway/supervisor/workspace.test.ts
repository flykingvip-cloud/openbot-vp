import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ToolExecutionResult } from "../../fabric/contract.js";
import type { FabricService } from "../../fabric/service.js";
import { createCompositeWorkspaceProvider, createWorktreeWorkspaceProvider } from "./workspace.js";

const execFileAsync = promisify(execFile);

async function runGit(cwd: string, args: string[]): Promise<void> {
  await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
    },
  });
}

async function initSeedRepo(repoRoot: string): Promise<void> {
  await fs.mkdir(repoRoot, { recursive: true });
  await runGit(repoRoot, ["init"]);
  await runGit(repoRoot, ["config", "user.email", "supervisor-test@openbot.local"]);
  await runGit(repoRoot, ["config", "user.name", "openbot-supervisor-test"]);
  await fs.writeFile(path.join(repoRoot, "README"), "seed\n", "utf8");
  await runGit(repoRoot, ["add", "README"]);
  await runGit(repoRoot, ["commit", "-m", "seed"]);
}

/** Minimal Fabric delegate: runs real `git` with request args (generic.git path). */
function createGitFabricDelegate(): Pick<FabricService, "execute"> {
  return {
    async execute(request) {
      const cwd =
        typeof request.input?.cwd === "string"
          ? request.input.cwd
          : typeof request.context?.repoRoot === "string"
            ? request.context.repoRoot
            : process.cwd();
      const args = Array.isArray(request.input?.args)
        ? request.input.args.map((value) => String(value))
        : [];
      try {
        const { stdout, stderr } = await execFileAsync("git", args, { cwd });
        const result = {
          status: "success",
          output: { stdout: stdout.trim(), stderr: stderr.trim() },
        } as ToolExecutionResult;
        return { result };
      } catch (err) {
        const failure = err as { stderr?: string; message?: string };
        const result = {
          status: "failed",
          output: { stderr: String(failure.stderr ?? failure.message ?? err) },
        } as ToolExecutionResult;
        return { result };
      }
    },
  };
}

describe("workspace — worktree provider (Fabric git path)", () => {
  let repoRoot: string;
  let worktreesDir: string;
  let extraCleanupPaths: string[] = [];

  afterEach(async () => {
    for (const dir of extraCleanupPaths) {
      await rm(dir, { recursive: true, force: true });
    }
    extraCleanupPaths = [];
    if (repoRoot) {
      await rm(repoRoot, { recursive: true, force: true });
      repoRoot = "";
    }
    if (worktreesDir) {
      await rm(worktreesDir, { recursive: true, force: true });
      worktreesDir = "";
    }
  });

  it("createWorktreeWorkspaceProvider provisions a real git worktree via fabric.execute", async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "sup-repo-"));
    worktreesDir = await mkdtemp(path.join(tmpdir(), "sup-wt-"));
    await initSeedRepo(repoRoot);

    const fabric = createGitFabricDelegate();
    const executeSpy = vi.spyOn(fabric, "execute");

    const provider = createWorktreeWorkspaceProvider({ fabric, worktreesDir });
    const workspace = await provider.create({
      taskId: "task-wt-1",
      repoRoot,
    });

    expect(workspace.kind).toBe("worktree");
    expect(workspace.branch).toBe("supervisor/task-wt-1");
    expect(workspace.root).toBe(path.join(worktreesDir, "task-wt-1"));
    expect(workspace.repoRoot).toBe(path.resolve(repoRoot));

    expect(executeSpy).toHaveBeenCalledTimes(1);
    expect(executeSpy.mock.calls[0]?.[0]).toMatchObject({
      tool: { name: "git" },
      input: {
        args: ["worktree", "add", "-B", "supervisor/task-wt-1", workspace.root],
        cwd: path.resolve(repoRoot),
      },
      context: { repoRoot: path.resolve(repoRoot) },
    });

    const inside = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspace.root,
    });
    expect(inside.stdout.trim()).toBe("true");

    const branch = await execFileAsync("git", ["symbolic-ref", "--short", "HEAD"], {
      cwd: workspace.root,
    });
    expect(branch.stdout.trim()).toBe("supervisor/task-wt-1");
  });

  it("createCompositeWorkspaceProvider prefers worktree when repoRoot is a git repo", async () => {
    repoRoot = await mkdtemp(path.join(tmpdir(), "sup-repo-"));
    const directoryBaseDir = await mkdtemp(path.join(tmpdir(), "sup-dir-"));
    extraCleanupPaths.push(directoryBaseDir);
    await initSeedRepo(repoRoot);

    const provider = createCompositeWorkspaceProvider({
      fabric: createGitFabricDelegate(),
      directoryBaseDir,
    });
    const workspace = await provider.create({
      taskId: "task-composite-wt",
      repoRoot,
    });

    expect(workspace.kind).toBe("worktree");
    extraCleanupPaths.push(workspace.root);

    const inside = await execFileAsync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: workspace.root,
    });
    expect(inside.stdout.trim()).toBe("true");
  });
});
