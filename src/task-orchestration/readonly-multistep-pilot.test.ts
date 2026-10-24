import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createOrchLeaseStore } from "./lease-store.js";
import { clearReadonlyPathBindingsForTests, bindReadonlyPilotAction } from "./path-binding.js";
import {
  READONLY_MULTISTEP_PILOT_ID,
  buildJobStepId,
  buildLogicalActionId,
  buildReadonlyMultistepPlan,
  buildResultRef,
  evaluateReadonlyMultistepAcceptance,
  runReadonlyMultistepPilot,
  type ReadonlyMultistepInvokeFn,
  type ReadonlyMultistepStepResult,
} from "./readonly-multistep-pilot.js";
import { ORCHESTRATION_LIVE_INVOKE } from "./types.js";

const mockInvoke: ReadonlyMultistepInvokeFn = async ({ step }) => {
  if (step.stepKind === "memory") {
    return {
      invokedTool: true,
      untrustedText: "memory-hit",
      wroteLedger: false,
      surface: "memory",
      toolName: "memory_search",
    };
  }
  if (step.stepKind === "web_read") {
    return {
      invokedTool: true,
      untrustedText: "fetched-page",
      wroteLedger: false,
      surface: "web_read",
      toolName: "web_fetch",
    };
  }
  return {
    invokedTool: false,
    wroteLedger: false,
    reason: "acceptance_is_not_a_tool",
  };
};

describe("WP-06 readonly multi-step pilot", () => {
  beforeEach(() => {
    clearReadonlyPathBindingsForTests();
  });

  afterEach(() => {
    clearReadonlyPathBindingsForTests();
  });

  it("keeps ORCHESTRATION_LIVE_INVOKE frozen false", () => {
    expect(ORCHESTRATION_LIVE_INVOKE).toBe(false);
  });

  it("builds a fixed memory → web_read → acceptance plan with ADR naming", () => {
    const plan = buildReadonlyMultistepPlan({ taskId: "t1", tenantId: "ten-a" });
    expect(plan.pilotId).toBe(READONLY_MULTISTEP_PILOT_ID);
    expect(plan.steps.map((s) => s.stepKind)).toEqual(["memory", "web_read", "acceptance"]);
    expect(plan.steps[0].intent).toBe("recall_memory");
    expect(plan.steps[1].intent).toBe("read_web");
    expect(plan.steps[2].intent).toBeUndefined();

    expect(plan.steps[0].logicalActionId).toBe(buildLogicalActionId("t1", "memory"));
    expect(plan.steps[0].jobStepId).toBe(buildJobStepId("t1", "memory", 1));
    expect(plan.steps[0].leaseKey).toBe(plan.steps[0].jobStepId);
    expect(plan.steps[0].attempt).toBe(1);
    expect(buildResultRef(plan.steps[0].jobStepId, 1)).toBe("orch-ro-result:t1::memory::1:a1");

    expect(plan.steps[1].logicalActionId).toBe("orch.ro.ms.t1.web_read");
    expect(plan.steps[1].jobStepId).toBe("t1::web_read::2");
    expect(plan.steps[2].logicalActionId).toBe("orch.ro.ms.t1.acceptance");
  });

  it("runs mock readonly invokes without network and passes name-level acceptance", async () => {
    const store = createOrchLeaseStore();
    const report = await runReadonlyMultistepPilot({
      taskId: "pilot-task",
      memoryQuery: "what did we decide",
      webQuery: "https://example.com/doc",
      invoke: mockInvoke,
      leaseStore: store,
      nowMs: 1_000,
    });

    expect(report.liveInvokeFrozen).toBe(true);
    expect(report.wroteLedger).toBe(false);
    expect(report.acceptance.ok).toBe(true);
    expect(report.acceptance.wroteLedger).toBe(false);
    expect(report.steps).toHaveLength(3);
    expect(report.steps[0]?.ok).toBe(true);
    expect(report.steps[1]?.ok).toBe(true);
    expect(report.steps[2]?.ok).toBe(true);
    expect(report.steps[0]?.resultRef).toBe("orch-ro-result:pilot-task::memory::1:a1");
    expect(report.steps[1]?.resultRef).toBe("orch-ro-result:pilot-task::web_read::2:a1");
    expect(report.steps.every((s) => !s.wroteLedger)).toBe(true);

    // Lease keys hang on existing OrchLeaseRecord shape (memory store).
    expect(store.get("pilot-task::memory::1")?.resultRef).toBe(
      "orch-ro-result:pilot-task::memory::1:a1",
    );
    expect(store.get("pilot-task::web_read::2")?.resultRef).toBe(
      "orch-ro-result:pilot-task::web_read::2:a1",
    );
  });

  it("fails acceptance when a tool step does not invoke", async () => {
    const invoke: ReadonlyMultistepInvokeFn = async ({ step }) => {
      if (step.stepKind === "memory") {
        return {
          invokedTool: true,
          untrustedText: "ok",
          wroteLedger: false,
          toolName: "memory_search",
        };
      }
      return { invokedTool: false, wroteLedger: false, reason: "web_unavailable" };
    };
    const report = await runReadonlyMultistepPilot({
      taskId: "t-fail",
      memoryQuery: "q",
      webQuery: "q2",
      invoke,
      leaseStore: null,
      bindPath: false,
    });
    expect(report.acceptance.ok).toBe(false);
    expect(report.acceptance.reason).toMatch(/missing_result_ref:web_read|tool_not_invoked/);
    expect(report.wroteLedger).toBe(false);
  });

  it("evaluateReadonlyMultistepAcceptance rejects ledger writes", () => {
    const bad: ReadonlyMultistepStepResult = {
      step: buildReadonlyMultistepPlan({ taskId: "x" }).steps[0],
      resultRef: "orch-ro-result:x::memory::1:a1",
      ok: true,
      wroteLedger: false,
      invokedTool: true,
    };
    // Simulate a corrupted step object that claimed a ledger write.
    const forged = { ...bad, wroteLedger: true as unknown as false };
    const verdict = evaluateReadonlyMultistepAcceptance({
      toolSteps: [forged, { ...bad, step: buildReadonlyMultistepPlan({ taskId: "x" }).steps[1] }],
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toBe("ledger_write_forbidden");
    expect(verdict.wroteLedger).toBe(false);
  });

  it("refuses dual-exec when the same logicalActionId is already bound (WP-05)", async () => {
    const plan = buildReadonlyMultistepPlan({ taskId: "dual" });
    const first = bindReadonlyPilotAction({
      surface: "memory",
      actionId: plan.steps[0].logicalActionId,
    });
    expect(first.ok).toBe(true);

    const report = await runReadonlyMultistepPilot({
      taskId: "dual",
      memoryQuery: "q",
      webQuery: "q2",
      invoke: mockInvoke,
      leaseStore: null,
      bindPath: true,
    });
    expect(report.steps[0]?.ok).toBe(false);
    expect(report.steps[0]?.reason).toBe("dual_exec_refused");
    expect(report.acceptance.ok).toBe(false);
    expect(report.wroteLedger).toBe(false);
  });
});
