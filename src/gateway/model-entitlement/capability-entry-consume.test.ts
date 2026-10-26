// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  consumeCapabilityRoutingResult,
  formatCapabilityExecutionSurfaceLog,
} from "./capability-entry-consume.js";
import {
  buildTaskCapabilityPlan,
  resolveExecutionRoutingFromCapabilityPlan,
} from "./task-capability-plan.js";

/**
 * Entry-level contract shared by chat / followup / cron / subagent:
 * outcomeClaim must be consumed into a structured surface that distinguishes
 * "text returned allowed" from "image/music generation completed".
 */
describe("consumeCapabilityRoutingResult (four-entry surface)", () => {
  it("executor_unwired image: textReturnedAllowed=true, targetModalityCompleted=false", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "画一张产品海报",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const routing = resolveExecutionRoutingFromCapabilityPlan({ capabilityPlan: plan });
    const consumed = consumeCapabilityRoutingResult({
      planFailure: routing.planFailure,
      outcomeClaim: routing.outcomeClaim,
      executionSurface: routing.executionSurface,
      capabilityPlan: plan,
    });
    expect(consumed.executionSurface.status).toBe("executor_unwired");
    expect(consumed.executionSurface.textReturnedAllowed).toBe(true);
    expect(consumed.executionSurface.targetModalityCompleted).toBe(false);
    expect(consumed.executionSurface.incompleteModalities).toContain("image_generation");
    expect(consumed.capabilityOutcome).toBeDefined();
    expect(consumed.capabilityOutcome?.textReturnedAllowed).toBe(true);
    expect(consumed.capabilityOutcome?.targetModalityCompleted).toBe(false);
    expect(consumed.capabilityOutcome?.status).toBe("executor_unwired");
    // Must not be string-only: structured fields are assertable booleans.
    expect(typeof consumed.capabilityOutcome?.textReturnedAllowed).toBe("boolean");
    expect(typeof consumed.capabilityOutcome?.targetModalityCompleted).toBe("boolean");
  });

  it("executor_unwired music: same structured distinction", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "写一段配乐",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const routing = resolveExecutionRoutingFromCapabilityPlan({ capabilityPlan: plan });
    const consumed = consumeCapabilityRoutingResult(routing);
    expect(consumed.executionSurface.targetModalityCompleted).toBe(false);
    expect(consumed.executionSurface.textReturnedAllowed).toBe(true);
    expect(consumed.executionSurface.incompleteModalities).toContain("audio_music_generation");
  });

  it("ok chat path: both text and target modality complete", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "summarize this note",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const routing = resolveExecutionRoutingFromCapabilityPlan({ capabilityPlan: plan });
    const consumed = consumeCapabilityRoutingResult(routing);
    expect(consumed.executionSurface.status).toBe("ok");
    expect(consumed.executionSurface.textReturnedAllowed).toBe(true);
    expect(consumed.executionSurface.targetModalityCompleted).toBe(true);
    expect(consumed.executionSurface.incompleteModalities).toEqual([]);
  });

  it("format log is machine-readable without claiming modality success", () => {
    const plan = buildTaskCapabilityPlan({
      taskText: "generate an illustration poster",
      authorizedModelIds: ["openai/gpt-5.4"],
    });
    const routing = resolveExecutionRoutingFromCapabilityPlan({ capabilityPlan: plan });
    const consumed = consumeCapabilityRoutingResult(routing);
    const line = formatCapabilityExecutionSurfaceLog(consumed.executionSurface);
    expect(line).toContain("status=executor_unwired");
    expect(line).toContain("textReturnedAllowed=true");
    expect(line).toContain("targetModalityCompleted=false");
  });
});
