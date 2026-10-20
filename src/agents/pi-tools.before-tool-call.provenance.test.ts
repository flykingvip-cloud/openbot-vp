import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGlobalHookRunner } from "../plugins/hook-runner-global.js";
import { wrapToolWithBeforeToolCallHook } from "./pi-tools.before-tool-call.js";
import type { AnyAgentTool } from "./tools/common.js";

vi.mock("../plugins/hook-runner-global.js");

const mockGetGlobalHookRunner = vi.mocked(getGlobalHookRunner);

describe("before_tool_call tool-selection provenance", () => {
  beforeEach(() => {
    mockGetGlobalHookRunner.mockReturnValue({
      hasHooks: vi.fn().mockReturnValue(false),
      runBeforeToolCall: vi.fn(),
    } as never);
  });

  it("does not invent a tool call until the existing execute path runs", () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { ok: true },
    });
    wrapToolWithBeforeToolCallHook({ name: "session_status", execute } as unknown as AnyAgentTool, {
      sessionKey: "agent:main:main",
      candidateCapabilities: ["session_status", "read"],
      policyFilteredCapabilities: ["session_status"],
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it("attributes an executed tool call to the model without inventing a reason", async () => {
    const execute = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
      details: { ok: true },
    });
    const tool = wrapToolWithBeforeToolCallHook(
      { name: "session_status", execute } as unknown as AnyAgentTool,
      {
        sessionKey: "agent:main:main",
        sessionId: "sess-1",
        runId: "run-1",
        candidateCapabilities: ["session_status", "read", "write"],
        policyFilteredCapabilities: ["session_status", "read"],
      },
    );

    const result = await tool.execute("call-1", {});

    expect(execute).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      content: [{ type: "text", text: "ok" }],
      details: {
        ok: true,
        executionChainProvenance: [
          {
            kind: "tool_selection",
            decision_owner: "model",
            decision_source: "model_tool_call",
            decision: { capability: "session_status", reason: "unknown" },
            candidate_capabilities: ["session_status", "read", "write"],
            policy_filtered_capabilities: ["session_status", "read"],
            selected_capability: "session_status",
            policy_result: "allowed",
            execution_allowed: true,
            execution_started: true,
            session_key: "agent:main:main",
            session_id: "sess-1",
            run_id: "run-1",
            tool_call_id: "call-1",
          },
        ],
      },
    });
  });

  it("keeps policy-filtered names separate from model selection", async () => {
    const execute = vi.fn().mockResolvedValue({ content: [], details: {} });
    const tool = wrapToolWithBeforeToolCallHook(
      { name: "read", execute } as unknown as AnyAgentTool,
      {
        candidateCapabilities: ["read", "write", "exec"],
        policyFilteredCapabilities: ["read", "exec"],
      },
    );
    const result = (await tool.execute("call-read", { path: "README.md" })) as {
      details?: { executionChainProvenance?: Array<Record<string, unknown>> };
    };
    const record = result.details?.executionChainProvenance?.[0];
    expect(record?.candidate_capabilities).toEqual(["read", "write", "exec"]);
    expect(record?.policy_filtered_capabilities).toEqual(["read", "exec"]);
    expect(record?.selected_capability).toBe("read");
    expect(record?.decision_owner).toBe("model");
    expect(record?.candidate_capabilities).not.toEqual(record?.policy_filtered_capabilities);
  });
});
