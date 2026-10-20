import {
  EXECUTION_STAGES,
  PHASE1_FLAGS,
  createExecutionObserver,
  createTaskEnvelope,
  decideShadowRoute,
  digestName,
  parseShadowTaskEnvelope,
  projectShadowEvent,
  projectToolkitReceipt,
  recordShadowRouteBestEffort,
} from "@openbot/toolkit";
import { describe, expect, it } from "vitest";
import { startReceipt } from "../receipt.js";

describe("@openbot/toolkit root entry", () => {
  it("lets consumers import execution-router from the package root", () => {
    expect(EXECUTION_STAGES).toContain("skill_snapshot_ready");
    const envelope = createTaskEnvelope({ runId: "consumer-run" });
    expect(envelope.runId).toBe("consumer-run");
    const observer = createExecutionObserver({ runId: "consumer-run" });
    expect(observer.enabled).toBe(false);
    const projected = projectToolkitReceipt(
      startReceipt({
        toolId: "read",
        operation: "read",
        receiptId: "rcpt-consumer",
        startedAt: "2026-09-06T00:00:00.000Z",
        validate: false,
      }),
    );
    expect(projected.receiptId).toBe("rcpt-consumer");
    expect(projected).not.toHaveProperty("evidence");
  });

  it("consumes Shadow Router I1 from @openbot/toolkit", () => {
    expect(PHASE1_FLAGS.SKILL_TOP_K_ENABLED).toBe(false);
    expect(PHASE1_FLAGS.TOOL_TOP_K_ENABLED).toBe(false);
    expect(PHASE1_FLAGS.SHADOW_ROUTER_RECORD).toBe(false);
    expect(PHASE1_FLAGS.SHADOW_ROUTER_APPLY).toBe(false);
    expect(PHASE1_FLAGS.DAG_ENABLED).toBe(false);
    expect(PHASE1_FLAGS.CONVERSATION_TASK_ENABLED).toBe(false);
    expect(PHASE1_FLAGS.ORCHESTRATION_LIVE_INVOKE).toBe(false);
    const skillName = "clock-kind-lookup";
    const toolName = "read_clock_kind";
    const envelope = parseShadowTaskEnvelope({
      schema: "openbot.execution-router.task-envelope.v1",
      taskClass: "skill_dense_readonly",
      riskClass: "read_only",
      channelKind: "internal",
      textDigest: digestName("text", "consumer e2e"),
      tagDigests: [digestName("tag", "readonly")],
    });
    const decision = decideShadowRoute({
      envelope,
      eligibleSkills: [
        {
          nameDigest: digestName("skill", skillName),
          tagDigests: [digestName("tag", "readonly")],
          sideEffect: false,
        },
        { nameDigest: digestName("skill", "publisher"), tagDigests: [], sideEffect: true },
      ],
      constructedTools: [
        {
          nameDigest: digestName("tool", toolName),
          tagDigests: [digestName("tag", "readonly")],
          sideEffect: false,
        },
        { nameDigest: digestName("tool", "sessions_send"), tagDigests: [], sideEffect: true },
      ],
    });
    expect(decision.apply).toBe(false);
    const event = projectShadowEvent({
      decision,
      runIdDigest: digestName("run", "consumer-e2e"),
    });
    expect(event.apply).toBe(false);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(skillName);
    expect(serialized).not.toContain(toolName);
    expect(event.skillCandidates.every((row) => /^[0-9a-f]{16}$/.test(row.nameDigest))).toBe(true);
  });

  it("consumes default-off Shadow Router I2 record from @openbot/toolkit", () => {
    const result = recordShadowRouteBestEffort({
      envelope: {
        schema: "openbot.execution-router.task-envelope.v1",
        taskClass: "unknown",
        riskClass: "unknown",
        channelKind: "unknown",
        textDigest: digestName("text", "i2 root"),
      },
      eligibleSkills: [],
      constructedTools: [],
      runIdDigest: digestName("run", "i2-root"),
    });
    expect(result).toEqual({ recorded: false, reason: "flag_off" });
    expect(PHASE1_FLAGS.SHADOW_ROUTER_RECORD).toBe(false);
  });
});
