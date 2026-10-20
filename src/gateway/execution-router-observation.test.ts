import { afterEach, describe, expect, it, vi } from "vitest";
import { onAgentEvent, resetAgentRunContextForTest } from "../infra/agent-events.js";
import { emitChatInboundStage, hashChatSessionKey } from "./chat-inbound-stage-events.js";
import {
  configureExecutionRouterObservationForTest,
  executionRouterObservationSize,
  observeChatInboundStage,
  observeSkillBaseline,
  observeToolBaseline,
  peekExecutionRouterObservation,
  resetExecutionRouterObservationForTest,
  type ChatRunObservation,
} from "./execution-router-observation.js";

afterEach(() => {
  resetExecutionRouterObservationForTest();
  resetAgentRunContextForTest();
  vi.unstubAllEnvs();
});

describe("execution-router observation bridge", () => {
  it("does not create state when the observation flag is off", () => {
    observeChatInboundStage({ runId: "run-off", stage: "user_persisted" });
    observeChatInboundStage({ runId: "run-off", stage: "model_started" });
    expect(executionRouterObservationSize()).toBe(0);
    expect(peekExecutionRouterObservation("run-off")).toBeNull();
  });

  it("aggregates mapped stages for the same runId", () => {
    let now = 1_000;
    configureExecutionRouterObservationForTest({ enabled: true, now: () => now });
    observeChatInboundStage({
      runId: "run-1",
      sessionKey: "agent:main:demo",
      stage: "user_persisted",
    });
    now += 10;
    observeChatInboundStage({ runId: "run-1", stage: "model_started" });
    now += 20;
    observeChatInboundStage({ runId: "run-1", stage: "first_token" });
    const snap = peekExecutionRouterObservation("run-1");
    expect(snap?.envelope.runId).toBe("run-1");
    expect(snap?.envelope.sessionKeyHash).toBe(hashChatSessionKey("agent:main:demo"));
    expect(snap?.envelope).not.toHaveProperty("sessionKey");
    expect(JSON.stringify(snap)).not.toContain("agent:main:demo");
    expect(snap?.stages.inbound_accepted).toBe(1_000);
    expect(snap?.stages.model_started).toBe(1_010);
    expect(snap?.stages.first_token).toBe(1_030);
    expect(snap?.latencies.ttftMs).toBe(20);
  });

  it("keeps the first inbound_accepted time across user_persisted and dispatch_started", () => {
    let now = 1_000;
    configureExecutionRouterObservationForTest({ enabled: true, now: () => now });
    observeChatInboundStage({ runId: "run-first", stage: "user_persisted" });
    now = 1_010;
    observeChatInboundStage({ runId: "run-first", stage: "dispatch_started" });
    expect(peekExecutionRouterObservation("run-first")?.stages.inbound_accepted).toBe(1_000);
  });

  it("keeps the first first_token time", () => {
    let now = 2_000;
    configureExecutionRouterObservationForTest({ enabled: true, now: () => now });
    observeChatInboundStage({ runId: "run-token", stage: "first_token" });
    now = 2_010;
    observeChatInboundStage({ runId: "run-token", stage: "first_token" });
    expect(peekExecutionRouterObservation("run-token")?.stages.first_token).toBe(2_000);
  });

  it("keeps concurrent runIds isolated", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 5_000 });
    observeChatInboundStage({ runId: "run-a", stage: "dispatch_started" });
    observeChatInboundStage({ runId: "run-b", stage: "model_started" });
    expect(peekExecutionRouterObservation("run-a")?.stages.inbound_accepted).toBe(5_000);
    expect(peekExecutionRouterObservation("run-a")?.stages.model_started).toBeUndefined();
    expect(peekExecutionRouterObservation("run-b")?.stages.model_started).toBe(5_000);
    expect(peekExecutionRouterObservation("run-b")?.stages.inbound_accepted).toBeUndefined();
  });

  it("treats repeated stages as first-write-wins without throwing", () => {
    let now = 10;
    configureExecutionRouterObservationForTest({ enabled: true, now: () => now });
    expect(() => {
      observeChatInboundStage({ runId: "run-dup", stage: "model_started" });
      now = 40;
      observeChatInboundStage({ runId: "run-dup", stage: "model_started" });
    }).not.toThrow();
    expect(peekExecutionRouterObservation("run-dup")?.stages.model_started).toBe(10);
  });

  it("tolerates missing stages when computing latencies", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 9_000 });
    observeChatInboundStage({ runId: "run-gap", stage: "dispatch_started" });
    observeChatInboundStage({ runId: "run-gap", stage: "assistant_persisted" });
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("releases memory after the terminal stage", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 2_000 });
    observeChatInboundStage({ runId: "run-done", stage: "user_persisted" });
    expect(executionRouterObservationSize()).toBe(1);
    observeChatInboundStage({ runId: "run-done", stage: "assistant_persisted" });
    expect(executionRouterObservationSize()).toBe(0);
    expect(peekExecutionRouterObservation("run-done")).toBeNull();
  });

  it("releases unfinished runs after TTL", () => {
    let now = 100;
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => now,
      ttlMs: 50,
    });
    observeChatInboundStage({ runId: "run-stale", stage: "user_persisted" });
    expect(executionRouterObservationSize()).toBe(1);
    now = 160;
    observeChatInboundStage({ runId: "run-fresh", stage: "dispatch_started" });
    expect(peekExecutionRouterObservation("run-stale")).toBeNull();
    expect(executionRouterObservationSize()).toBe(1);
    expect(peekExecutionRouterObservation("run-fresh")?.envelope.runId).toBe("run-fresh");
  });

  it("does not let observer failures change emitAgentEvent", () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => {
        throw new Error("clock boom");
      },
    });
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    expect(() =>
      emitChatInboundStage({
        runId: "run-safe",
        stage: "first_token",
        extra: { modelTtftMs: 12 },
      }),
    ).not.toThrow();
    stop();
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe("chat.first_token");
    expect(events[0]?.modelTtftMs).toBe(12);
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("keeps nested sensitive extras out of the snapshot", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 3_000 });
    observeChatInboundStage({
      runId: "run-secret",
      stage: "user_persisted",
      extra: {
        evidence: { metadata: { prompt: "NESTED_PROMPT_SECRET", token: "NESTED_TOKEN_SECRET" } },
      },
    });
    expect(peekExecutionRouterObservation("run-secret")).toBeNull();
    observeChatInboundStage({
      runId: "run-secret",
      stage: "model_started",
      extra: { persistMs: 4 },
    });
    const snap = peekExecutionRouterObservation("run-secret");
    expect(snap?.stages.model_started).toBe(3_000);
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain("NESTED_PROMPT_SECRET");
    expect(serialized).not.toContain("NESTED_TOKEN_SECRET");
    expect(serialized).not.toContain("prompt");
  });

  it("puts same-runId Skill/Tool baselines into the terminal snapshot", () => {
    const delivered: ChatRunObservation[] = [];
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 7_000,
      sink: (observation) => delivered.push(observation),
    });
    observeSkillBaseline({
      runId: "run-terminal-base",
      baseline: { eligibleCount: 5, injectedCount: 2, promptChars: 80 },
    });
    observeToolBaseline({
      runId: "run-terminal-base",
      baseline: {
        constructedCount: 6,
        afterPolicyCount: 3,
        exposedCount: 4,
        schemaChars: 120,
      },
    });
    observeChatInboundStage({ runId: "run-terminal-base", stage: "assistant_persisted" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.skillBaseline).toEqual({
      eligibleCount: 5,
      injectedCount: 2,
      promptChars: 80,
    });
    expect(delivered[0]?.toolBaseline).toEqual({
      constructedCount: 6,
      afterPolicyCount: 3,
      exposedCount: 4,
      schemaChars: 120,
    });
    expect(JSON.stringify(delivered[0])).not.toMatch(/SKILL\.md|"parameters":|user prompt|sk-/);
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("records Skill and Tool counts without schema bodies", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 8_000 });
    observeSkillBaseline({
      runId: "run-counts",
      baseline: { eligibleCount: 12, injectedCount: 8, promptChars: 2400 },
    });
    observeToolBaseline({
      runId: "run-counts",
      baseline: {
        constructedCount: 40,
        afterPolicyCount: 22,
        exposedCount: 20,
        schemaChars: 18_000,
      },
    });
    const snap = peekExecutionRouterObservation("run-counts");
    expect(snap?.skillBaseline).toEqual({
      eligibleCount: 12,
      injectedCount: 8,
      promptChars: 2400,
    });
    expect(snap?.toolBaseline).toEqual({
      constructedCount: 40,
      afterPolicyCount: 22,
      exposedCount: 20,
      schemaChars: 18_000,
    });
    expect(JSON.stringify(snap)).not.toMatch(/SKILL\.md|"parameters":/);
  });

  it("delivers the terminal snapshot to the sink before releasing run state", () => {
    const delivered: ChatRunObservation[] = [];
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 4_000,
      sink: (observation) => {
        expect(executionRouterObservationSize()).toBe(1);
        delivered.push(observation);
      },
    });
    observeChatInboundStage({
      runId: "run-sink",
      sessionKey: "agent:main:secret-user",
      stage: "user_persisted",
    });
    observeChatInboundStage({ runId: "run-sink", stage: "assistant_persisted" });
    expect(delivered).toHaveLength(1);
    expect(delivered[0]?.envelope.runId).toBe("run-sink");
    expect(delivered[0]?.envelope.sessionKeyHash).toBe(
      hashChatSessionKey("agent:main:secret-user"),
    );
    expect(delivered[0]?.envelope).not.toHaveProperty("sessionKey");
    expect(delivered[0]?.stages.inbound_accepted).toBe(4_000);
    expect(delivered[0]?.stages.run_completed).toBe(4_000);
    expect(JSON.stringify(delivered[0])).not.toContain("secret-user");
    expect(executionRouterObservationSize()).toBe(0);
  });

  it("releases run state when the sink throws", () => {
    configureExecutionRouterObservationForTest({
      enabled: true,
      now: () => 6_000,
      sink: () => {
        throw new Error("sink boom");
      },
    });
    expect(() => {
      observeChatInboundStage({ runId: "run-sink-fail", stage: "user_persisted" });
      observeChatInboundStage({ runId: "run-sink-fail", stage: "assistant_persisted" });
    }).not.toThrow();
    expect(executionRouterObservationSize()).toBe(0);
    expect(peekExecutionRouterObservation("run-sink-fail")).toBeNull();
  });

  it("emits a hashed local diagnostic event from the default sink", () => {
    configureExecutionRouterObservationForTest({ enabled: true, now: () => 7_000 });
    const events: Array<Record<string, unknown>> = [];
    const stop = onAgentEvent((evt) => {
      events.push(evt.data);
    });
    observeChatInboundStage({
      runId: "run-default-sink",
      sessionKey: "agent:main:secret-user",
      stage: "user_persisted",
    });
    observeChatInboundStage({ runId: "run-default-sink", stage: "assistant_persisted" });
    stop();
    const observation = events.find((evt) => evt.event === "chat.execution_observation");
    expect(observation?.sessionKeyHash).toBe(hashChatSessionKey("agent:main:secret-user"));
    expect(observation).not.toHaveProperty("sessionKey");
    expect(JSON.stringify(observation)).not.toContain("secret-user");
    expect(observation?.latencies).toEqual({ totalMs: 0 });
  });
});
