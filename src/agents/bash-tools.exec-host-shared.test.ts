import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDesktopSaveExecCommand } from "../infra/local-exec-permission.js";
import { buildSystemRunPreparePayload } from "../test-utils/system-run-prepare-payload.js";
import {
  operatorElevatedFullBreakGlass,
  resolveHostAsk,
  resolveRuntimeAskSource,
  resolveApprovalDecisionOrUndefined,
} from "./bash-tools.exec-host-shared.js";

vi.mock("./tools/gateway.js", () => ({
  callGatewayTool: vi.fn(),
  readGatewayCallOptions: vi.fn(() => ({})),
}));

describe("approval failure notification ownership", () => {
  it("waits for notification before settling the decision", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    vi.mocked(callGatewayTool).mockRejectedValueOnce(new Error("gateway closed"));
    let release!: () => void;
    const notification = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settled = false;
    const result = resolveApprovalDecisionOrUndefined({
      approvalId: "failed-approval",
      preResolvedDecision: undefined,
      onFailure: () => notification,
    }).then((value) => {
      settled = true;
      return value;
    });
    await vi.waitFor(() => expect(callGatewayTool).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    await expect(result).resolves.toBeUndefined();
  });
  it("contains notification rejection without authorizing execution", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    vi.mocked(callGatewayTool).mockRejectedValueOnce(new Error("gateway closed"));
    await expect(
      resolveApprovalDecisionOrUndefined({
        approvalId: "failed-approval",
        preResolvedDecision: undefined,
        onFailure: async () => {
          throw new Error("notification gateway closed");
        },
      }),
    ).resolves.toBeUndefined();
  });
});

vi.mock("./tools/nodes-utils.js", () => ({
  listNodes: vi.fn(async () => [
    {
      nodeId: "node-1",
      displayName: "Studio-Mac.local",
      commands: ["system.run"],
      platform: "darwin",
    },
  ]),
}));

describe("approvals ask=off break-glass", () => {
  it("lets an operator approvals file suppress a stricter runtime ask", () => {
    expect(
      resolveHostAsk({ runtimeAsk: "on-miss", approvalsAsk: "off", runtimeAskSource: "operator" }),
    ).toBe("off");
  });

  it("blocks seat and session from triggering the approvals-file bypass", () => {
    expect(resolveRuntimeAskSource({ seatAsk: "always" })).toBe("seat");
    expect(resolveRuntimeAskSource({ sessionAsk: "always", seatAsk: "on-miss" })).toBe("session");
    expect(
      resolveHostAsk({ runtimeAsk: "always", approvalsAsk: "off", runtimeAskSource: "seat" }),
    ).toBe("always");
    expect(
      resolveHostAsk({ runtimeAsk: "always", approvalsAsk: "off", runtimeAskSource: "session" }),
    ).toBe("always");
  });

  it("keeps elevated full unreachable from seat and session sources", () => {
    expect(
      operatorElevatedFullBreakGlass({
        source: "operator",
        elevatedRequested: true,
        elevatedMode: "full",
      }),
    ).toBe(true);
    expect(
      operatorElevatedFullBreakGlass({
        source: "seat",
        elevatedRequested: true,
        elevatedMode: "full",
      }),
    ).toBe(false);
    expect(
      operatorElevatedFullBreakGlass({
        source: "session",
        elevatedRequested: true,
        elevatedMode: "full",
      }),
    ).toBe(false);
  });
});

