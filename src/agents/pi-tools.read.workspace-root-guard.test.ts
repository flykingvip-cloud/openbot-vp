import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wrapToolWorkspaceRootGuardWithOptions } from "./pi-tools.read.js";
import type { AnyAgentTool } from "./pi-tools.types.js";

const mocks = vi.hoisted(() => ({
  assertSandboxPath: vi.fn(async () => ({ resolved: "/tmp/root", relative: "" })),
}));

vi.mock("./sandbox-paths.js", () => ({
  assertSandboxPath: mocks.assertSandboxPath,
}));

function createToolHarness() {
  const execute = vi.fn(async () => ({
    content: [{ type: "text", text: "ok" }],
  }));
  const tool = {
    name: "read",
    description: "test tool",
    inputSchema: { type: "object", properties: {} },
    execute,
  } as unknown as AnyAgentTool;
  return { execute, tool };
}

describe("wrapToolWorkspaceRootGuardWithOptions", () => {
  const root = "/tmp/root";

  beforeEach(() => {
    mocks.assertSandboxPath.mockClear();
  });

  it("maps container workspace paths to host workspace root", async () => {
    const { tool } = createToolHarness();
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(tool, root, {
      containerWorkdir: "/workspace",
    });

    await wrapped.execute("tc1", { path: "/workspace/docs/readme.md" });

    expect(mocks.assertSandboxPath).toHaveBeenCalledWith({
      filePath: path.resolve(root, "docs", "readme.md"),
      cwd: root,
      root,
    });
  });

  it("maps file:// container workspace paths to host workspace root", async () => {
    const { tool } = createToolHarness();
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(tool, root, {
      containerWorkdir: "/workspace",
    });

    await wrapped.execute("tc2", { path: "file:///workspace/docs/readme.md" });

    expect(mocks.assertSandboxPath).toHaveBeenCalledWith({
      filePath: path.resolve(root, "docs", "readme.md"),
      cwd: root,
      root,
    });
  });

  it("maps @-prefixed container workspace paths to host workspace root", async () => {
    const { tool } = createToolHarness();
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(tool, root, {
      containerWorkdir: "/workspace",
    });

    await wrapped.execute("tc-at-container", { path: "@/workspace/docs/readme.md" });

    expect(mocks.assertSandboxPath).toHaveBeenCalledWith({
      filePath: path.resolve(root, "docs", "readme.md"),
      cwd: root,
      root,
    });
  });

  it("normalizes @-prefixed absolute paths before guard checks", async () => {
    const { tool } = createToolHarness();
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(tool, root, {
      containerWorkdir: "/workspace",
    });

    await wrapped.execute("tc-at-absolute", { path: "@/etc/passwd" });

    expect(mocks.assertSandboxPath).toHaveBeenCalledWith({
      filePath: "/etc/passwd",
      cwd: root,
      root,
    });
  });

  it("does not remap absolute paths outside the configured container workdir", async () => {
    const { tool } = createToolHarness();
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(tool, root, {
      containerWorkdir: "/workspace",
    });

    await wrapped.execute("tc3", { path: "/workspace-two/secret.txt" });

    expect(mocks.assertSandboxPath).toHaveBeenCalledWith({
      filePath: "/workspace-two/secret.txt",
      cwd: root,
      root,
    });
  });

  it("records per-attempt mutation provenance when an out-of-scope write is denied", async () => {
    const { execute, tool } = createToolHarness();
    const writeTool = { ...tool, name: "write" } as unknown as AnyAgentTool;
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(writeTool, root);
    const err = new Error("Path escapes sandbox root (/tmp/root): /tmp/openbot-audit-test.txt");
    mocks.assertSandboxPath.mockRejectedValueOnce(err);

    await expect(
      wrapped.execute("attempt-1", { path: "/tmp/openbot-audit-test.txt" }),
    ).rejects.toThrow(/Path escapes sandbox root/);
    expect(execute).not.toHaveBeenCalled();
    expect(
      (err as Error & { execution_chain?: Record<string, unknown> }).execution_chain,
    ).toMatchObject({
      kind: "mutation_attempt",
      tool: "write",
      tool_call_id: "attempt-1",
      session_id: null,
      session_key: null,
      run_id: null,
      resource: "/tmp/openbot-audit-test.txt",
      policy: {
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "denied",
    });
  });

  it("re-enters the existing sandbox guard for a recovery write and records a separate attempt", async () => {
    const { execute, tool } = createToolHarness();
    const writeTool = { ...tool, name: "write" } as unknown as AnyAgentTool;
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(writeTool, root);
    const denied = new Error("Path escapes sandbox root (/tmp/root): /tmp/openbot-audit-test.txt");
    mocks.assertSandboxPath
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce({ resolved: root, relative: "openbot-audit-test.txt" });

    await expect(
      wrapped.execute("attempt-1", { path: "/tmp/openbot-audit-test.txt" }),
    ).rejects.toThrow(/Path escapes sandbox root/);

    const recovered = await wrapped.execute("attempt-2", {
      path: "/tmp/root/openbot-audit-test.txt",
    });

    expect(mocks.assertSandboxPath).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(recovered).toMatchObject({
      details: {
        executionChainProvenance: [
          {
            kind: "mutation_attempt",
            tool: "write",
            tool_call_id: "attempt-2",
            session_id: null,
            session_key: null,
            run_id: null,
            resource: "/tmp/root/openbot-audit-test.txt",
            policy: {
              owner: "workspace-root-guard",
              decision: "allowed",
              reason: "passed_existing_guard",
            },
            authorization: { decision: "unknown" },
            approval: { decision: "not_observed" },
            result: "success",
          },
        ],
      },
    });
  });

  it("correlates deny and recovery allow to the same execution identity", async () => {
    const { execute, tool } = createToolHarness();
    const writeTool = { ...tool, name: "write" } as unknown as AnyAgentTool;
    const wrapped = wrapToolWorkspaceRootGuardWithOptions(writeTool, root, {
      sessionId: "f3-session-1",
      sessionKey: "agent:f3-audit:main",
      runId: "f3-run-1",
    });
    const denied = new Error("Path escapes sandbox root (/tmp/root): /tmp/openbot-audit-test.txt");
    mocks.assertSandboxPath
      .mockRejectedValueOnce(denied)
      .mockResolvedValueOnce({ resolved: root, relative: "openbot-audit-test.txt" });

    await expect(
      wrapped.execute("attempt-1", { path: "/tmp/openbot-audit-test.txt" }),
    ).rejects.toThrow(/Path escapes sandbox root/);
    const recovered = await wrapped.execute("attempt-2", {
      path: "/tmp/root/openbot-audit-test.txt",
    });

    const denyRecord = (denied as Error & { execution_chain?: Record<string, unknown> })
      .execution_chain;
    const allowRecord = (
      recovered as { details?: { executionChainProvenance?: Array<Record<string, unknown>> } }
    ).details?.executionChainProvenance?.[0];

    expect(denyRecord).toMatchObject({
      kind: "mutation_attempt",
      tool_call_id: "attempt-1",
      session_id: "f3-session-1",
      session_key: "agent:f3-audit:main",
      run_id: "f3-run-1",
      policy: { decision: "denied", owner: "workspace-root-guard" },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "denied",
    });
    expect(allowRecord).toMatchObject({
      kind: "mutation_attempt",
      tool_call_id: "attempt-2",
      session_id: "f3-session-1",
      session_key: "agent:f3-audit:main",
      run_id: "f3-run-1",
      policy: { decision: "allowed", owner: "workspace-root-guard" },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
    });
    expect(denyRecord?.session_id).toBe(allowRecord?.session_id);
    expect(denyRecord?.run_id).toBe(allowRecord?.run_id);
    expect(denyRecord?.tool_call_id).not.toBe(allowRecord?.tool_call_id);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
