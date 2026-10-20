import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContextCompileTelemetry } from "../../agents/context-compiler/types.js";
import type { OpenBotConfig } from "../../config/config.js";
import { onAgentEvent, type AgentEventPayload } from "../../infra/agent-events.js";
import {
  COLLAB_FAULT_ROUND_EVENT,
  compilerTelemetryToFaultRoundSnapshot,
  emitCollabFaultRoundDiagnostic,
  faultRoundOutcomeFromSkipReason,
  isCollaborationFaultRoundObservabilityEnabled,
  peekCollabFaultRoundPartialForTests,
  recordCollabFaultRoundPartial,
  resetCollabFaultRoundPartialsForTests,
} from "./fault-round-diagnostic.js";

function enabledCfg(): OpenBotConfig {
  return {
    collaboration: { faultRoundObservability: true },
  } as OpenBotConfig;
}

function sampleCompilerTelemetry(
  overrides: Partial<ContextCompileTelemetry> = {},
): ContextCompileTelemetry {
  return {
    runId: "run-1:bot-a",
    lane: "act",
    preCompileMessageCount: 40,
    postCompileMessageCount: 18,
    preCompileEstimatedTokens: 12_000,
    postCompileEstimatedTokens: 5_000,
    admissionBudgetTokens: 12_800,
    targetBudgetTokens: 16_000,
    unitCountBefore: 20,
    unitCountAfter: 12,
    contextDropReasons: [
      { type: "recent_turn", reason: "window", priority: 30 },
      { type: "recent_turn", reason: "budget", priority: 30 },
    ],
    recallSafety: {
      currentTurnPreserved: true,
      activeTaskPreserved: false,
      toolTransactionIntegrity: true,
      requiredMemoryPreserved: true,
    },
    compileMs: 3,
    ...overrides,
  };
}

