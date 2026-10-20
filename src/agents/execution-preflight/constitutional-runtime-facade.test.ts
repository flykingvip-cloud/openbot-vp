import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONSTITUTIONAL_SHADOW_ENV } from "../../../packages/constitutional-contracts/src/index.js";
import { observePreflightRuntimeFacade } from "./constitutional-runtime-facade.js";
import type { ExecutionTraceRecord, ValidationReceipt } from "./types.js";

const receipt: ValidationReceipt = {
  taskId: "task-1",
  artifactPath: "/tmp/not-a-ledger",
  artifactHash: "abc123",
  validatorId: "validator-1",
  validatorVersion: "1",
  timestamp: "2026-09-25T00:00:00.000Z",
  result: "passed",
};

const trace: ExecutionTraceRecord = {
  taskId: "task-1",
  sessionId: "session-1",
  attemptNumber: 1,
  intentClass: "chat",
  decisionStage: "preflight",
  decisionCode: "allow",
};

describe("preflight runtime façade call site", () => {
  it("is not imported by the preflight barrel, resolver, or trace writer", () => {
    const barrel = readFileSync(new URL("./index.ts", import.meta.url), "utf8");
    const resolve = readFileSync(new URL("./resolve.ts", import.meta.url), "utf8");
    const traceWriter = readFileSync(new URL("./trace.ts", import.meta.url), "utf8");
    const self = readFileSync(
      new URL("./constitutional-runtime-facade.ts", import.meta.url),
      "utf8",
    );
    for (const source of [barrel, resolve, traceWriter]) {
      expect(source).not.toContain("constitutional-runtime-facade");
      expect(source).not.toContain("constitutional-contracts");
    }
    expect(self).not.toMatch(/from\s+["']\.\/(resolve|trace|index)\.js["']/);
    expect(self).not.toContain("process.env");
  });

  it("stays inert when process.env is on and the caller did not opt in", () => {
    const previous = process.env[CONSTITUTIONAL_SHADOW_ENV];
    process.env[CONSTITUTIONAL_SHADOW_ENV] = "true";
    try {
      const result = observePreflightRuntimeFacade({
        validationReceipts: [receipt],
        executionTraces: [trace],
        enforce: true,
        candidatePath: "session-key",
      });
      expect(result.invoked).toBe(false);
      expect(result.report).toBeNull();
      expect(result.surface).toBe("execution-preflight");
      expect(result.wroteReceipt).toBe(false);
      expect(result.wroteTrace).toBe(false);
      expect(result.selectedPath).toBeNull();
      expect(result.blocked).toBe(false);
      expect(result.enforce).toBe(false);
      expect(result.liveInvoke).toBe(false);
      expect(result.fabricDefaultOn).toBe(false);
    } finally {
      if (previous === undefined) {
        delete process.env[CONSTITUTIONAL_SHADOW_ENV];
      } else {
        process.env[CONSTITUTIONAL_SHADOW_ENV] = previous;
      }
    }
  });

  it("reports injected receipt and trace rows without writing them back", () => {
    const result = observePreflightRuntimeFacade({
      validationReceipts: [receipt],
      executionTraces: [trace],
      shadow: true,
      workflowRef: "not-a-path",
    });
    expect(result.invoked).toBe(true);
    expect(result.report?.counts.evidence).toBe(2);
    expect(result.report?.findings).toEqual([]);
    expect(result.report?.enforce).toBe(false);
    expect(result.wroteReceipt).toBe(false);
    expect(result.wroteTrace).toBe(false);
    expect(result.wroteLedger).toBe(false);
    expect(result.selectedPath).toBeNull();
    expect(result.candidatePathDiscarded).toBe(true);
    expect(result.legalPathSelectable).toBe(false);
    expect(result.executed).toBe(false);
    expect(result.blocked).toBe(false);
    expect(result.liveInvoke).toBe(false);
    expect(result.fabricDefaultOn).toBe(false);
  });
});
