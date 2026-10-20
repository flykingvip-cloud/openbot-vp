import { describe, expect, it } from "vitest";
import {
  buildExecutionRecord,
  exportRecordsJson,
  formatFabricAuditLine,
  hashStdout,
  queryRecords,
  redactArgs,
  redactEnv,
  snapshotRequest,
} from "./audit.js";
import type { PolicyDecision, ToolExecutionResult, ToolRequest } from "./contract.js";

function req(overrides: Partial<ToolRequest> = {}): ToolRequest {
  return {
    id: "req-1",
    source: { type: "cursor", tenantId: "t1" },
    tool: { name: "exec" },
    input: { args: ["run", "--token=abc123"], env: { API_KEY: "sekret", PATH: "/usr/bin" } },
    context: {},
    trace: { sessionId: "s1", correlationId: "c1", taskId: "task-1" },
    ...overrides,
  };
}

const ALLOW: PolicyDecision = { decision: "ALLOW", matchedRules: [], decisionTrace: [] };

function execResult(status: ToolExecutionResult["status"] = "success"): ToolExecutionResult {
  return {
    id: "req-1",
    status,
    output: { stdout: "hello world" },
    exitCode: 0,
    timing: { start: 1, end: 2 },
    trace: { policyDecisionId: "req-1", executionId: "e1" },
  };
}

describe("audit — redaction (R9.5)", () => {
  it("redacts secret-looking env values by key name", () => {
    expect(redactEnv({ API_KEY: "x", PATH: "/usr/bin" })).toEqual({
      API_KEY: "[redacted:API_KEY]",
      PATH: "/usr/bin",
    });
  });

  it("redacts --token=... argv values, keeps the flag", () => {
    expect(redactArgs(["run", "--token=abc", "--verbose"])).toEqual([
      "run",
      "--token=[redacted]",
      "--verbose",
    ]);
  });

  it("snapshot carries no plaintext secrets", () => {
    const snap = snapshotRequest(req());
    expect(snap.input.env?.API_KEY).toBe("[redacted:API_KEY]");
    expect(snap.input.args).toContain("--token=[redacted]");
    expect(JSON.stringify(snap)).not.toContain("sekret");
    expect(JSON.stringify(snap)).not.toContain("abc123");
  });
});

describe("audit — record build + query + export", () => {
  it("builds an immutable record with who/what/decision/result + stdout hash", () => {
    const rec = buildExecutionRecord({ request: req(), decision: ALLOW, result: execResult() });
    expect(rec.correlationId).toBe("c1");
    expect(rec.tenantId).toBe("t1");
    expect(rec.who.source.type).toBe("cursor");
    expect(rec.result.stdoutHash).toBe(hashStdout("hello world"));
    expect(rec.result.stdoutHash).toMatch(/^djb2:/);
    // no raw stdout stored
    expect(JSON.stringify(rec)).not.toContain("hello world");
  });

  it("queries by tenant/session/correlation", () => {
    const a = buildExecutionRecord({ request: req(), decision: ALLOW, result: execResult() });
    const b = buildExecutionRecord({
      request: req({
        source: { type: "kiro", tenantId: "t2" },
        trace: { sessionId: "s2", correlationId: "c2" },
      }),
      decision: ALLOW,
      result: execResult(),
    });
    expect(queryRecords([a, b], { tenantId: "t1" })).toEqual([a]);
    expect(queryRecords([a, b], { sessionId: "s2" })).toEqual([b]);
    expect(queryRecords([a, b], {})).toHaveLength(2);
  });

  it("exports JSON", () => {
    const rec = buildExecutionRecord({ request: req(), decision: ALLOW, result: execResult() });
    const json = exportRecordsJson([rec]);
    expect(JSON.parse(json)).toHaveLength(1);
  });
});

describe("audit — formatFabricAuditLine (control-plane audit store)", () => {
  it("emits a parseable key=value line with no plaintext secrets", () => {
    const rec = buildExecutionRecord({
      request: req(),
      decision: ALLOW,
      result: execResult("success"),
      costUsd: 0.02,
      ownership: { owner: "kiro-fabric", conflict: false, unattributed: false },
    });
    const line = formatFabricAuditLine(rec);
    expect(line).toContain("fabric.tool.execute");
    expect(line).toContain("decision=ALLOW");
    expect(line).toContain("status=success");
    expect(line).toContain("tool=exec");
    expect(line).toContain("corr=c1");
    expect(line).toContain("tenant=t1");
    expect(line).toContain("owner=kiro-fabric");
    expect(line).toContain("exit=0");
    expect(line).toContain("costUsd=0.02");
    expect(line).toContain("stdout=djb2:");
    expect(line).toContain("durMs=1");
    expect(line).not.toContain("sekret");
    expect(line).not.toContain("hello world");
  });

  it("includes the deny reason for DENY decisions", () => {
    const DENY: PolicyDecision = {
      decision: "DENY",
      reason: "exec_approval_unresolved",
      matchedRules: [],
      decisionTrace: [],
    };
    const rec = buildExecutionRecord({
      request: req(),
      decision: DENY,
      result: execResult("denied"),
    });
    const line = formatFabricAuditLine(rec);
    expect(line).toContain("decision=DENY");
    expect(line).toContain("reason=exec_approval_unresolved");
  });
});
