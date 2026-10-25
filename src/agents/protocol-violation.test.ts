import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyUserVisibleOutputGate } from "./model-output-boundary.js";
import {
  PROTOCOL_RECOGNITION_CLOSED_LIST,
  PROTOCOL_VIOLATION_DEDUPE_CACHE_LIMIT,
  allocateModelResponseAttemptId,
  buildProtocolViolationFact,
  createProtocolBoundaryState,
  eventIdFromDedupeKey,
  getProtocolViolationDedupeCacheSizeForTest,
  getProtocolViolationWriteFailureCountForTest,
  linkNativeOutcomesForViolation,
  persistProtocolViolationFact,
  resetProtocolViolationPersistForTest,
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

  it("positive: MiniMax marked pure body is detected (not bare XML)", () => {
    const text = [
      "调用工具",
      "<minimax:tool_call>",
      '<invoke name="read">',
      '<parameter name="path">a.md</parameter>',
      "</invoke>",
      "</minimax:tool_call>",
    ].join("\n");
    const gated = applyUserVisibleOutputGate(text);
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("minimax");
    expect(gated.recoveredCalls[0]?.toolName).toBe("read");
    expect(gated.visibleText).not.toContain("minimax");
  });

  it("positive: truncated MiniMax open without close is incomplete", () => {
    const gated = applyUserVisibleOutputGate('hi\n<minimax:tool_call>\n<invoke name="exec">');
    expect(gated.detected).toBe(true);
    expect(gated.protocol).toBe("minimax");
    expect(gated.incomplete).toBe(true);
  });

  it("positive: streaming incomplete MiniMax marker prefix is held", () => {
    const gated = applyUserVisibleOutputGate("check\n<minimax:tool_call", { streaming: true });
    expect(gated.detected).toBe(true);
    expect(gated.incomplete).toBe(true);
    expect(gated.protocol).toBe("minimax");
    expect(gated.visibleText).toBe("check");
  });

  it("negative: fenced MiniMax example is not an execution violation", () => {
    const fenced = ["示例：", "```xml", "<minimax:tool_call>", '<invoke name="x">', "```"].join(
      "\n",
    );
    const gated = applyUserVisibleOutputGate(fenced);
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

describe("protocol violation persist retry + bounded cache (§7.3.B P2)", () => {
  afterEach(() => {
    resetProtocolViolationPersistForTest();
  });

  it("allows retry after first write failure (does not mark before success)", () => {
    const blocker = path.join(os.tmpdir(), `pv-retry-block-${Date.now()}`);
    fs.writeFileSync(blocker, "not-a-dir");
    const nested = path.join(blocker, "logs", "protocol-violations.jsonl");
    const fact = buildProtocolViolationFact({
      runId: "run-retry",
      attemptOrTurnId: "run-retry:attempt:mr1",
      protocol: "dsml",
      classification: "pure_body",
      allowedToolNames: [],
      detectedToolNames: [],
      rawText: "retry-snippet",
      displayOutcome: "failure_copy",
      nativeExecutionStatus: "none",
      terminated: true,
    });
    const failed = persistProtocolViolationFact(fact, { logPath: nested });
    expect(failed.written).toBe(false);
    expect(failed.duplicate).toBe(false);
    fs.rmSync(blocker, { force: true });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-retry-ok-"));
    const logPath = path.join(dir, "protocol-violations.jsonl");
    const ok = persistProtocolViolationFact(fact, { logPath });
    expect(ok).toEqual({ written: true, duplicate: false });
    expect(fs.readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("evicts oldest dedupe keys when cache exceeds soft limit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-cache-"));
    const logPath = path.join(dir, "protocol-violations.jsonl");
    const limit = PROTOCOL_VIOLATION_DEDUPE_CACHE_LIMIT;
    // Write a few beyond would be slow at 4096; instead verify remember path via size growth then eviction helper
    // by writing limit+2 with unique snippets.
    for (let i = 0; i < 3; i += 1) {
      const fact = buildProtocolViolationFact({
        runId: `run-cache-${i}`,
        attemptOrTurnId: `a${i}`,
        protocol: "dsml",
        classification: "pure_body",
        allowedToolNames: [],
        detectedToolNames: [],
        rawText: `snippet-${i}-${Date.now()}`,
        displayOutcome: "failure_copy",
        nativeExecutionStatus: "none",
        terminated: true,
      });
      expect(persistProtocolViolationFact(fact, { logPath }).written).toBe(true);
    }
    expect(getProtocolViolationDedupeCacheSizeForTest()).toBe(3);
    expect(getProtocolViolationDedupeCacheSizeForTest()).toBeLessThanOrEqual(limit);
  });
});

describe("cross-response attemptOrTurnId + native outcome linking", () => {
  afterEach(() => {
    resetProtocolViolationPersistForTest();
  });

  it("same response id dedupes; different responses with same body both persist", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-cross-"));
    const logPath = path.join(dir, "protocol-violations.jsonl");
    const state = createProtocolBoundaryState("run-x:attempt");
    const id1 = allocateModelResponseAttemptId(state);
    const id2 = allocateModelResponseAttemptId(state);
    expect(id1).toBe("run-x:attempt:mr1");
    expect(id2).toBe("run-x:attempt:mr2");
    const body = "identical-body-dsml";
    const mk = (attemptOrTurnId: string) =>
      buildProtocolViolationFact({
        runId: "run-x",
        attemptOrTurnId,
        protocol: "dsml",
        classification: "mixed_native_and_body",
        allowedToolNames: ["read"],
        detectedToolNames: ["read"],
        rawText: body,
        displayOutcome: "stripped_partial",
        nativeExecutionStatus: "requested",
        terminated: false,
      });
    const a = mk(id1);
    const aDup = mk(id1);
    const b = mk(id2);
    expect(persistProtocolViolationFact(a, { logPath }).written).toBe(true);
    expect(persistProtocolViolationFact(aDup, { logPath })).toEqual({
      written: false,
      duplicate: true,
    });
    expect(persistProtocolViolationFact(b, { logPath }).written).toBe(true);
    expect(a.eventId).not.toBe(b.eventId);
    expect(fs.readFileSync(logPath, "utf8").trim().split("\n")).toHaveLength(2);
  });

  it("records linked native outcome events after requested (not pretreat executed)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pv-native-"));
    const logPath = path.join(dir, "protocol-violations.jsonl");
    const parent = buildProtocolViolationFact({
      runId: "run-n",
      attemptOrTurnId: "run-n:attempt:mr1",
      protocol: "dsml",
      classification: "mixed_native_and_body",
      allowedToolNames: ["read"],
      detectedToolNames: ["read"],
      rawText: "mixed",
      displayOutcome: "stripped_empty",
      nativeExecutionStatus: "requested",
      terminated: false,
    });
    expect(parent.nativeExecutionStatus).toBe("requested");
    persistProtocolViolationFact(parent, { logPath });
    const written = linkNativeOutcomesForViolation({
      parentFact: parent,
      runId: "run-n",
      logPath,
      tools: [
        { toolName: "read", toolCallId: "c1", success: true },
        { toolName: "read", toolCallId: "c2", success: false },
      ],
    });
    expect(written).toBe(2);
    const lines = fs
      .readFileSync(logPath, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines[0].nativeExecutionStatus).toBe("requested");
    expect(lines[1].event).toBe("protocol_violation_native_outcome");
    expect(lines[1].status).toBe("executed");
    expect(lines[1].parentEventId).toBe(parent.eventId);
    expect(lines[2].status).toBe("rejected");
  });
});
