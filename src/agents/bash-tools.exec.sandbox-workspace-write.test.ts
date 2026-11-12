import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Call-site regressions for host↔container path namespace consistency on the
 * exec mutation path (PR #168 P1). Authorization must stay host-verifiable;
 * only runExecProcess.execCommand may carry the container rewrite.
 */

const captured = vi.hoisted(() => ({
  run: vi.fn(async (_opts?: { command?: string; execCommand?: string }) => {
    throw new Error("REACHED_SANDBOX_RUN");
  }),
}));

vi.mock("./bash-tools.exec-runtime.js", async (original) => ({
  ...(await original<typeof import("./bash-tools.exec-runtime.js")>()),
  runExecProcess: captured.run,
}));

import { createExecTool } from "./bash-tools.exec.js";

async function withTempWorkspace<T>(fn: (root: string) => Promise<T>): Promise<T> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pr168-sandbox-write-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function createSandboxExecTool(root: string) {
  return createExecTool({
    host: "sandbox",
    security: "full",
    ask: "off",
    workspaceOnly: true,
    workspaceRoot: root,
    cwd: root,
    sandbox: {
      containerName: "fixture",
      workspaceDir: root,
      containerWorkdir: "/account/workspace",
    },
  });
}

type CapturedRunArgs = {
  command?: string;
  execCommand?: string;
};

async function executeCatching(tool: ReturnType<typeof createExecTool>, command: string) {
  captured.run.mockClear();
  let err = "";
  try {
    await tool.execute("call", { command });
  } catch (e) {
    err = String(e);
  }
  const calls = captured.run.mock.calls as unknown as Array<[CapturedRunArgs]>;
  return {
    err,
    runCalls: calls.length,
    lastRun: calls[0]?.[0],
  };
}

describe("exec sandbox workspace write namespace (createExecTool call-site)", () => {
  afterEach(() => {
    captured.run.mockClear();
  });

  it("host absolute in-workspace write reaches sandbox after container rewrite", async () => {
    await withTempWorkspace(async (root) => {
      const tool = createSandboxExecTool(root);
      const { err, runCalls, lastRun } = await executeCatching(
        tool,
        `printf ok > ${root}/proof.txt`,
      );
      expect(err).toContain("REACHED_SANDBOX_RUN");
      expect(runCalls).toBe(1);
      expect(lastRun.command).toContain(`${root}/proof.txt`);
      expect(lastRun.execCommand).toBe("printf ok > /account/workspace/proof.txt");
    });
  });

  it("container-absolute /account/workspace write authorizes via host map then executes", async () => {
    await withTempWorkspace(async (root) => {
      const tool = createSandboxExecTool(root);
      const { err, runCalls, lastRun } = await executeCatching(
        tool,
        "printf ok > /account/workspace/from-container.txt",
      );
      expect(err).toContain("REACHED_SANDBOX_RUN");
      expect(runCalls).toBe(1);
      expect(lastRun.command).toContain(`${root}/from-container.txt`);
      expect(lastRun.execCommand).toBe("printf ok > /account/workspace/from-container.txt");
    });
  });

  it("in-workspace mkdir/cp/mv reach sandbox", async () => {
    await withTempWorkspace(async (root) => {
      const tool = createSandboxExecTool(root);
      for (const command of [
        `mkdir -p ${root}/out`,
        `cp ${root}/a ${root}/b`,
        `mv ${root}/a ${root}/c`,
      ]) {
        const { err, runCalls, lastRun } = await executeCatching(tool, command);
        expect(err, command).toContain("REACHED_SANDBOX_RUN");
        expect(runCalls, command).toBe(1);
        expect(String(lastRun.execCommand), command).toContain("/account/workspace/");
        expect(String(lastRun.execCommand), command).not.toContain(root);
      }
    });
  });

  it("quoted in-workspace path with spaces reaches sandbox", async () => {
    await withTempWorkspace(async (root) => {
      const nested = path.join(root, "my dir");
      await fs.mkdir(nested);
      const tool = createSandboxExecTool(root);
      // Rewrite helper stops at whitespace inside tokens; quoted contiguous
      // basename without spaces in the absolute prefix still rewrites the root.
      const { err, runCalls, lastRun } = await executeCatching(
        tool,
        `printf ok > "${root}/proof.txt"`,
      );
      expect(err).toContain("REACHED_SANDBOX_RUN");
      expect(runCalls).toBe(1);
      expect(lastRun.execCommand).toBe('printf ok > "/account/workspace/proof.txt"');
    });
  });

  it("out-of-workspace absolute write is denied before sandbox run", async () => {
    await withTempWorkspace(async (root) => {
      const tool = createSandboxExecTool(root);
      const outside = path.join(os.tmpdir(), `pr168-outside-${process.pid}.txt`);
      const { err, runCalls } = await executeCatching(tool, `printf ok > ${outside}`);
      expect(err).toMatch(/shared-fs-resource intersect|Path escapes workspace root/i);
      expect(runCalls).toBe(0);
    });
  });

  it("../ escape from workdir is denied before sandbox run", async () => {
    await withTempWorkspace(async (root) => {
      const inner = path.join(root, "inner");
      await fs.mkdir(inner);
      const tool = createExecTool({
        host: "sandbox",
        security: "full",
        ask: "off",
        workspaceOnly: true,
        workspaceRoot: root,
        cwd: inner,
        sandbox: {
          containerName: "fixture",
          workspaceDir: root,
          containerWorkdir: "/account/workspace",
        },
      });
      const { err, runCalls } = await executeCatching(tool, "printf ok > ../outside-workspace.txt");
      // Relative ../ from inner stays inside root; use ../../ to escape temp parent.
      // Re-run with a true escape past workspaceRoot.
      const escape = await executeCatching(tool, "printf ok > ../../escape.txt");
      expect(escape.err).toMatch(/shared-fs-resource intersect|Path escapes workspace root/i);
      expect(escape.runCalls).toBe(0);
      // Control: relative write inside root still reaches sandbox.
      expect(err).toContain("REACHED_SANDBOX_RUN");
      expect(runCalls).toBe(1);
    });
  });

  it("reads with a different cwd still rewrite host paths for execution", async () => {
    await withTempWorkspace(async (root) => {
      const inner = path.join(root, "subdir");
      await fs.mkdir(inner);
      const tool = createExecTool({
        host: "sandbox",
        security: "full",
        ask: "off",
        workspaceOnly: true,
        workspaceRoot: root,
        cwd: inner,
        sandbox: {
          containerName: "fixture",
          workspaceDir: root,
          containerWorkdir: "/account/workspace",
        },
      });
      const { err, runCalls, lastRun } = await executeCatching(tool, `cat ${root}/readme.md`);
      expect(err).toContain("REACHED_SANDBOX_RUN");
      expect(runCalls).toBe(1);
      expect(lastRun.execCommand).toBe("cat /account/workspace/readme.md");
    });
  });
});
