import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { createExecutionJournalRuntime } from "./execution-journal-runtime.js";
import { createExecutionJournal } from "./execution-journal.js";
const roots: string[] = [];
const scope = {
  kind: "personal",
  personalDomainId: "d",
  subjectRef: "s",
  authzScopeRef: "a",
} as const;
const fact = {
  eventId: "start",
  taskId: "task",
  runId: "run",
  scope,
  occurredAt: 100,
  stage: "started",
} as const;
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "journal-runtime-"));
  roots.push(root);
  const journal = createExecutionJournal({ rootDir: root, enabled: () => true, now: () => 100 });
  return { root, journal };
}
describe("best effort durable journal runtime", () => {
  it("defaults off without disk reads or writes", async () => {
    const { journal } = await setup();
    const append = vi.spyOn(journal, "appendFact");
    const read = vi.spyOn(journal, "query");
    const runtime = createExecutionJournalRuntime({ journal });
    expect(runtime.recordFact({ agentId: "bot", fact })).toBe(false);
    await runtime.query({ agentId: "bot", scope });
    expect(append).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("serializes facts before links and reloads persisted evidence after restart", async () => {
    const { journal, root } = await setup();
    const runtime = createExecutionJournalRuntime({ journal, enabled: () => true });
    expect(runtime.recordFact({ agentId: "bot", fact })).toBe(true);
    runtime.recordLink({
      agentId: "bot",
      receipt: {
        receiptId: "link",
        taskId: "task",
        runId: "run",
        scope,
        outcomeVersion: 1,
        attemptId: "a",
        attemptGranularity: "turn",
        eventIds: ["start"],
      },
    });
    await runtime.flush();
    const restarted = createExecutionJournalRuntime({
      journal: createExecutionJournal({ rootDir: root, enabled: () => true, now: () => 100 }),
      enabled: () => true,
    });
    const result = await restarted.query({ agentId: "bot", scope });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.facts).toHaveLength(1);
      expect(result.links).toHaveLength(1);
    }
  });
  it("isolates clone errors, throwing flags and queue overload as unknown", async () => {
    const { journal } = await setup();
    const throwing = createExecutionJournalRuntime({
      journal,
      enabled: () => {
        throw new Error("flag");
      },
    });
    expect(() => throwing.recordFact({ agentId: "bot", fact })).not.toThrow();
    expect((await throwing.query({ agentId: "bot", scope })).ok).toBe(false);
    const runtime = createExecutionJournalRuntime({
      journal,
      enabled: () => true,
      queueCapacity: 1,
    });
    expect(
      runtime.recordFact({ agentId: "bot", fact: { ...fact, extra: () => {} } as typeof fact }),
    ).toBe(false);
    runtime.recordFact({ agentId: "bot", fact });
    expect(runtime.recordFact({ agentId: "bot", fact })).toBe(false);
    await runtime.flush();
    expect(await runtime.query({ agentId: "bot", scope })).toMatchObject({
      ok: false,
      reason: "journal_write_unknown",
    });
  });
});
