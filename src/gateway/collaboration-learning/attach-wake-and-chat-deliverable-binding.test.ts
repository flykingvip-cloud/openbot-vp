import { describe, expect, it } from "vitest";
import { boundedOutcomePathSegment } from "../../task-outcome/store.js";
import {
  buildExecutionDeliverableBinding,
  normalizeExecutionDeliverableBinding,
  runIdFromWakeOpAttempt,
} from "./execution-deliverable-binding.js";

describe("execution deliverable binding helpers (auto-continue PR)", () => {
  it("builds a complete wake_dispatch binding from durable op+attempt", () => {
    const opKey = "wake:grp:task:item:nudge:1";
    const attemptId = "attempt-abc";
    const runId = runIdFromWakeOpAttempt({ opKey, attemptId });
    const binding = buildExecutionDeliverableBinding({
      tenantId: "ten_demo",
      groupId: "grp-demo",
      taskId: "task-m1",
      boardItemId: "item-m1",
      todolistId: "todo-1",
      planVersion: 2,
      stepId: "step-1",
      runId,
      attemptId,
      opKey,
      agentId: "bot--agent",
      source: "wake_dispatch",
    });
    expect(binding).not.toBeNull();
    expect(normalizeExecutionDeliverableBinding(binding)).toEqual(binding);
    expect(binding!.runId).toBe(`wake_run:${opKey}:${attemptId}`);
  });

  it("builds explicit_run binding for chat actor without wake fields", () => {
    const binding = buildExecutionDeliverableBinding({
      tenantId: null,
      groupId: "grp-demo",
      taskId: "task-m2",
      boardItemId: "item-m2",
      runId: "client-run:bot--agent",
      agentId: "bot--agent",
      source: "explicit_run",
    });
    expect(binding).not.toBeNull();
    expect(binding!.source).toBe("explicit_run");
    // wake_dispatch-only fields are optional for explicit_run
    expect(binding!.todolistId).toBeNull();
    expect(binding!.attemptId).toBeNull();
  });

  it("refuses incomplete wake_dispatch binding (missing attempt/op)", () => {
    const incomplete = normalizeExecutionDeliverableBinding({
      groupId: "grp",
      taskId: "t",
      boardItemId: "i",
      runId: "r",
      todolistId: "todo",
      planVersion: 1,
      stepId: "s",
      agentId: "a",
      source: "wake_dispatch",
      // attemptId / opKey omitted
    });
    expect(incomplete).toBeNull();
  });

  it("hashes CJK space-like segments for outcomes paths", () => {
    const id = `space:grp-flykingvip-gmail-com-${"研发小组".repeat(30)}`;
    expect(encodeURIComponent(id).length).toBeGreaterThan(160);
    const seg = boundedOutcomePathSegment(id);
    expect(seg.startsWith("h-")).toBe(true);
    expect(seg.length).toBe(2 + 64);
  });
});

describe("maybeContinueAfterRoundComplete forceForDeliverableSettlement", () => {
  it("exports scheduleContinueAfterDeliverableSettlement", async () => {
    const mod = await import("./schedule-continue-after-deliverable.js");
    expect(typeof mod.scheduleContinueAfterDeliverableSettlement).toBe("function");
  });

  it("exports attachWakeExecutionDeliverableBinding", async () => {
    const mod = await import("./attach-wake-execution-deliverable-binding.js");
    expect(typeof mod.attachWakeExecutionDeliverableBinding).toBe("function");
  });

  it("exports tryBuildChatActorExecutionDeliverableBinding", async () => {
    const mod = await import("./try-build-chat-actor-deliverable-binding.js");
    expect(typeof mod.tryBuildChatActorExecutionDeliverableBinding).toBe("function");
  });
});
