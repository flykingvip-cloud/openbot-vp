import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveSandboxWorkdir,
  rewriteGatewayAbsoluteHostPathsInCommand,
} from "./bash-tools.shared.js";

async function withTempDir(run: (dir: string) => Promise<void>) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openbot-bash-workdir-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("resolveSandboxWorkdir", () => {
  it("maps container root workdir to host workspace", async () => {
    await withTempDir(async (workspaceDir) => {
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/workspace",
        sandbox: {
          containerName: "sandbox-1",
          workspaceDir,
          containerWorkdir: "/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(workspaceDir);
      expect(resolved.containerWorkdir).toBe("/workspace");
      expect(warnings).toEqual([]);
    });
  });

  it("maps nested container workdir under the container workspace", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "scripts", "runner");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/workspace/scripts/runner",
        sandbox: {
          containerName: "sandbox-2",
          workspaceDir,
          containerWorkdir: "/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(nested);
      expect(resolved.containerWorkdir).toBe("/workspace/scripts/runner");
      expect(warnings).toEqual([]);
    });
  });

  it("supports custom container workdir prefixes", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "project");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: "/sandbox-root/project",
        sandbox: {
          containerName: "sandbox-3",
          workspaceDir,
          containerWorkdir: "/sandbox-root",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(nested);
      expect(resolved.containerWorkdir).toBe("/sandbox-root/project");
      expect(warnings).toEqual([]);
    });
  });

  it("maps gateway-absolute host workspace workdir into the account container mount", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "deliverables");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const gatewayAbsolute = workspaceDir; // same path the gateway mounts as /root/.openbot/...
      const resolved = await resolveSandboxWorkdir({
        workdir: gatewayAbsolute,
        sandbox: {
          containerName: "aw-exec-lease-1",
          workspaceDir,
          containerWorkdir: "/account/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(workspaceDir);
      expect(resolved.containerWorkdir).toBe("/account/workspace");
      expect(warnings).toEqual([]);
    });
  });

  it("maps nested gateway-absolute workdir under the account mount", async () => {
    await withTempDir(async (workspaceDir) => {
      const nested = path.join(workspaceDir, "deliverables", "brief");
      await mkdir(nested, { recursive: true });
      const warnings: string[] = [];
      const resolved = await resolveSandboxWorkdir({
        workdir: nested,
        sandbox: {
          containerName: "aw-exec-lease-2",
          workspaceDir,
          containerWorkdir: "/account/workspace",
        },
        warnings,
      });

      expect(resolved.hostWorkdir).toBe(nested);
      expect(resolved.containerWorkdir).toBe("/account/workspace/deliverables/brief");
      expect(warnings).toEqual([]);
    });
  });
});

describe("rewriteGatewayAbsoluteHostPathsInCommand", () => {
  it("rewrites gateway-absolute workspace paths to the account container mount", () => {
    const workspaceDir = "/root/.openbot/operators/u1/OpenBot/agents/bot-2/workspace";
    const rewritten = rewriteGatewayAbsoluteHostPathsInCommand({
      command: `cat ${workspaceDir}/deliverables/report.md && ls ${workspaceDir}`,
      workspaceDir,
      containerWorkdir: "/account/workspace",
    });
    expect(rewritten).toBe(
      "cat /account/workspace/deliverables/report.md && ls /account/workspace",
    );
  });

  it("leaves unrelated absolute paths untouched", () => {
    const workspaceDir = "/root/.openbot/operators/u1/OpenBot/agents/bot-2/workspace";
    const command = "cat /etc/hosts && ls /tmp";
    expect(
      rewriteGatewayAbsoluteHostPathsInCommand({
        command,
        workspaceDir,
        containerWorkdir: "/account/workspace",
      }),
    ).toBe(command);
  });

  it("supports /workspace container mount vocabulary", () => {
    const workspaceDir = "/root/.openbot/operators/u1/OpenBot/agents/bot-2/workspace";
    expect(
      rewriteGatewayAbsoluteHostPathsInCommand({
        command: `python ${workspaceDir}/scripts/run.py`,
        workspaceDir,
        containerWorkdir: "/workspace",
      }),
    ).toBe("python /workspace/scripts/run.py");
  });
});
