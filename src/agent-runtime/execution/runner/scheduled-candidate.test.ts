import { expect, it, vi } from "vitest";
import { runScheduledCandidate } from "./scheduled-candidate.js";
const cli = vi.hoisted(() => vi.fn(async () => ({ meta: { durationMs: 0 } })));
vi.mock("./cli-run.js", () => ({ runCliAgent: cli }));
vi.mock("../../../agents/model-selection.js", () => ({ isCliProvider: () => true }));
vi.mock("../../model/index.js", () => ({ resolveCliRunCredential: async () => ({}) }));
it("forwards scheduled cancellation to the CLI execution adapter", async () => {
  const controller = new AbortController();
  await runScheduledCandidate(
    {
      run: {
        sessionId: "s",
        sessionFile: "/tmp/s.jsonl",
        workspaceDir: "/tmp",
        prompt: "task",
        timeoutMs: 1000,
        runId: "r",
        config: {},
        agentId: "main",
        provider: "codex-cli",
        model: "test",
        abortSignal: controller.signal,
      },
      ledgerEnabled: false,
      freshSession: true,
      sessionEntry: { sessionId: "s", updatedAt: 0 },
      tenantId: "test",
    },
    { recordWarnings: vi.fn(), recordUsage: vi.fn() },
  );
  expect(cli).toHaveBeenCalledWith(expect.objectContaining({ abortSignal: controller.signal }));
});
