import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { requiresExecApproval } from "../infra/exec-approvals.js";
import type { ExecPolicyProvenance } from "../infra/execution-chain-provenance.js";
import type { MutationAttemptProvenance } from "../infra/execution-chain-provenance.js";
import {
  isExecApprovalPendingResult,
  readExecPolicyProvenance,
} from "./bash-tools.exec-policy-provenance.js";
import type { ExecToolDefaults } from "./bash-tools.exec-types.js";
import { createExecTool } from "./bash-tools.exec.js";
import { createOpenClawCodingTools } from "./pi-tools.js";
import { createHostWorkspaceWriteTool, wrapToolWorkspaceRootGuard } from "./pi-tools.read.js";

vi.mock("../infra/shell-env.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../infra/shell-env.js")>();
  return { ...mod, getShellPathFromLoginShell: () => null };
});

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

/**
 * F5 shared-fs INTERSECT lock.
 *
 * Owners:
 *   write → wrapToolWorkspaceRootGuard (workspace-root-guard)
 *   exec  → createExecTool (tools.exec + shared-fs-resource when workspaceOnly)
 *
 * Semantic: exec is NOT wrapped by workspace-root-guard, but when workspaceOnly
 * is on, shared-fs-resource INTERSECTs so write-deny path class ⇒ exec-deny for
 * mutations of that path. In-workspace exec still follows tools.exec alone.
 */
const AUDIT_FILES = new Set<string>();
const F5_SESSION_ID = "f5-session-capability-boundary";
const F5_SESSION_KEY = "agent:main:main";
const F5_RUN_ID = "f5-run-capability-boundary";

function auditFile(suffix: string): string {
  const filePath = path.join(os.tmpdir(), `openbot-f5-capability-boundary-${suffix}.txt`);
  AUDIT_FILES.add(filePath);
  return filePath;
}

async function withWorkspace<T>(fn: (workspaceDir: string) => Promise<T>): Promise<T> {
  const workspaceDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-f5-ws-"));
  try {
    return await fn(workspaceDir);
  } finally {
    await fs.rm(workspaceDir, { recursive: true, force: true });
  }
}

function workspaceWriteTool(workspaceDir: string) {
  return wrapToolWorkspaceRootGuard(
    createHostWorkspaceWriteTool(workspaceDir, { workspaceOnly: true }),
    workspaceDir,
    {
      sessionId: F5_SESSION_ID,
      sessionKey: F5_SESSION_KEY,
      runId: F5_RUN_ID,
    },
  );
}

function hostExecTool(workspaceDir: string, overrides?: Partial<ExecToolDefaults>) {
  return createExecTool({
    host: "gateway",
    security: "full",
    ask: "off",
    allowBackground: false,
    cwd: workspaceDir,
    workspaceOnly: true,
    workspaceRoot: workspaceDir,
    sessionId: F5_SESSION_ID,
    sessionKey: F5_SESSION_KEY,
    runId: F5_RUN_ID,
    ...overrides,
  });
}

function readMutationProvenance(err: unknown): MutationAttemptProvenance | null {
  if (!err || typeof err !== "object" || !("execution_chain" in err)) {
    return null;
  }
  const record = (err as { execution_chain?: { kind?: string } }).execution_chain;
  if (!record || record.kind !== "mutation_attempt") {
    return null;
  }
  return record as MutationAttemptProvenance;
}

