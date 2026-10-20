import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as agentEvents from "../../infra/agent-events.js";
import {
  countAlwaysSkillsInPrompt,
  emitExecutionDisciplineObservation,
  isExecutionDisciplineObservationEnabled,
  markFirstToolStarted,
  recordConfirmPrompt,
  resetExecutionDisciplineObservationForTest,
  setExecutionDisciplineObservationForTest,
} from "./observability.js";

describe("execution-discipline observability (P2)", () => {
  beforeEach(() => {
    resetExecutionDisciplineObservationForTest();
    vi.stubEnv("OPENBOT_EXECUTION_DISCIPLINE_OBSERVATION", "");
  });
  afterEach(() => {
    resetExecutionDisciplineObservationForTest();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("defaults OFF", () => {
    expect(isExecutionDisciplineObservationEnabled()).toBe(false);
    expect(markFirstToolStarted({ taskId: "t1", runStartedAtMs: Date.now() - 10 })).toBeUndefined();
  });

  it("emits structured metrics when enabled", () => {
    setExecutionDisciplineObservationForTest({ enabled: true, now: () => 1_000 });
    const spy = vi.spyOn(agentEvents, "emitAgentEvent").mockImplementation(() => undefined);
    const ttft = markFirstToolStarted({ taskId: "t1", runStartedAtMs: 900 });
    expect(ttft).toBe(100);
    expect(markFirstToolStarted({ taskId: "t1", runStartedAtMs: 900 })).toBeUndefined();
    const counts = recordConfirmPrompt({ taskId: "t1", decisionKey: "owner-approve" });
    expect(counts.confirmPromptsPerTask).toBe(1);
    const again = recordConfirmPrompt({ taskId: "t1", decisionKey: "owner-approve" });
    expect(again.sameDecisionReconfirmCount).toBe(1);

    emitExecutionDisciplineObservation({
      runId: "run-1",
      sessionKey: "agent:main:demo",
      taskId: "t1",
      metrics: {
        timeToFirstToolMs: ttft,
        confirmPromptsPerTask: again.confirmPromptsPerTask,
        sameDecisionReconfirmCount: again.sameDecisionReconfirmCount,
        skillsPromptChars: 120,
        alwaysSkillReadCount: 2,
        inboundDepth: "chat",
        inboundDepthMode: "shadow",
      },
    });
    expect(spy).toHaveBeenCalled();
    const payload = spy.mock.calls[0]?.[0] as {
      data: Record<string, unknown>;
    };
    expect(payload.data.event).toBe("execution.discipline_observation");
    expect(payload.data.time_to_first_tool).toBe(100);
    expect(payload.data.skills_prompt_chars).toBe(120);
    expect(payload.data.inbound_depth).toBe("chat");
    expect(payload.data).not.toHaveProperty("text");
  });

  it("counts always skills present in the prompt", () => {
    const prompt = `<skills>\n<skill>\n<name>execution-discipline</name>\n</skill>\n<skill>\n<name>other</name>\n</skill>\n</skills>`;
    expect(countAlwaysSkillsInPrompt(prompt, ["execution-discipline", "missing"])).toBe(1);
    expect(countAlwaysSkillsInPrompt("", ["execution-discipline"])).toBe(0);
  });
});
