/**
 * supervisor/workspace.ts — isolated task workspaces (M1, Task 1.3, D-WS).
 *
 * Workers and validators share one `Workspace.root`. Worktree is preferred
 * (via Fabric `generic.git`); falls back to an isolated directory. Tasks never
 * share a workspace root.
 */

import fs from "node:fs/promises";
import path from "node:path";
import type { FabricService } from "../../fabric/service.js";
import { CONFIG_DIR, resolveUserPath } from "../../utils.js";
import type { SupervisedTask } from "./types.js";

export interface Workspace {
  id: string;
  root: string;
  kind: "worktree" | "directory";
  branch?: string;
  /**
   * Source repository root used for worktree provisioning.
   * Persisted inside the workspace so destroy/recycle can run without
   * extra parameters (D-ISO still enforced).
   */
  repoRoot?: string;
}

export interface WorkspaceTaskRef {
  taskId: string;
  agentId?: string;
  repoRoot: string;
}

export interface WorkspaceProvider {
  create(task: WorkspaceTaskRef): Promise<Workspace>;
  destroy(task: WorkspaceTaskRef, workspace: Workspace): Promise<void>;
}

export interface WorkspacePort {
  ensure(task: WorkspaceTaskRef): Promise<SupervisedTask["workspace"]>;
  recycle?(workspace: SupervisedTask["workspace"]): Promise<void>;
}

export function resolveSupervisorWorkspacesDir(baseDir?: string): string {
  return resolveUserPath(baseDir?.trim() || path.join(CONFIG_DIR, "supervisor", "workspaces"));
}

async function markWorkspaceRetained(workspace: Workspace): Promise<void> {
  const markerPath = path.join(workspace.root, ".openbot-supervisor-retained.json");
  const payload = {
    retained: true,
    retainedAt: new Date().toISOString(),
    workspaceId: workspace.id,
    workspaceKind: workspace.kind,
    recyclable: true,
  };
  await fs.mkdir(workspace.root, { recursive: true });
  await fs.writeFile(markerPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

/** Isolated directory per task (no shared tree). */
export function createDirectoryWorkspaceProvider(opts?: { baseDir?: string }): WorkspaceProvider {
  const base = resolveSupervisorWorkspacesDir(opts?.baseDir);
  return {
    async create(task) {
      const root = path.join(base, task.taskId.trim());
      await fs.mkdir(root, { recursive: true });
      return { id: `ws-${task.taskId}`, root, kind: "directory", repoRoot: task.repoRoot };
    },
    async destroy(_task, workspace) {
      // Requirement 2.3: keep artifacts by default, only mark as recyclable.
      await markWorkspaceRetained(workspace);
    },
  };
}

async function pathIsGitRepo(dir: string): Promise<boolean> {
  try {
    await fs.access(path.join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/** Git worktree via Fabric `generic.git` (D-ISO: no scripts/loom import). */
export function createWorktreeWorkspaceProvider(opts: {
  fabric: Pick<FabricService, "execute">;
  worktreesDir?: string;
}): WorkspaceProvider {
  const worktreesBase = resolveSupervisorWorkspacesDir(opts.worktreesDir);
  return {
    async create(task) {
      const taskId = task.taskId.trim();
      const repoRoot = path.resolve(task.repoRoot);
      const root = path.join(worktreesBase, taskId);
      const branch = `supervisor/${taskId}`;
      await fs.mkdir(worktreesBase, { recursive: true });
      const { result } = await opts.fabric.execute({
        id: `sup-wt-${taskId}`,
        source: { type: "openbot" },
        tool: { name: "git" },
        input: { args: ["worktree", "add", "-B", branch, root], cwd: repoRoot },
        context: { repoRoot },
        trace: { sessionId: taskId, correlationId: taskId, taskId },
      });
      if (result.status !== "success") {
        const detail = result.output?.stderr?.trim() || result.status;
        throw new Error(`worktree add failed: ${detail}`);
      }
      return { id: `ws-${taskId}`, root, kind: "worktree", branch, repoRoot };
    },
    async destroy(_task, workspace) {
      if (workspace.kind !== "worktree") {
        return;
      }
      // Requirement 2.3: keep artifacts by default, only mark as recyclable.
      await markWorkspaceRetained(workspace);
    },
  };
}

/** try worktree → fallback directory (D-WS). */
export function createCompositeWorkspaceProvider(opts: {
  fabric?: Pick<FabricService, "execute">;
  directoryBaseDir?: string;
}): WorkspaceProvider {
  const directory = createDirectoryWorkspaceProvider({ baseDir: opts.directoryBaseDir });
  const worktree = opts.fabric ? createWorktreeWorkspaceProvider({ fabric: opts.fabric }) : null;

  return {
    async create(task) {
      if (worktree && (await pathIsGitRepo(task.repoRoot))) {
        try {
          return await worktree.create(task);
        } catch {
          // fall through to isolated directory
        }
      }
      return directory.create(task);
    },
    async destroy(task, workspace) {
      if (workspace.kind === "worktree" && worktree) {
        await worktree.destroy(task, workspace);
      } else {
        await directory.destroy(task, workspace);
      }
    },
  };
}

export function createWorkspacePort(provider: WorkspaceProvider): WorkspacePort {
  const ensured = new Map<string, SupervisedTask["workspace"]>();
  return {
    async ensure(task) {
      const key = task.taskId.trim();
      const cached = ensured.get(key);
      if (cached) {
        return cached;
      }
      const ws = await provider.create(task);
      ensured.set(key, ws);
      return ws;
    },
    async recycle(workspace) {
      await provider.destroy(
        { taskId: workspace.id.replace(/^ws-/, ""), repoRoot: workspace.root ?? "" },
        workspace,
      );
    },
  };
}
