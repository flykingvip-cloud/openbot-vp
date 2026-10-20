import { describe, expect, it } from "vitest";
import {
  EXECUTION_STAGES,
  PHASE1_FLAGS,
  createExecutionObserver,
  decideShadowRoute,
  digestName,
  parseShadowTaskEnvelope,
  projectShadowEvent,
  projectToolkitReceipt,
  recordShadowRouteBestEffort,
} from "./index.js";

describe("@openbot/toolkit package", () => {
  it("exports Phase 2 surface", async () => {
    const mod = await import("./index.js");
    expect(mod.TOOLKIT_VERSION).toBe("0.2.0");
    expect(mod.TOOLKIT_PHASE).toBe(2);
    expect(typeof mod.ToolRegistry).toBe("function");
    expect(typeof mod.startReceipt).toBe("function");
    expect(typeof mod.completeReceipt).toBe("function");
    expect(typeof mod.failReceipt).toBe("function");
    expect(typeof mod.evaluatePolicy).toBe("function");
    expect(typeof mod.loadExamplePolicy).toBe("function");
    expect(typeof mod.executeGated).toBe("function");
    expect(typeof mod.createMockApprovalChannel).toBe("function");
    expect(typeof mod.inferPolicyFactsFromGatewayTool).toBe("function");
  });

  it("exposes execution-router API on the package root", () => {
    expect(typeof createExecutionObserver).toBe("function");
    expect(typeof projectToolkitReceipt).toBe("function");
    expect(EXECUTION_STAGES).toEqual(
      expect.arrayContaining(["inbound_accepted", "system_prompt_ready", "run_completed"]),
    );
    const observer = createExecutionObserver({ runId: "from-package-root" });
    expect(observer.enabled).toBe(false);
    observer.markStage("inbound_accepted");
    expect(observer.snapshot()).toBeNull();
  });

  it("runs envelope → decision → event from the package root", () => {
    expect(PHASE1_FLAGS).toEqual({
      SKILL_TOP_K_ENABLED: false,
      TOOL_TOP_K_ENABLED: false,
      SHADOW_ROUTER_RECORD: false,
      SHADOW_ROUTER_APPLY: false,
      DAG_ENABLED: false,
      CONVERSATION_TASK_ENABLED: false,
      ORCHESTRATION_LIVE_INVOKE: false,
    });
    const skillName = "clock-kind-lookup";
    const toolName = "read_clock_kind";
    const envelope = parseShadowTaskEnvelope({
      schema: "openbot.execution-router.task-envelope.v1",
      taskClass: "skill_dense_readonly",
      riskClass: "read_only",
      channelKind: "internal",
      textDigest: digestName("text", "package-root e2e"),
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
      runIdDigest: digestName("run", "package-root-e2e"),
    });
    expect(event.apply).toBe(false);
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain(skillName);
    expect(serialized).not.toContain(toolName);
    expect(event.skillCandidates.every((row) => /^[0-9a-f]{16}$/.test(row.nameDigest))).toBe(true);
    expect(event.toolCandidates.every((row) => /^[0-9a-f]{16}$/.test(row.nameDigest))).toBe(true);
  });

  it("exposes default-off I2 shadow-record from the package root", () => {
    expect(typeof recordShadowRouteBestEffort).toBe("function");
    expect(
      recordShadowRouteBestEffort({
        envelope: {
          schema: "openbot.execution-router.task-envelope.v1",
          taskClass: "unknown",
          riskClass: "unknown",
          channelKind: "unknown",
          textDigest: digestName("text", "i2 package-root"),
        },
        eligibleSkills: [],
        constructedTools: [],
        runIdDigest: digestName("run", "i2-package-root"),
      }),
    ).toEqual({ recorded: false, reason: "flag_off" });
  });
});