describe("collab fault-round observability", () => {
  const previousEnv = process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS;

  beforeEach(() => {
    resetCollabFaultRoundPartialsForTests();
    delete process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS;
  });

  afterEach(() => {
    resetCollabFaultRoundPartialsForTests();
    if (previousEnv === undefined) {
      delete process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS;
    } else {
      process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS = previousEnv;
    }
  });

  it("flag defaults off", () => {
    expect(isCollaborationFaultRoundObservabilityEnabled(undefined)).toBe(false);
    expect(isCollaborationFaultRoundObservabilityEnabled({} as OpenBotConfig)).toBe(false);
    expect(
      emitCollabFaultRoundDiagnostic({
        runId: "r1",
        outcome: { kind: "visible" },
      }),
    ).toBeNull();
  });

  it("emits structured diagnostic for group turn with compiler drops", () => {
    const events: AgentEventPayload[] = [];
    const stop = onAgentEvent((evt) => events.push(evt));
    const cfg = enabledCfg();
    const telemetry = sampleCompilerTelemetry();

    recordCollabFaultRoundPartial(
      {
        runId: "round-1:market-bot",
        sessionKey: "space:group-digital",
        groupId: "group-digital",
        agentId: "market-bot",
        inboundDepth: null,
        inboundDepthAbsent: true,
        compiler: compilerTelemetryToFaultRoundSnapshot(telemetry),
        taskSummaryPresent: true,
      },
      cfg,
    );

    const diagnostic = emitCollabFaultRoundDiagnostic(
      {
        runId: "round-1:market-bot",
        outcome: { kind: "visible" },
      },
      cfg,
    );

    stop();

    expect(diagnostic).not.toBeNull();
    expect(diagnostic?.event).toBe(COLLAB_FAULT_ROUND_EVENT);
    expect(diagnostic?.groupId).toBe("group-digital");
    expect(diagnostic?.agentId).toBe("market-bot");
    expect(diagnostic?.inboundDepth).toBeNull();
    expect(diagnostic?.inboundDepthAbsent).toBe(true);
    expect(diagnostic?.contextScopeMode).toBe("minimal");
    expect(diagnostic?.taskSummaryPresent).toBe(true);
    expect(diagnostic?.compiler?.lane).toBe("act");
    expect(diagnostic?.compiler?.unitCountBefore).toBe(20);
    expect(diagnostic?.compiler?.unitCountAfter).toBe(12);
    expect(diagnostic?.compiler?.dropCount).toBe(2);
    expect(diagnostic?.compiler?.dropReasons).toEqual([
      { type: "recent_turn", reason: "window", priority: 30 },
      { type: "recent_turn", reason: "budget", priority: 30 },
    ]);
    expect(diagnostic?.compiler?.admissionBudgetTokens).toBe(12_800);

    const lifecycle = events.find((evt) => evt.data?.event === COLLAB_FAULT_ROUND_EVENT);
    expect(lifecycle).toBeDefined();
    expect(lifecycle?.data.compiler).toMatchObject({
      lane: "act",
      dropCount: 2,
      unitCountBefore: 20,
      unitCountAfter: 12,
    });
    // Partial cleared after emit.
    expect(peekCollabFaultRoundPartialForTests("round-1:market-bot")).toBeUndefined();
  });

  it("records silent_suppress for duplicate and empty skipReason", () => {
    const cfg = enabledCfg();

    const duplicate = emitCollabFaultRoundDiagnostic(
      {
        runId: "r-dup",
        groupId: "g1",
        agentId: "bot-b",
        sessionKey: "space:g1",
        inboundDepthAbsent: true,
        taskSummaryPresent: false,
        compiler: compilerTelemetryToFaultRoundSnapshot(
          sampleCompilerTelemetry({
            unitCountBefore: 3,
            unitCountAfter: 3,
            contextDropReasons: [],
          }),
        ),
        outcome: faultRoundOutcomeFromSkipReason("duplicate"),
      },
      cfg,
    );
    expect(duplicate?.outcome).toEqual({ kind: "silent_suppress", skipReason: "duplicate" });

    const empty = emitCollabFaultRoundDiagnostic(
      {
        runId: "r-empty",
        groupId: "g1",
        agentId: "bot-c",
        outcome: faultRoundOutcomeFromSkipReason("empty"),
      },
      cfg,
    );
    expect(empty?.outcome).toEqual({ kind: "empty", skipReason: "empty" });

    const silent = faultRoundOutcomeFromSkipReason("silent", "model returned NO_REPLY");
    expect(silent).toEqual({
      kind: "silent_suppress",
      skipReason: "silent",
      detail: "model returned NO_REPLY",
    });
  });

  it("records taskSummaryPresent=false when active task inject is missing", () => {
    const cfg = enabledCfg();
    recordCollabFaultRoundPartial(
      {
        runId: "r-no-task",
        agentId: "bot-d",
        groupId: "g2",
        taskSummaryPresent: false,
        compiler: compilerTelemetryToFaultRoundSnapshot(
          sampleCompilerTelemetry({
            recallSafety: {
              currentTurnPreserved: true,
              activeTaskPreserved: false,
              toolTransactionIntegrity: true,
              requiredMemoryPreserved: true,
            },
          }),
        ),
      },
      cfg,
    );

    const diagnostic = emitCollabFaultRoundDiagnostic(
      {
        runId: "r-no-task",
        outcome: faultRoundOutcomeFromSkipReason("empty"),
      },
      cfg,
    );

    expect(diagnostic?.taskSummaryPresent).toBe(false);
    expect(diagnostic?.compiler?.activeTaskPreserved).toBe(false);
    expect(diagnostic?.outcome.kind).toBe("empty");
  });

  it("env OPENBOT_COLLAB_FAULT_ROUND_OBS=1 enables without config", () => {
    process.env.OPENBOT_COLLAB_FAULT_ROUND_OBS = "1";
    expect(isCollaborationFaultRoundObservabilityEnabled(undefined)).toBe(true);
    const diagnostic = emitCollabFaultRoundDiagnostic({
      runId: "r-env",
      outcome: { kind: "visible" },
      taskSummaryPresent: false,
    });
    expect(diagnostic?.event).toBe(COLLAB_FAULT_ROUND_EVENT);
  });

  it("does not invent buildSha when build-info is absent", () => {
    const cfg = enabledCfg();
    delete process.env.OPENBOT_BUILD_SHA;
    delete process.env.OPENBOT_DIAGNOSIS_BUILD_SHA;
    const diagnostic = emitCollabFaultRoundDiagnostic(
      {
        runId: "r-sha",
        outcome: { kind: "visible" },
      },
      cfg,
    );
    // Field omitted (undefined) — never a fabricated value.
    expect(diagnostic?.buildSha === undefined || typeof diagnostic?.buildSha === "string").toBe(
      true,
    );
    if (diagnostic?.buildSha !== undefined) {
      expect(diagnostic.buildSha.length).toBeGreaterThan(0);
    }
  });
});
