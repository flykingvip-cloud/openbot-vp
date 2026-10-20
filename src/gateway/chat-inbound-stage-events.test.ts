import { afterEach, describe, expect, it } from "vitest";
import { onAgentEvent, resetAgentRunContextForTest } from "../infra/agent-events.js";
import { resetInboundDepthHarvestForTest } from "./chat-inbound-depth-harvest.js";
import { emitChatInboundStage, hashChatSessionKey } from "./chat-inbound-stage-events.js";
import {
  executionRouterObservationSize,
  peekExecutionRouterObservation,
  resetExecutionRouterObservationForTest,
} from "./execution-router-observation.js";

afterEach(() => {
  resetAgentRunContextForTest();
  resetExecutionRouterObservationForTest();
  resetInboundDepthHarvestForTest();
});

describe("chat inbound stage events", () => {
  it("hashes session keys without emitting the raw key in data", () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    emitChatInboundStage({
      runId: "run-1",
      stage: "user_persisted",
      sessionKey: "agent:main:employee:secret-user",
      extra: { persistMs: 4, hadAttachments: false },
    });
    stop();
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("chat.user_persisted");
    expect(events[0]?.sessionKeyHash).toBe(hashChatSessionKey("agent:main:employee:secret-user"));
    expect(JSON.stringify(events[0])).not.toContain("secret-user");
    expect(events[0]).not.toHaveProperty("message");
    expect(events[0]).not.toHaveProperty("text");
  });

  it("does not throw when extra contains a forbidden field", () => {
    expect(() =>
      emitChatInboundStage({
        runId: "run-2",
        stage: "user_persist_error",
        extra: { message: "晚上好" },
      }),
    ).not.toThrow();
  });

  it("emits context compiler extras without transcript text", () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    emitChatInboundStage({
      runId: "run-compiler",
      stage: "context_compiled",
      extra: {
        preCompileMessageCount: 635,
        postCompileMessageCount: 11,
        providerBoundaryMatch: true,
      },
    });
    stop();
    expect(events[0]?.event).toBe("chat.context_compiled");
    expect(events[0]?.preCompileMessageCount).toBe(635);
    expect(events[0]?.postCompileMessageCount).toBe(11);
  });

  it("emits model timing extras without transcript text", () => {
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    emitChatInboundStage({
      runId: "run-ttft",
      stage: "first_token",
      extra: { modelTtftMs: 812 },
    });
    emitChatInboundStage({
      runId: "run-ttft",
      stage: "model_finished",
      extra: { modelMs: 2400, ok: true },
    });
    stop();
    expect(events.map((evt) => evt.event)).toEqual(["chat.first_token", "chat.model_finished"]);
    expect(events[0]?.modelTtftMs).toBe(812);
    expect(events[1]?.ok).toBe(true);
  });

  it("does not create observation state while the observation flag is off", () => {
    emitChatInboundStage({
      runId: "run-default-off",
      stage: "user_persisted",
      extra: { persistMs: 3 },
    });
    emitChatInboundStage({
      runId: "run-default-off",
      stage: "assistant_persisted",
    });
    expect(executionRouterObservationSize()).toBe(0);
    expect(peekExecutionRouterObservation("run-default-off")).toBeNull();
  });
});