describe("desktop save may request the paired computer", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("raises the node card when the configured host is not node", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const { createExecTool } = await import("./bash-tools.exec.js");
    const command = buildDesktopSaveExecCommand({ fileName: "notes.txt", content: "hi" });
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        return { status: "accepted", id: (params as { id?: string })?.id };
      }
      if (method === "exec.approval.waitDecision") {
        return { decision: "allow-once" };
      }
      if (method === "node.invoke") {
        const invoke = params as {
          command?: string;
          params?: { command?: unknown; rawCommand?: unknown };
        };
        if (invoke.command === "system.run.prepare") {
          return buildSystemRunPreparePayload({
            command: invoke.params?.command,
            rawCommand: invoke.params?.rawCommand ?? command,
          });
        }
        if (invoke.command === "system.run") {
          return { payload: { success: true, stdout: "" } };
        }
      }
      return { ok: true };
    });

    const tool = createExecTool({
      host: "gateway",
      ask: "always",
      security: "allowlist",
      approvalRunningNoticeMs: 0,
      sessionKey: "agent:main:main",
      workspaceOnly: true,
      workspaceRoot: "/workspace",
      cwd: "/tmp",
    });
    const result = await tool.execute("desk", { command, host: "node" });
    expect(result.details.status).toBe("approval-pending");
    await expect(
      tool.execute("other", { command: "touch /Users/daniel/Desktop/x.txt", host: "node" }),
    ).rejects.toThrow(/exec host not allowed/);
  });

  it("raises the permission card for a Desktop probe without a pre-bound seat node", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const { createExecTool } = await import("./bash-tools.exec.js");
    const command = 'ls -d "$HOME/Desktop"';
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        return { status: "accepted", id: (params as { id?: string })?.id };
      }
      if (method === "exec.approval.waitDecision") {
        return { decision: "allow-once" };
      }
      if (method === "node.invoke") {
        const invoke = params as {
          command?: string;
          params?: { command?: unknown; rawCommand?: unknown };
        };
        if (invoke.command === "system.run.prepare") {
          return buildSystemRunPreparePayload({
            command: invoke.params?.command,
            rawCommand: invoke.params?.rawCommand ?? command,
          });
        }
        if (invoke.command === "system.run") {
          return { payload: { success: true, stdout: "" } };
        }
      }
      return { ok: true };
    });
    const tool = createExecTool({
      host: "sandbox",
      ask: "always",
      security: "allowlist",
      approvalRunningNoticeMs: 0,
      sessionKey: "agent:field-bot:main",
    });
    const result = await tool.execute("probe", { command, host: "node" });
    expect(result.details.status).toBe("approval-pending");
    await expect(tool.execute("mail", { command: "which mail sendmail mutt" })).rejects.toThrow(
      /user_operational_identity/,
    );
  });

  it("allows the Desktop probe on the bound node for any operator-seat bot", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const { createExecTool } = await import("./bash-tools.exec.js");
    const command = 'ls -d "$HOME/Desktop"';
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        return { status: "accepted", id: (params as { id?: string })?.id };
      }
      if (method === "exec.approval.waitDecision") {
        return { decision: "allow-once" };
      }
      if (method === "node.invoke") {
        const invoke = params as {
          nodeId?: string;
          command?: string;
          params?: { command?: unknown; rawCommand?: unknown };
        };
        expect(invoke.nodeId).toBe("node-1");
        if (invoke.command === "system.run.prepare") {
          return buildSystemRunPreparePayload({
            command: invoke.params?.command,
            rawCommand: invoke.params?.rawCommand ?? command,
          });
        }
        if (invoke.command === "system.run") {
          return { payload: { success: true, stdout: "" } };
        }
      }
      return { ok: true };
    });
    const tool = createExecTool({
      host: "sandbox",
      ask: "always",
      security: "allowlist",
      approvalRunningNoticeMs: 0,
      operatorComputerNodeId: "node-1",
      sessionKey: "agent:bot-skill:main",
    });
    const result = await tool.execute("probe", { command, host: "node", node: "other-mac" });
    expect(result.details.status).toBe("approval-pending");
    await expect(tool.execute("shell", { command: "id", host: "node" })).rejects.toThrow(
      /exec host not allowed/,
    );
  });

  it("skips the Desktop card after Always Allow for the bound seat computer", async () => {
    const { callGatewayTool } = await import("./tools/gateway.js");
    const { createExecTool } = await import("./bash-tools.exec.js");
    const command = 'ls -d "$HOME/Desktop"';
    vi.mocked(callGatewayTool).mockImplementation(async (method, _opts, params) => {
      if (method === "exec.approval.request") {
        throw new Error("approval card must not appear after Always Allow");
      }
      if (method === "node.invoke") {
        const invoke = params as {
          nodeId?: string;
          command?: string;
          params?: { command?: unknown; rawCommand?: unknown };
        };
        expect(invoke.nodeId).toBe("node-1");
        if (invoke.command === "system.run.prepare") {
          return buildSystemRunPreparePayload({
            command: invoke.params?.command,
            rawCommand: invoke.params?.rawCommand ?? command,
          });
        }
        if (invoke.command === "system.run") {
          return { payload: { success: true, stdout: "/Users/ada/Desktop\n" } };
        }
      }
      return { ok: true };
    });
    const tool = createExecTool({
      host: "sandbox",
      ask: "always",
      security: "allowlist",
      approvalRunningNoticeMs: 0,
      operatorComputerNodeId: "node-1",
      operatorComputerAlwaysAllowDesktop: true,
      sessionKey: "agent:bot-skill:main",
    });
    const result = await tool.execute("probe", { command, host: "node" });
    expect(result.details.status).toBe("completed");
  });
});
