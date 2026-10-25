import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyUserVisibleOutputGate } from "./model-output-boundary.js";
import {
  PROTOCOL_RECOGNITION_CLOSED_LIST,
  buildProtocolViolationFact,
  eventIdFromDedupeKey,
  persistProtocolViolationFact,
  resetProtocolViolationPersistForTest,
  getProtocolViolationWriteFailureCountForTest,
} from "./protocol-violation.js";

describe("protocol recognition closed list (§7.3.A)", () => {
  it("exposes the closed recognition catalog", () => {
    expect(PROTOCOL_RECOGNITION_CLOSED_LIST.dsml_complete).toMatch(/DSML/);
    expect(PROTOCOL_RECOGNITION_CLOSED_LIST.excluded).toMatch(/invoke/);
  });

  it("positive: complete DSML is detected", () => {
    const text = [
      "prefix",
      "<｜DSML｜tool_calls>",
      '<｜DSML｜invoke name="read">',
      "</｜DSML｜invoke>",
      "</｜DSML｜tool_calls>",
    ].join("\n");
    const gated = applyUserVisibleOutputGate(text);
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("dsml");
    expect(gated.recoveredCalls[0]?.toolName).toBe("read");
    expect(gated.recoveredCalls[0]?.arguments).toEqual({});
  });

  it("positive: incomplete DSML tail is detected", () => {
    const gated = applyUserVisibleOutputGate("check\n<|DSML|", { streaming: true });
    expect(gated.detected).toBe(true);
    expect(gated.incomplete).toBe(true);
  });

  it("negative: ordinary invoke word is not a violation", () => {
    const gated = applyUserVisibleOutputGate("Please invoke the helper carefully.");
    expect(gated.detected).toBe(false);
  });

  it("negative: comparison < is not a violation", () => {
    const gated = applyUserVisibleOutputGate("threshold is 3 < 5");
    expect(gated.detected).toBe(false);
  });

  it("negative: fenced DSML example is not detected as executable protocol", () => {
    const fenced = ["说明：", "```xml", "<|DSML| | tool_calls>", "```"].join("\n");
    const gated = applyUserVisibleOutputGate(fenced);
    expect(gated.detected).toBe(false);
  });

  it("negative: arbitrary XML without minimax marker is not DSML-gated", () => {
    const gated = applyUserVisibleOutputGate('<note><invoke name="x">y</invoke></note>');
    expect(gated.detected).toBe(false);
  });
});

describe("protocol violation persistence (§7.3.B)", () => {
  afterEach(() => {
    resetProtocolViolationPersistForTest();
  });

  it("uses deterministic eventId from dedupe key and ignores duplicate writes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-"));
    const logPath = path.join(dir, "protocol-violations.jsonl");
    const fact = buildProtocolViolationFact({
      runId: "run-1",
      attemptOrTurnId: "run-1:attempt",
      protocol: "dsml",
      classification: "pure_body",
      allowedToolNames: ["read"],
      detectedToolNames: ["read"],
      rawText: "same-snippet",
      displayOutcome: "failure_copy",
      nativeExecutionStatus: "none",
      terminated: true,
    });
    expect(fact.eventId).toBe(eventIdFromDedupeKey(fact.dedupeKey));
    expect(persistProtocolViolationFact(fact, { logPath })).toEqual({
      written: true,
      duplicate: false,
    });
    expect(persistProtocolViolationFact(fact, { logPath })).toEqual({
      written: false,
      duplicate: true,
    });
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("keeps execution boundary when log write fails (counts alert)", () => {
    const fact = buildProtocolViolationFact({
      runId: "run-2",
      attemptOrTurnId: "run-2:attempt",
      protocol: "dsml",
      classification: "pure_body",
      allowedToolNames: [],
      detectedToolNames: [],
      rawText: "x",
      displayOutcome: "failure_copy",
      nativeExecutionStatus: "none",
      terminated: true,
    });
    // Path under a file (not a directory) forces mkdir/append failure modes; use illegal null path.
    const result = persistProtocolViolationFact(fact, {
      logPath: path.join(os.tmpdir(), "pv-as-file-block"),
    });
    // First create a file where directory is needed on next call with nested path
    const blocker = path.join(os.tmpdir(), `pv-block-${Date.now()}`);
    fs.writeFileSync(blocker, "not-a-dir");
    const nested = path.join(blocker, "logs", "protocol-violations.jsonl");
    resetProtocolViolationPersistForTest();
    const failed = persistProtocolViolationFact(
      buildProtocolViolationFact({
        runId: "run-3",
        attemptOrTurnId: "run-3:attempt",
        protocol: "dsml",
        classification: "pure_body",
        allowedToolNames: [],
        detectedToolNames: [],
        rawText: "y",
        displayOutcome: "failure_copy",
        nativeExecutionStatus: "none",
        terminated: true,
      }),
      { logPath: nested },
    );
    expect(failed.written).toBe(false);
    expect(failed.error).toBeTruthy();
    expect(getProtocolViolationWriteFailureCountForTest()).toBeGreaterThan(0);
    void result;
    fs.rmSync(blocker, { force: true });
  });
});
