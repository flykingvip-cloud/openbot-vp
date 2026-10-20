import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigCache } from "../config/config.js";
import {
  createExecPolicyProvenance,
  isExecApprovalPendingResult,
  isExecPolicyDenyMessage,
  markExecPolicyAllowed,
  readExecPolicyProvenance,
  runWithExecPolicyProvenance,
} from "./bash-tools.exec-policy-provenance.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

const draft = {
  session_id: "sess-1",
  session_key: "agent:main:main",
  run_id: "run-1",
  tool_call_id: "tc-exec-1",
  command: "printf x > /tmp/openbot-f5.txt",
  host: "gateway",
  security: "full",
  ask: "off",
};

function pendingResult() {
  return {
    content: [{ type: "text" as const, text: "Approval required" }],
    details: {
      status: "approval-pending" as const,
      approvalId: "pending-1",
      approvalSlug: "pend",
      expiresAtMs: Date.now() + 60_000,
      host: "gateway" as const,
      command: draft.command,
    },
  };
}

describe("exec policy provenance", () => {
  it("classifies only existing tools.exec deny text as policy deny", () => {
    expect(isExecPolicyDenyMessage("exec denied: host=gateway security=deny")).toBe(true);
    expect(isExecPolicyDenyMessage("exec denied: allowlist miss")).toBe(true);
    expect(isExecPolicyDenyMessage("Path escapes sandbox root: /tmp/x")).toBe(false);
    expect(isExecPolicyDenyMessage("Command failed.")).toBe(false);
  });

  it("recognizes existing approval/pending statuses without a second state system", () => {
    expect(isExecApprovalPendingResult(pendingResult())).toBe(true);
    expect(
      isExecApprovalPendingResult({
        details: { status: "approval-unavailable", reason: "no-approval-route" },
      }),
    ).toBe(true);
    expect(isExecApprovalPendingResult({ details: { status: "completed" } })).toBe(false);
  });

  it("records unknown authorization and not_observed approval without inferring pass", () => {
    const record = createExecPolicyProvenance(draft, {
      decision: "allowed",
      result: "success",
    });
    expect(record).toMatchObject({
      kind: "exec_policy",
      capability: "exec",
      resource: {
        scope: "host_process_filesystem",
        target: draft.command,
      },
      policy: {
        owner: "tools.exec",
        decision: "allowed",
        reason: "host=gateway security=full ask=off",
      },
      authorization: { decision: "unknown" },
      approval: { decision: "not_observed" },
      result: "success",
      session_id: "sess-1",
      session_key: "agent:main:main",
      run_id: "run-1",
      tool_call_id: "tc-exec-1",
    });
  });

  it("does not infer ALLOW from a wrapper return without a tools.exec SoT decision", async () => {
    const returned = await runWithExecPolicyProvenance({ ...draft }, async () => ({
      content: [{ type: "text", text: "ok" }],
      details: { status: "completed" },
    }));
    expect(readExecPolicyProvenance(returned)).toBeNull();
  });

  it("decorates allow only after an existing tools.exec SoT marks allowed", async () => {
    const allowed = await runWithExecPolicyProvenance({ ...draft }, async (next) => {
      markExecPolicyAllowed(next);
      return {
        content: [{ type: "text", text: "ok" }],
        details: { status: "completed" },
      };
    });
    expect(readExecPolicyProvenance(allowed)?.policy.decision).toBe("allowed");
    expect(readExecPolicyProvenance(allowed)?.result).toBe("success");
    expect(readExecPolicyProvenance(allowed)?.authorization.decision).toBe("unknown");
    expect(readExecPolicyProvenance(allowed)?.approval.decision).toBe("not_observed");
  });

  it("does not forge allowed+success provenance on approval/policy pending", async () => {
    const pending = pendingResult();
    const returned = await runWithExecPolicyProvenance({ ...draft }, async (next) => {
      markExecPolicyAllowed(next);
      return pending;
    });
    expect(returned.details.status).toBe("approval-pending");
    expect(readExecPolicyProvenance(returned)).toBeNull();
  });

  it("attaches deny records onto thrown tools.exec denials", async () => {
    const denyDraft = { ...draft, security: "deny" };
    await expect(
      runWithExecPolicyProvenance(denyDraft, async () => {
        throw new Error("exec denied: host=gateway security=deny");
      }),
    ).rejects.toMatchObject({
      message: "exec denied: host=gateway security=deny",
      execution_chain: {
        kind: "exec_policy",
        policy: { owner: "tools.exec", decision: "denied" },
        authorization: { decision: "unknown" },
        approval: { decision: "not_observed" },
        result: "denied",
      },
    });
  });

  it("keeps execution errors as allowed + error only after a SoT allow", async () => {
    await expect(
      runWithExecPolicyProvenance({ ...draft }, async (next) => {
        markExecPolicyAllowed(next);
        throw new Error("Command failed.");
      }),
    ).rejects.toMatchObject({
      message: "Command failed.",
      execution_chain: {
        kind: "exec_policy",
        policy: { owner: "tools.exec", decision: "allowed" },
        result: "error",
        authorization: { decision: "unknown" },
        approval: { decision: "not_observed" },
      },
    });
  });

  it("does not forge allowed provenance for errors before a SoT allow", async () => {
    await expect(
      runWithExecPolicyProvenance({ ...draft }, async () => {
        throw new Error("sandbox runtime is unavailable");
      }),
    ).rejects.toMatchObject({
      message: "sandbox runtime is unavailable",
    });
    try {
      await runWithExecPolicyProvenance({ ...draft }, async () => {
        throw new Error("sandbox runtime is unavailable");
      });
    } catch (err) {
      expect(readExecPolicyProvenance(err)).toBeNull();
      expect((err as { execution_chain?: unknown }).execution_chain).toBeUndefined();
    }
  });
});

describe("exec policy provenance pending via createExecTool", () => {
  let previousHome: string | undefined;
  let callGatewayTool: typeof import("./tools/gateway.js").callGatewayTool;
  let createExecTool: typeof import("./bash-tools.exec.js").createExecTool;

  beforeAll(async () => {
    ({ callGatewayTool } = await import("./tools/gateway.js"));
    ({ createExecTool } = await import("./bash-tools.exec.js"));
  });

  beforeEach(async () => {
    previousHome = process.env.HOME;
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-f5-pending-home-"));
    process.env.HOME = tempDir;
  });

  afterEach(async () => {
    vi.resetAllMocks();
    clearConfigCache();
    const isolatedHome = process.env.HOME;
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    if (isolatedHome && isolatedHome !== previousHome) {
      await fs.rm(isolatedHome, { recursive: true, force: true });
    }
  });

  it("Case C: gateway pending does not emit allowed+success exec_policy", async () => {
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        return { status: "accepted", id: (params as { id?: string })?.id };
      }
      if (method === "exec.approval.waitDecision") {
        return { decision: "deny" };
      }
      return { ok: true };
    });

    const target = path.join(os.tmpdir(), `openbot-f5-pending-${Date.now()}.txt`);
    const tool = createExecTool({
      host: "gateway",
      ask: "on-miss",
      security: "allowlist",
      approvalRunningNoticeMs: 0,
      allowBackground: false,
      sessionId: "f5-session-pending",
      sessionKey: "agent:main:main",
      runId: "f5-run-pending",
    });
    const result = await tool.execute("f5-pending-exec", {
      command: `printf 'must-not-write\\n' > ${target}`,
    });
    expect(result.details.status).toBe("approval-pending");
    expect(readExecPolicyProvenance(result)).toBeNull();
    await expect(fs.stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
