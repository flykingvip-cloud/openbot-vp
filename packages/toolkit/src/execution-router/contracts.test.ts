import { describe, expect, it } from "vitest";
import { startReceipt } from "../receipt.js";
import {
  EXECUTION_EVENTS,
  EXECUTION_STAGES,
  ROUTING_REASON_CODES,
  createTaskEnvelope,
  isExecutionStage,
  isRoutingReasonCode,
} from "./contracts.js";

describe("execution-router contracts", () => {
  it("exports required Phase 0 field names and enums", () => {
    expect(EXECUTION_STAGES).toEqual([
      "inbound_accepted",
      "skill_snapshot_ready",
      "tool_set_ready",
      "system_prompt_ready",
      "model_started",
      "first_token",
      "run_completed",
    ]);
    expect(EXECUTION_EVENTS.TASK_ENVELOPE_CREATED).toBe("task_envelope_created");
    expect(EXECUTION_EVENTS.SKILL_CANDIDATES_RETRIEVED).toBe("skill_candidates_retrieved");
    expect(EXECUTION_EVENTS.TOOL_CANDIDATES_RETRIEVED).toBe("tool_candidates_retrieved");
    expect(EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED).toBe("tool_schema_exposed");
    expect(ROUTING_REASON_CODES).toContain("route_observation_only");
  });

  it("creates a TaskEnvelope bound to runId and optional sessionKeyHash", () => {
    const envelope = createTaskEnvelope({
      runId: "run-1",
      sessionKeyHash: "abc123def456",
      nowMs: Date.parse("2026-09-06T00:00:00.000Z"),
    });
    expect(envelope.runId).toBe("run-1");
    expect(envelope.sessionKeyHash).toBe("abc123def456");
    expect(envelope).not.toHaveProperty("sessionKey");
    expect(envelope.createdAt).toBe("2026-09-06T00:00:00.000Z");
  });

  it("reuses toolkit ExecutionReceipt instead of a second receipt shape", () => {
    const receipt = startReceipt({
      toolId: "web_fetch",
      operation: "get",
      receiptId: "rcpt-1",
      startedAt: "2026-09-06T00:00:00.000Z",
    });
    expect(receipt.receiptId).toBe("rcpt-1");
    expect(receipt.toolId).toBe("web_fetch");
    expect(receipt.status).toBe("running");
    expect(receipt).not.toHaveProperty("stages");
    expect(receipt).not.toHaveProperty("skillBaseline");
  });

  it("accepts only known reason codes and stages", () => {
    expect(isRoutingReasonCode("route_tool_policy")).toBe(true);
    expect(isRoutingReasonCode("not_a_reason")).toBe(false);
    expect(isExecutionStage("first_token")).toBe(true);
    expect(isExecutionStage("model_finished")).toBe(false);
  });
});
