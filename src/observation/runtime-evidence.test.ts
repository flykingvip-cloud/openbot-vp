import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ChatTaskOutcomeAdapter } from "../task-outcome/entrypoints/chat.js";
import { TaskOutcomeResultService } from "../task-outcome/result-service.js";
import { DurableTaskOutcomeStore } from "../task-outcome/store.js";
import { createExecutionEvidenceStore } from "./execution-evidence-store.js";
import { createExecutionJournalRuntime } from "./execution-journal-runtime.js";
import { createExecutionJournal } from "./execution-journal.js";
import { createOutcomeSourceStore } from "./outcome-source.js";
import { createRuntimeEvidenceObserver } from "./runtime-evidence.js";
const scope = {
  kind: "personal",
  personalDomainId: "domain",
  subjectRef: "subject:a",
  authzScopeRef: "auth",
} as const;
let root = "";
afterEach(() => {
  if (root) {
    fs.rmSync(root, { recursive: true, force: true });
    root = "";
  }
});
describe("actual execution to actual version receipt", () => {
  it.each(["succeeded", "failed", "cancelled"] as const)(
    "links captured %s execution only after the real ResultService commits its attempt",
    (status) => {
      const evidence = createExecutionEvidenceStore({ enabled: () => true });
      const sources = createOutcomeSourceStore({ enabled: () => true });
      const observer = createRuntimeEvidenceObserver(
        {
          taskId: "task",
          scope,
          runId: "run",
          source: { provenance: "injected", collector: "test" },
        },
        evidence,
        sources,
      );
      observer.capture("started");
      observer.capture(status === "succeeded" ? "completed" : status);
      root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-evidence-"));
      const durable = new DurableTaskOutcomeStore(root);
      const service = new TaskOutcomeResultService({ store: durable });
      const chat = new ChatTaskOutcomeAdapter(service);
      const opened = chat.createOrRestore({ taskId: "task", scope, taskContractVersion: "test" });
      if (!opened.ok) {
        throw new Error("create_failed");
      }
      expect(observer.bind(opened.record)).toBe(false);
      const committed = chat.recordAttempt(
        "task",
        opened.record.outcomeVersion,
        opened.fencingToken,
        {
          attemptId: "actual-attempt",
          runId: "run",
          status,
          observedAt: new Date().toISOString(),
        },
        {
          runId: "run",
          attemptIds: ["actual-attempt"],
          effectiveAttemptId: "actual-attempt",
          fencingToken: opened.fencingToken,
          status,
        },
        { scope },
      );
      if (!committed.ok) {
        throw new Error("commit_failed");
      }
      expect(observer.bind({ ...committed.record, scope: { ...scope, subjectRef: "other" } })).toBe(
        false,
      );
      const startOnly = createRuntimeEvidenceObserver(
        {
          taskId: "task",
          scope,
          runId: "run",
          source: { provenance: "injected", collector: "test" },
        },
        evidence,
      );
      startOnly.capture("started");
      expect(startOnly.bind(committed.record)).toBe(false);
      expect(observer.bind(committed.record, { agentId: "bot", provenance: "injected" })).toBe(
        true,
      );
      expect(sources.query("bot", committed.record).provenance).toBe("injected");
      expect(observer.bind(committed.record)).toBe(true);
      expect(evidence.query(scope).links).toHaveLength(1);
      expect(evidence.query(scope).links[0]).toMatchObject({
        outcomeVersion: committed.record.outcomeVersion,
        attemptId: "actual-attempt",
        attemptGranularity: "turn",
      });
      expect(evidence.query(scope).facts.map((f) => f.stage)).toEqual([
        "started",
        status === "succeeded" ? "completed" : status,
        "started",
      ]);
      expect(
        createRuntimeEvidenceObserver(
          {
            taskId: "task",
            scope,
            runId: "run",
            source: { provenance: "injected", collector: "test" },
          },
          evidence,
        ).bind(committed.record),
      ).toBe(false);
    },
  );
  it("preserves failures and cancellation without fabricating facts when disabled", () => {
    const enabled = createExecutionEvidenceStore({ enabled: () => true });
    const observer = createRuntimeEvidenceObserver(
      {
        taskId: "task",
        scope,
        runId: "run",
        source: { provenance: "injected", collector: "test" },
      },
      enabled,
    );
    observer.capture("failed");
    observer.capture("cancelled");
    expect(enabled.query(scope).facts.map((f) => f.stage)).toEqual(["failed", "cancelled"]);
    const disabled = createExecutionEvidenceStore({ enabled: () => false });
    createRuntimeEvidenceObserver(
      {
        taskId: "task",
        scope,
        runId: "run",
        source: { provenance: "injected", collector: "test" },
      },
      disabled,
    ).capture("started");
    expect(disabled.query(scope).facts).toEqual([]);
  });
  it("persists an unfinished independent start when agent identity is known", async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "runtime-durable-start-"));
    const journal = createExecutionJournal({ rootDir: root, enabled: () => true });
    const runtime = createExecutionJournalRuntime({ journal, enabled: () => true });
    const observer = createRuntimeEvidenceObserver(
      {
        taskId: "task",
        agentId: "bot",
        scope,
        runId: "run",
        source: { provenance: "injected", collector: "test" },
      },
      createExecutionEvidenceStore({ enabled: () => true }),
      createOutcomeSourceStore({ enabled: () => true }),
      runtime,
    );
    observer.capture("started");
    await runtime.flush();
    const result = await runtime.query({ agentId: "bot", scope });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.facts.map((f) => f.stage)).toEqual(["started"]);
      expect(result.links).toEqual([]);
    }
  });
});
