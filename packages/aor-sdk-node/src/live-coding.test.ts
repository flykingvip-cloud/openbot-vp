import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BackendCapability,
  BackendEvent,
  BackendRunResult,
  ExecutionBackend,
  PlannedStep,
  RunHandle,
} from "@openbot/aor-core";
import { defaultModelCatalog } from "@openbot/aor-core";
import { describe, expect, it, vi } from "vitest";
import {
  runLiveCodingArchive,
  runLiveCodingArchiveWithBackend,
  writeLiveCodingArchive,
} from "./live-coding.js";

function tempWorkspace(testScript: string): string {
  const dir = mkdtempSync(join(tmpdir(), "aor-live-ws-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { test: testScript } }),
    "utf8",
  );
  return dir;
}

class StubBackend implements ExecutionBackend {
  readonly id = "stub";
  constructor(private readonly text: string) {}
  capabilities(): Promise<BackendCapability> {
    return Promise.resolve({ models: defaultModelCatalog().map((m) => m.ref) });
  }
  run(_step: PlannedStep): Promise<RunHandle> {
    return Promise.resolve({ runId: "1" });
  }
  async *stream(): AsyncIterable<BackendEvent> {
    yield { kind: "lifecycle", phase: "end" };
  }
  wait(): Promise<BackendRunResult> {
    return Promise.resolve({
      text: this.text,
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, costUsd: 0.01 },
    });
  }
  abort(): Promise<void> {
    return Promise.resolve();
  }
}

describe("live coding archive", () => {
  it("archives objective coding run with injectable backend", async () => {
    const workspace = tempWorkspace('node -e "process.exit(0)"');
    try {
      const record = await runLiveCodingArchiveWithBackend({
        backend: new StubBackend("- FIX: validate input\n- suggest: add tests"),
        goal: "review auth",
        workspace,
      });
      expect(record.mode).toBe("mock-gateway");
      expect(record.result.taskType).toBe("coding.review");
      expect(record.result.evaluationScore).toBe(1);
      expect(record.result.runId.length).toBeGreaterThan(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("scores below 1 when workspace test script fails", async () => {
    const workspace = tempWorkspace('node -e "process.exit(1)"');
    try {
      const record = await runLiveCodingArchiveWithBackend({
        backend: new StubBackend("- FIX: example"),
        workspace,
      });
      expect(record.result.evaluationScore).toBeLessThan(1);
      expect(record.result.evaluationSignals?.test).toBe(0);
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });

  it("writes archive JSON to disk", () => {
    const dir = mkdtempSync(join(tmpdir(), "aor-archive-"));
    const path = join(dir, "archive.json");
    try {
      writeLiveCodingArchive(path, {
        archivedAt: "2026-06-05T00:00:00.000Z",
        gatewayUrl: "http://127.0.0.1:18789",
        workspace: "/tmp/ws",
        goal: "review",
        mode: "mock-gateway",
        result: {
          runId: "run-1",
          taskType: "coding.review",
          model: "anthropic/claude-opus-4-6",
          evaluationScore: 1,
          totalTokens: 100,
          latencyMs: 50,
          outputPreview: "ok",
        },
      });
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { result: { runId: string } };
      expect(parsed.result.runId).toBe("run-1");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("uses mock gateway fetch for live coding archive", async () => {
    const workspace = tempWorkspace('node -e "process.exit(0)"');
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: "- FIX: example\n- suggest: tests" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      }),
    }));
    try {
      const record = await runLiveCodingArchive({
        gatewayUrl: "http://gateway.test:9999",
        workspace,
        goal: "review repo",
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      expect(record.mode).toBe("mock-gateway");
      expect(record.result.model).toContain("/");
      expect(record.result.evaluationScore).toBe(1);
      expect(fetchImpl).toHaveBeenCalled();
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});
