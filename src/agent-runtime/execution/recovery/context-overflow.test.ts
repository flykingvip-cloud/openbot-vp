import { expect, it, vi } from "vitest";
import { recoverContextOverflow } from "./context-overflow.js";
const input = () => ({
  contextOverflowError: { text: "context window exceeded", source: "promptError" },
  attempt: { messagesSnapshot: [] },
  ports: {
    isCompactionFailureError: (text: string) => text.includes("compaction failed"),
    log: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), isEnabled: () => false },
    hasOversized: vi.fn(() => false),
    truncate: vi.fn(async () => ({ truncated: false, truncatedCount: 0 })),
  },
  attemptCompactionCount: 1,
  params: { sessionId: "s", sessionFile: "/tmp/unused-overflow-session" },
  provider: "test",
  modelId: "test",
  ctxInfo: { tokens: 100 },
  createDiagId: () => "diag",
  compact: vi.fn(async () => ({ compacted: true })),
  overflowCompactionAttempts: 0,
  toolResultTruncationAttempted: false,
  autoCompactionCount: 0,
  MAX_OVERFLOW_COMPACTION_ATTEMPTS: 3,
});
it("does not compact again after SDK compaction", async () => {
  const params = input();
  const result = await recoverContextOverflow(params);
  expect(result.action).toBe("retry");
  expect(result.overflowCompactionAttempts).toBe(1);
  expect(params.compact).not.toHaveBeenCalled();
});
it("bounds repeated SDK recovery without resetting the cap", async () => {
  const params = { ...input(), overflowCompactionAttempts: 3, toolResultTruncationAttempted: true };
  const result = await recoverContextOverflow(params);
  expect(result.action).toBe("terminal");
  expect(result.overflowCompactionAttempts).toBe(3);
  expect(params.compact).not.toHaveBeenCalled();
});
it("counts successful explicit compaction and returns to the caller loop", async () => {
  const params = { ...input(), attemptCompactionCount: 0 };
  const result = await recoverContextOverflow(params);
  expect(result.action).toBe("retry");
  expect(result.autoCompactionCount).toBe(1);
  expect(params.compact).toHaveBeenCalledWith({ diagId: "diag", attemptNumber: 1 });
});