async function expectWriteSandboxDeny(workspaceDir: string, filePath: string, toolCallId: string) {
  let thrown: unknown;
  try {
    await workspaceWriteTool(workspaceDir).execute(toolCallId, {
      path: filePath,
      content: "must-not-write",
    });
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toMatch(/Path escapes sandbox root/);
  const writeRecord = readMutationProvenance(thrown);
  expect(writeRecord).toMatchObject({
    kind: "mutation_attempt",
    tool: "write",
    tool_call_id: toolCallId,
    session_id: F5_SESSION_ID,
    session_key: F5_SESSION_KEY,
    run_id: F5_RUN_ID,
    resource: filePath,
    policy: {
      owner: "workspace-root-guard",
      decision: "denied",
      reason: "sandbox_boundary",
    },
    authorization: { decision: "unknown" },
    approval: { decision: "not_observed" },
    result: "denied",
  });
  await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
  return writeRecord;
}

function expectExecPolicyRecord(
  record: ExecPolicyProvenance | null,
  expected: {
    toolCallId: string;
    decision: "allowed" | "denied";
    result: "success" | "denied" | "error";
    owner?: ExecPolicyProvenance["policy"]["owner"];
    reason?: RegExp;
  },
) {
  expect(record).toBeTruthy();
  const owner = expected.owner ?? "tools.exec";
  expect(record).toMatchObject({
    kind: "exec_policy",
    capability: "exec",
    resource: { scope: "host_process_filesystem" },
    policy: {
      owner,
      decision: expected.decision,
    },
    authorization: { decision: "unknown" },
    approval: { decision: "not_observed" },
    result: expected.result,
    session_id: F5_SESSION_ID,
    session_key: F5_SESSION_KEY,
    run_id: F5_RUN_ID,
    tool_call_id: expected.toolCallId,
  });
  expect(record?.policy.owner).not.toBe("workspace-root-guard");
  expect(record?.policy.reason).not.toMatch(/Path escapes sandbox root|sandbox_boundary/);
  if (expected.reason) {
    expect(record?.policy.reason).toMatch(expected.reason);
  }
}

describe("F5 capability substitution: write workspace guard vs exec shared-fs INTERSECT", () => {
  let isolatedHome = "";
  let previousHome: string | undefined;

  beforeAll(async () => {
    isolatedHome = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-f5-home-"));
    previousHome = process.env.HOME;
    process.env.HOME = isolatedHome;
    const { callGatewayTool } = await import("./tools/gateway.js");
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        return { status: "accepted", id: (params as { id?: string })?.id };
      }
      if (method === "exec.approval.waitDecision") {
        return { decision: "deny" };
      }
      return { ok: true };
    });
  });

  afterAll(async () => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    await fs.rm(isolatedHome, { recursive: true, force: true });
  });

  afterEach(async () => {
    await Promise.all([...AUDIT_FILES].map((filePath) => fs.rm(filePath, { force: true })));
    AUDIT_FILES.clear();
  });

  it("catalog assembly keeps exec outside workspace-root-guard and documents shared-fs INTERSECT", async () => {
    const catalogSrc = await fs.readFile(
      fileURLToPath(new URL("./pi-tools.ts", import.meta.url)),
      "utf8",
    );
    expect(catalogSrc).toContain("Exec is intentionally not wrapped by workspace-root-guard");
    expect(catalogSrc).toContain("shared-fs-resource INTERSECT");
    expect(catalogSrc).not.toMatch(/wrapToolWorkspaceRootGuard(?:WithOptions)?\(\s*execTool/);
  });

  it("Case A: write(/tmp) DENY then exec mutation DENY via shared-fs-resource INTERSECT", async () => {
    await withWorkspace(async (workspaceDir) => {
      const filePath = auditFile("case-a");
      const writeToolCallId = "f5-case-a-write";
      const execToolCallId = "f5-case-a-exec";
      await expectWriteSandboxDeny(workspaceDir, filePath, writeToolCallId);

      expect(
        requiresExecApproval({
          ask: "off",
          security: "full",
          analysisOk: true,
          allowlistSatisfied: true,
        }),
      ).toBe(false);

      const execTool = hostExecTool(workspaceDir);
      let thrown: unknown;
      try {
        await execTool.execute(execToolCallId, {
          command: `printf 'f5-exec-ok\\n' > ${filePath}`,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/exec denied: shared-fs-resource intersect/);
      const execRecord = readExecPolicyProvenance(thrown);
      expectExecPolicyRecord(execRecord, {
        toolCallId: execToolCallId,
        decision: "denied",
        result: "denied",
        owner: "tools.exec",
        reason: /shared-fs-resource intersect/,
      });
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("Case B: write DENY then exec DENY comes from tools.exec, not workspace-root-guard", async () => {
    await withWorkspace(async (workspaceDir) => {
      const filePath = auditFile("case-b");
      await expectWriteSandboxDeny(workspaceDir, filePath, "f5-case-b-write");

      const execTool = hostExecTool(workspaceDir, { security: "deny" });
      let thrown: unknown;
      try {
        await execTool.execute("f5-case-b-exec", {
          command: `printf 'must-not-exec\\n' > ${filePath}`,
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      // Shared-fs may deny first (same path). Prefer tools.exec when we force
      // a non-mutation command under security=deny.
      expect((thrown as Error).message).toMatch(
        /exec denied: (?:host=gateway security=deny|shared-fs-resource intersect)/,
      );
      expect((thrown as Error).message).not.toMatch(/Path escapes sandbox root/);
      const execRecord = readExecPolicyProvenance(thrown);
      // Outside-path mutation under workspaceOnly hits shared-fs first.
      expectExecPolicyRecord(execRecord, {
        toolCallId: "f5-case-b-exec",
        decision: "denied",
        result: "denied",
        owner: "tools.exec",
        reason: /shared-fs-resource intersect/,
      });
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("Case B2: tools.exec security=deny owns non-mutation deny without shared-fs path hit", async () => {
    await withWorkspace(async (workspaceDir) => {
      const execTool = hostExecTool(workspaceDir, { security: "deny" });
      let thrown: unknown;
      try {
        await execTool.execute("f5-case-b2-exec", {
          command: "printf 'no-fs-mutation\\n'",
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect((thrown as Error).message).toMatch(/exec denied: host=gateway security=deny/);
      const execRecord = readExecPolicyProvenance(thrown);
      expectExecPolicyRecord(execRecord, {
        toolCallId: "f5-case-b2-exec",
        decision: "denied",
        result: "denied",
        owner: "tools.exec",
        reason: /exec denied: host=gateway security=deny/,
      });
    });
  });

  it("Case C: pending exec must not forge allowed+success provenance", async () => {
    await withWorkspace(async (workspaceDir) => {
      const filePath = auditFile("case-c-pending");
      await expectWriteSandboxDeny(workspaceDir, filePath, "f5-case-c-write-pending");
      // Use in-workspace mutation so shared-fs does not short-circuit before approval.
      const inside = path.join(workspaceDir, "pending-inside.txt");
      const execTool = hostExecTool(workspaceDir, {
        security: "allowlist",
        ask: "on-miss",
      });
      const result = await execTool.execute("f5-case-c-pending", {
        command: `printf 'must-not-pending-write\\n' > ${inside}`,
      });
      expect(isExecApprovalPendingResult(result)).toBe(true);
      expect(result.details.status).toBe("approval-pending");
      expect(readExecPolicyProvenance(result)).toBeNull();
      await expect(fs.stat(inside)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("Case C: substitution records write DENY → shared-fs exec DENY (INTERSECT)", async () => {
    await withWorkspace(async (workspaceDir) => {
      const filePath = auditFile("case-c");
      const writeRecord = await expectWriteSandboxDeny(workspaceDir, filePath, "f5-case-c-write");
      const execTool = hostExecTool(workspaceDir);
      let thrown: unknown;
      try {
        await execTool.execute("f5-case-c-exec", {
          command: `printf 'substituted\\n' > ${filePath}`,
        });
      } catch (err) {
        thrown = err;
      }
      expect(writeRecord?.policy.decision).toBe("denied");
      const execRecord = readExecPolicyProvenance(thrown);
      expectExecPolicyRecord(execRecord, {
        toolCallId: "f5-case-c-exec",
        decision: "denied",
        result: "denied",
        owner: "tools.exec",
      });
      expect(execRecord?.session_id).toBe(writeRecord?.session_id);
      expect(execRecord?.run_id).toBe(writeRecord?.run_id);
      expect(execRecord?.tool_call_id).not.toBe(writeRecord?.tool_call_id);
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("Case D: in-workspace exec mutation still ALLOW under security=full ask=off", async () => {
    await withWorkspace(async (workspaceDir) => {
      const inside = path.join(workspaceDir, "case-d-inside.txt");
      const execTool = hostExecTool(workspaceDir);
      const result = await execTool.execute("f5-case-d-exec", {
        command: `printf 'in-workspace-ok\\n' > ${inside}`,
      });
      const execRecord = readExecPolicyProvenance(result);
      expectExecPolicyRecord(execRecord, {
        toolCallId: "f5-case-d-exec",
        decision: "allowed",
        result: "success",
        owner: "tools.exec",
        reason: /host=gateway security=full ask=off/,
      });
      expect(await fs.readFile(inside, "utf8")).toBe("in-workspace-ok\n");
    });
  });

  it("runtime Golden Trace: catalog write DENY → shared-fs exec DENY (no outside mutation)", async () => {
    await withWorkspace(async (workspaceDir) => {
      const filePath = auditFile("golden-trace");
      const config: OpenBotConfig = {
        tools: {
          fs: { workspaceOnly: true },
          exec: { host: "gateway", security: "full", ask: "off" },
        },
      };
      const tools = createOpenClawCodingTools({
        workspaceDir,
        forceWorkspaceOnly: true,
        sessionId: F5_SESSION_ID,
        sessionKey: F5_SESSION_KEY,
        runId: F5_RUN_ID,
        exec: { host: "gateway", security: "full", ask: "off" },
        config,
      });
      const writeTool = tools.find((tool) => tool.name === "write");
      const execTool = tools.find((tool) => tool.name === "exec");
      expect(writeTool).toBeTruthy();
      expect(execTool).toBeTruthy();

      let writeThrown: unknown;
      try {
        await writeTool?.execute("f5-gt-write", {
          path: filePath,
          content: "write-denied",
        });
      } catch (err) {
        writeThrown = err;
      }
      expect((writeThrown as Error).message).toMatch(/Path escapes sandbox root/);
      const writeRecord = readMutationProvenance(writeThrown);
      expect(writeRecord?.policy).toMatchObject({
        owner: "workspace-root-guard",
        decision: "denied",
        reason: "sandbox_boundary",
      });
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });

      let execThrown: unknown;
      try {
        await execTool?.execute("f5-gt-exec", {
          command: `printf 'golden-trace\\n' > ${filePath}`,
        });
      } catch (err) {
        execThrown = err;
      }
      expect((execThrown as Error).message).toMatch(/exec denied: shared-fs-resource intersect/);
      const execRecord = readExecPolicyProvenance(execThrown);
      expectExecPolicyRecord(execRecord, {
        toolCallId: "f5-gt-exec",
        decision: "denied",
        result: "denied",
        owner: "tools.exec",
      });
      expect(execRecord?.session_id).toBe(writeRecord?.session_id);
      expect(execRecord?.run_id).toBe(writeRecord?.run_id);
      await expect(fs.stat(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    });
  });
});
