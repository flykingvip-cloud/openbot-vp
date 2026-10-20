import { createMockApprovalChannel, loadExamplePolicy } from "@openbot/toolkit";
import { describe, expect, it } from "vitest";
import {
  resolveToolkitPhase2GateMode,
  runGatewayToolkitPhase2Gate,
  setToolkitPhase2PolicyForTests,
} from "./toolkit-phase2-gate.js";

describe("toolkit phase2 gateway gate", () => {
  it("defaults to off (NO LIVE)", () => {
    expect(resolveToolkitPhase2GateMode({})).toBe("off");
    expect(resolveToolkitPhase2GateMode({ OPENBOT_TOOLKIT_PHASE2_GATE: "1" })).toBe("enforce");
  });

  it("pass-through when mode is off", async () => {
    const result = await runGatewayToolkitPhase2Gate({
      toolName: "web_search",
      args: { q: "x" },
      sessionKey: "main",
      mode: "off",
      execute: async () => ({ hits: 1 }),
    });
    expect(result.gated).toBe(false);
  });

  it("allows low-risk web search with receipt when enforcing", async () => {
    setToolkitPhase2PolicyForTests(loadExamplePolicy());
    const result = await runGatewayToolkitPhase2Gate({
      toolName: "web_search",
      args: { q: "openbot" },
      sessionKey: "main",
      mode: "enforce",
      execute: async () => ({ hits: 2 }),
    });
    expect(result.gated).toBe(true);
    if (!result.gated) {
      return;
    }
    expect(result.allowed).toBe(true);
    if (!result.allowed) {
      return;
    }
    expect(result.result).toEqual({ hits: 2 });
    expect(result.receipt.status).toBe("succeeded");
    expect(result.evaluation.decision).toBe("allow");
  });

  it("requires approval for exec and denies without channel", async () => {
    setToolkitPhase2PolicyForTests(loadExamplePolicy());
    let executed = false;
    const result = await runGatewayToolkitPhase2Gate({
      toolName: "exec",
      args: { command: "echo hi" },
      sessionKey: "main",
      mode: "enforce",
      execute: async () => {
        executed = true;
        return { ok: true };
      },
    });
    expect(result.gated).toBe(true);
    if (!result.gated) {
      return;
    }
    expect(result.allowed).toBe(false);
    expect(executed).toBe(false);
    if (result.allowed) {
      return;
    }
    expect(result.receipt.status).toBe("denied");
    expect(result.error.code).toBe("APPROVAL_REQUIRED");
  });

  it("allows exec when approval channel approves", async () => {
    setToolkitPhase2PolicyForTests(loadExamplePolicy());
    const result = await runGatewayToolkitPhase2Gate({
      toolName: "exec",
      args: { command: "echo hi" },
      sessionKey: "main",
      mode: "enforce",
      approval: createMockApprovalChannel({ outcome: "approved" }),
      execute: async () => ({ ok: true }),
    });
    expect(result.gated).toBe(true);
    if (!result.gated) {
      return;
    }
    expect(result.allowed).toBe(true);
    if (!result.allowed) {
      return;
    }
    expect(result.receipt.status).toBe("succeeded");
    expect(result.receipt.approvalId).toBeTruthy();
  });
});
