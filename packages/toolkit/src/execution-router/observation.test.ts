import { describe, expect, it } from "vitest";
import { failReceipt, startReceipt } from "../receipt.js";
import { EXECUTION_EVENTS, EXECUTION_STAGES } from "./contracts.js";
import { createExecutionObserver, isMonotonicStageSequence } from "./observation.js";
import {
  assertNoSensitiveFields,
  isForbiddenObservationKey,
  projectToolkitReceipt,
} from "./privacy.js";

describe("execution-router observation", () => {
  it("is a no-op when disabled (default)", () => {
    const observer = createExecutionObserver({ runId: "run-off" });
    expect(observer.enabled).toBe(false);
    observer.markStage("inbound_accepted");
    observer.recordSkillBaseline({ eligibleCount: 3, injectedCount: 2, promptChars: 40 });
    expect(observer.snapshot()).toBeNull();
  });

  it("records the required stage sequence and latencies", () => {
    let clock = 1_000;
    const observer = createExecutionObserver({
      runId: "run-1",
      sessionKeyHash: "abc123def456",
      enabled: true,
      now: () => clock,
    });
    for (const stage of EXECUTION_STAGES) {
      observer.markStage(stage);
      clock += 10;
    }
    const snap = observer.snapshot();
    expect(snap?.envelope.runId).toBe("run-1");
    expect(snap?.envelope.sessionKeyHash).toBe("abc123def456");
    expect(snap?.envelope).not.toHaveProperty("sessionKey");
    expect(snap?.events).toContain(EXECUTION_EVENTS.TASK_ENVELOPE_CREATED);
    expect(Object.keys(snap?.stages ?? {})).toEqual([...EXECUTION_STAGES]);
    expect(snap?.latencies.routePrepMs).toBe(30);
    expect(snap?.latencies.ttftMs).toBe(10);
    expect(snap?.latencies.totalMs).toBe(60);
    expect(isMonotonicStageSequence(EXECUTION_STAGES)).toBe(true);
  });

  it("tolerates missing stages when computing latencies", () => {
    const observer = createExecutionObserver({
      runId: "run-partial",
      enabled: true,
      now: () => 5_000,
    });
    observer.markStage("inbound_accepted");
    observer.markStage("run_completed");
    const snap = observer.snapshot();
    expect(snap?.stages.skill_snapshot_ready).toBeUndefined();
    expect(snap?.latencies.ttftMs).toBeUndefined();
    expect(snap?.latencies.totalMs).toBe(0);
  });

  it("records Skill/Tool counts without storing bodies", () => {
    const observer = createExecutionObserver({ runId: "run-counts", enabled: true });
    observer.recordSkillBaseline({ eligibleCount: 12, injectedCount: 8, promptChars: 2400 });
    observer.recordToolBaseline({
      constructedCount: 40,
      afterPolicyCount: 22,
      exposedCount: 20,
      schemaChars: 18_000,
    });
    const snap = observer.snapshot();
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
    expect(snap?.events).toEqual(
      expect.arrayContaining([
        EXECUTION_EVENTS.SKILL_CANDIDATES_RETRIEVED,
        EXECUTION_EVENTS.TOOL_CANDIDATES_RETRIEVED,
        EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED,
      ]),
    );
    expect(JSON.stringify(snap)).not.toMatch(/SKILL\.md|# Instructions|https:\/\/secret/);
  });

  it("keeps the first timestamp when a stage is marked again", () => {
    let clock = 1_000;
    const observer = createExecutionObserver({
      runId: "run-first-write",
      enabled: true,
      now: () => clock,
    });
    observer.markStage("inbound_accepted");
    clock = 1_010;
    observer.markStage("inbound_accepted");
    clock = 2_000;
    observer.markStage("first_token");
    clock = 2_010;
    observer.markStage("first_token");
    const snap = observer.snapshot();
    expect(snap?.stages.inbound_accepted).toBe(1_000);
    expect(snap?.stages.first_token).toBe(2_000);
  });

  it("associates toolkit receipts with the same runId/sessionKeyHash", () => {
    const observer = createExecutionObserver({
      runId: "run-receipt",
      sessionKeyHash: "hash-s1",
      enabled: true,
    });
    observer.markStage("inbound_accepted");
    observer.attachToolkitReceipt(
      startReceipt({
        toolId: "read",
        operation: "read",
        receiptId: "rcpt-run-receipt",
        startedAt: "2026-09-06T00:00:00.000Z",
      }),
    );
    const snap = observer.snapshot();
    expect(snap?.envelope.runId).toBe("run-receipt");
    expect(snap?.envelope.sessionKeyHash).toBe("hash-s1");
    expect(snap?.envelope).not.toHaveProperty("sessionKey");
    expect(snap?.toolkitReceipts).toHaveLength(1);
    expect(snap?.toolkitReceipts[0]?.receiptId).toBe("rcpt-run-receipt");
    expect(snap?.toolkitReceipts[0]).not.toHaveProperty("evidence");
    expect(snap?.toolkitReceipts[0]).not.toHaveProperty("sideEffects");
  });

  it("projects nested receipt secrets out of the snapshot", () => {
    const observer = createExecutionObserver({ runId: "run-nested", enabled: true });
    const receipt = failReceipt(
      startReceipt({
        toolId: "web_fetch",
        operation: "get",
        receiptId: "rcpt-nested",
        startedAt: "2026-09-06T00:00:00.000Z",
        evidence: [
          {
            kind: "log",
            label: "model-call",
            metadata: {
              prompt: "NESTED_PROMPT_SECRET",
              token: "NESTED_TOKEN_SECRET",
            },
          },
        ],
        sideEffects: ["SIDE_EFFECT_BODY_SECRET user asked to book a flight"],
      }),
      {
        error: {
          code: "tool_failed",
          message: "denied",
          details: { arguments: { url: "https://secret.example/NESTED_ARGS_SECRET" } },
        },
        completedAt: "2026-09-06T00:00:01.000Z",
      },
    );
    expect(receipt.evidence[0]?.metadata?.prompt).toBe("NESTED_PROMPT_SECRET");
    observer.attachToolkitReceipt(receipt);
    const snap = observer.snapshot();
    const serialized = JSON.stringify(snap);
    expect(snap?.toolkitReceipts).toHaveLength(1);
    expect(snap?.toolkitReceipts[0]).toMatchObject({
      receiptId: "rcpt-nested",
      toolId: "web_fetch",
      evidenceCount: 1,
      sideEffectCount: 1,
      errorCode: "tool_failed",
    });
    expect(snap?.toolkitReceipts[0]).not.toHaveProperty("evidence");
    expect(snap?.toolkitReceipts[0]).not.toHaveProperty("error");
    expect(serialized).not.toContain("NESTED_PROMPT_SECRET");
    expect(serialized).not.toContain("NESTED_TOKEN_SECRET");
    expect(serialized).not.toContain("NESTED_ARGS_SECRET");
    expect(serialized).not.toContain("SIDE_EFFECT_BODY_SECRET");
    expect(serialized).not.toContain("https://secret.example");
    const projected = projectToolkitReceipt(receipt);
    expect(projected).not.toHaveProperty("evidence");
    expect(JSON.stringify(projected)).not.toContain("NESTED_PROMPT_SECRET");
  });

  it("rejects nested sensitive extras before mutating observer state", () => {
    expect(() =>
      assertNoSensitiveFields({
        evidence: { metadata: { prompt: "nested extra prompt" } },
      }),
    ).toThrow(/forbids field "prompt"/);
    expect(() =>
      assertNoSensitiveFields({
        error: { details: { arguments: { path: "/tmp" } } },
      }),
    ).toThrow(/forbids field "arguments"/);
    const observer = createExecutionObserver({ runId: "run-nested-extra", enabled: true });
    observer.recordEvent(EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED, {
      evidence: { metadata: { token: "sk-nested" } },
    });
    expect(observer.snapshot()).toBeNull();
  });

  it("rejects sensitive extras and does not collect user or tool bodies", () => {
    expect(isForbiddenObservationKey("prompt")).toBe(true);
    expect(isForbiddenObservationKey("args")).toBe(true);
    expect(() => assertNoSensitiveFields({ prompt: "user text" })).toThrow(
      /forbids field "prompt"/,
    );
    const observer = createExecutionObserver({ runId: "run-privacy", enabled: true });
    observer.recordEvent(EXECUTION_EVENTS.TASK_ENVELOPE_CREATED, { prompt: "secret user body" });
    const snap = observer.snapshot();
    expect(snap).toBeNull();
  });

  it("swallows observation failures so the caller path is unchanged", () => {
    const observer = createExecutionObserver({ runId: "run-safe", enabled: true });
    expect(() => {
      observer.recordEvent(EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED, { token: "sk-live" });
      observer.markStage("first_token");
    }).not.toThrow();
    const snap = observer.snapshot();
    expect(snap?.envelope.runId).toBe("run-safe");
    expect(snap?.events).not.toContain(EXECUTION_EVENTS.TOOL_SCHEMA_EXPOSED);
    expect(JSON.stringify(snap)).not.toContain("sk-live");
  });

  it("does not treat out-of-order stages as a caller failure", () => {
    expect(isMonotonicStageSequence(["first_token", "inbound_accepted"])).toBe(false);
    const observer = createExecutionObserver({
      runId: "run-order",
      enabled: true,
      now: () => 9,
    });
    expect(() => {
      observer.markStage("first_token");
      observer.markStage("inbound_accepted");
    }).not.toThrow();
    const snap = observer.snapshot();
    expect(snap?.stages.first_token).toBe(9);
    expect(snap?.stages.inbound_accepted).toBe(9);
  });
});
