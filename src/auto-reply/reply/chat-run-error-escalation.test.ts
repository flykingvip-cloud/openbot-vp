import { describe, expect, it, vi } from "vitest";
import { noteUnresolvedChatRunError } from "./chat-run-error-escalation.js";
import type { RecordExperienceParams } from "./experience-capsule-backflow.js";

describe("noteUnresolvedChatRunError", () => {
  it("records a task_failure capsule for an unresolved runtime error", () => {
    const record = vi.fn<(params: RecordExperienceParams) => void>();
    noteUnresolvedChatRunError(
      {
        sessionKey: "agent:market:main",
        errorMessage: "Cannot read properties of undefined (reading 'length')",
      },
      {
        record,
        loadSession: () => ({ entry: undefined }),
      },
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]).toMatchObject({
      trigger: "task_failure",
      agentId: "market",
      reason: "undefined_property",
      sessionKey: "agent:market:main",
      detail: "Cannot read properties of undefined (reading 'length')",
    });
  });

  it("does not escalate a failure the chat instruction can resolve", () => {
    const record = vi.fn<(params: RecordExperienceParams) => void>();
    noteUnresolvedChatRunError(
      {
        sessionKey: "agent:market:main",
        errorMessage: "No API key for provider: demo",
      },
      { record, loadSession: () => ({ entry: undefined }) },
    );
    expect(record).not.toHaveBeenCalled();
  });

  it("still records when session lookup throws", () => {
    const record = vi.fn<(params: RecordExperienceParams) => void>();
    noteUnresolvedChatRunError(
      {
        sessionKey: "agent:market:main",
        errorMessage: "TypeError: value is not iterable",
      },
      {
        record,
        loadSession: () => {
          throw new Error("disk");
        },
      },
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0]?.[0]?.reason).toBe("chat_run_error");
  });

  it("swallows a writer failure so the chat broadcast can continue", () => {
    expect(() =>
      noteUnresolvedChatRunError(
        {
          sessionKey: "agent:market:main",
          errorMessage: "Cannot read properties of undefined (reading 'length')",
        },
        {
          record: () => {
            throw new Error("store down");
          },
          loadSession: () => ({ entry: undefined }),
        },
      ),
    ).not.toThrow();
  });
});
