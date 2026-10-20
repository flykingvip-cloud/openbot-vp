import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { loadGoldenDiagnosticRunGraph as loadGraph } from "./fixture-graph.js";
import { replayDiagnosticRunGraph, stripRunCompletion } from "./runner.js";
import {
  readAgentRunnerFromSessionJsonl,
  readAgentRunnerObservations,
  readToolRuntimeFromSessionJsonl,
  readToolRuntimeObservations,
} from "./runtime-observations.js";
import { resolvePartialSourceBundle } from "./store-readers.js";
import type { TrustedTenantContext } from "./types.js";

const TRUSTED: TrustedTenantContext = { tenantId: "tenant-fixture-a" };
const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function writeJsonl(dir: string, name: string, records: readonly object[]): string {
  tmpDirs.push(dir);
  const filePath = path.join(dir, name);
  fs.writeFileSync(filePath, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return filePath;
}

describe("Phase 1 increment 3.9 — Agent/Tool read-only authorities", () => {
  it("maps hook/diagnostic-event observations into agent_runner rows", () => {
    const filePath = writeJsonl(
      fs.mkdtempSync(path.join(os.tmpdir(), "diag-agent-obs-")),
      "agent.jsonl",
      [
        {
          type: "run.attempt",
          agentId: "agent-fixture-main",
          runId: "agent-run-obs-1",
          ts: Date.parse("2026-09-01T10:00:00.000Z"),
        },
        {
          type: "agent_end",
          agentId: "agent-fixture-main",
          runId: "agent-run-obs-1",
          success: false,
          error: { class: "timeout" },
          ts: Date.parse("2026-09-01T10:00:08.000Z"),
        },
      ],
    );
    const rows = readAgentRunnerObservations(filePath);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.agentStarted).toBe(true);
    expect(rows[1]?.agentCompleted).toBe(false);
    expect(rows[1]?.errorClass).toBe("timeout");
    expect(JSON.stringify(rows)).not.toContain("prompt");
  });

  it("maps after_tool_call observations without copying params or result", () => {
    const filePath = writeJsonl(
      fs.mkdtempSync(path.join(os.tmpdir(), "diag-tool-obs-")),
      "tool.jsonl",
      [
        {
          type: "after_tool_call",
          toolName: "web_fetch",
          runId: "agent-run-obs-1",
          toolCallId: "call-1",
          timeout: true,
          error: { class: "timeout" },
          durationMs: 30_000,
          params: { url: "https://secret.example/token" },
          result: { body: "secret tool output" },
        },
      ],
    );
    const rows = readToolRuntimeObservations(filePath);
    expect(rows).toEqual([
      expect.objectContaining({
        toolNameClass: "web_fetch",
        timeout: true,
        errorClass: "timeout",
        latencyMs: 30_000,
      }),
    ]);
    expect(JSON.stringify(rows)).not.toContain("secret");
    expect(JSON.stringify(rows)).not.toContain("params");
    expect(JSON.stringify(rows)).not.toContain("result");
  });

  it("reads Session JSONL roles for agent/tool without copying message body", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-session-obs-"));
    const sessionFilePath = writeJsonl(dir, "session.jsonl", [
      { type: "session-meta", agentId: "agent-fixture-main" },
      { type: "message", message: { role: "user", content: "secret inbound" } },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [{ type: "tool_use", name: "web_fetch", input: { url: "https://secret" } }],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolName: "web_fetch", error: "timeout after 30s" },
      },
    ]);
    const agent = readAgentRunnerFromSessionJsonl({
      sessionFilePath,
      agentId: "agent-fixture-main",
      observedAt: "2026-09-01T10:00:08.000Z",
    });
    const tools = readToolRuntimeFromSessionJsonl({ sessionFilePath });
    expect(agent[0]?.agentStarted).toBe(true);
    expect(agent[0]?.complete).toBe(false);
    expect(tools.some((row) => row.toolNameClass === "web_fetch" && row.timeout)).toBe(true);
    expect(JSON.stringify(agent)).not.toContain("secret");
    expect(JSON.stringify(tools)).not.toContain("secret");
  });

  it("ignores fictional agent_runner observation types", () => {
    const filePath = writeJsonl(
      fs.mkdtempSync(path.join(os.tmpdir(), "diag-agent-fake-")),
      "agent.jsonl",
      [
        {
          type: "agent_runner",
          agentId: "agent-fixture-main",
          runId: "agent-run-fake",
          agentStarted: true,
          complete: true,
        },
      ],
    );
    expect(readAgentRunnerObservations(filePath)).toEqual([]);
  });

  it("marks session-derived agent rows complete only after agent_end", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-session-end-"));
    const sessionFilePath = writeJsonl(dir, "session.jsonl", [
      { type: "session-meta", agentId: "agent-fixture-main" },
      { type: "message", message: { role: "assistant", content: "working" } },
      { type: "agent_end", agentId: "agent-fixture-main", runId: "run-end", success: true },
    ]);
    const agent = readAgentRunnerFromSessionJsonl({
      sessionFilePath,
      agentId: "agent-fixture-main",
    });
    expect(agent[0]?.agentCompleted).toBe(true);
    expect(agent[0]?.complete).toBe(true);
  });

  it("lets runner collect agent_runner from observations instead of fixture projection", async () => {
    const filePath = writeJsonl(
      fs.mkdtempSync(path.join(os.tmpdir(), "diag-runner-agent-")),
      "agent.jsonl",
      [
        {
          type: "agent_end",
          agentId: "agent-fixture-main",
          runId: "agent-run-obs-override",
          success: true,
        },
      ],
    );
    const graph = loadGraph("skill-not-triggered.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      stores: { agentObservationFile: filePath },
    });
    expect(
      replayed.collected.some(
        (evidence) =>
          evidence.source === "agent_runner" &&
          String(evidence.authorityRecordId).includes("agent-run-obs-override"),
      ),
    ).toBe(true);
  });

  it("does not fall back to fixture tool rows when a session store is bound", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-no-proj-"));
    const sessionFilePath = writeJsonl(dir, "session.jsonl", [
      { type: "session-meta", agentId: "agent-fixture-main" },
      { type: "message", message: { role: "user", content: "hello" } },
    ]);
    const graph = loadGraph("skill-triggered-tool-timeout.json");
    const bundle = resolvePartialSourceBundle({
      evidences: graph.evidences,
      stores: {
        sessionFile: {
          sessionFilePath,
          sessionId: "session-fixture-1",
          sessionKeyHash: "sha256:fixture",
          agentId: "agent-fixture-main",
        },
      },
    });
    expect(bundle.toolRuntime).toEqual([]);
    expect(bundle.agentRunner?.[0]?.agentStarted).toBe(false);
    expect(bundle.agentRunner?.[0]?.complete).toBe(false);
  });

  it("does not collect fixture tool rows after a session store covers the runner", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "diag-no-fixture-collect-"));
    const sessionFilePath = writeJsonl(dir, "session.jsonl", [
      { type: "session-meta", agentId: "agent-fixture-main" },
      { type: "message", message: { role: "user", content: "hello" } },
    ]);
    const graph = loadGraph("skill-triggered-tool-timeout.json");
    const replayed = await replayDiagnosticRunGraph({
      graph: { ...graph, run: stripRunCompletion(graph.run) },
      trusted: TRUSTED,
      stores: {
        sessionFile: {
          sessionFilePath,
          sessionId: "session-fixture-1",
          sessionKeyHash: "sha256:fixture",
          agentId: "agent-fixture-main",
        },
      },
    });
    expect(
      replayed.collected.some((evidence) => evidence.evidenceId === "ev-fixture-3-tool-timeout"),
    ).toBe(false);
    expect(
      replayed.collected.some(
        (evidence) => evidence.authorityRecordId === "tool-hook:tool-call-fixture-3",
      ),
    ).toBe(false);
    expect(replayed.collected.some((evidence) => evidence.source === "tool_runtime")).toBe(false);
  });

  it("does not import emit/append/repair writers", () => {
    const source = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), "runtime-observations.ts"),
      "utf8",
    );
    expect(source).not.toContain("emitDiagnosticEvent");
    expect(source).not.toContain("appendSkillInvocationEvent");
    expect(source).not.toContain("writeConfigFile");
    expect(source).not.toContain("doctorCommand");
  });
});
