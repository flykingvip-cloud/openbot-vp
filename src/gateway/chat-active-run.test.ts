import { describe, expect, it } from "vitest";
import { listActiveSessionChatRunIds, resolveActiveSessionChatRun } from "./chat-active-run.js";

function entry(sessionKey: string, startedAtMs: number, aborted = false) {
  return {
    sessionKey,
    startedAtMs,
    controller: { signal: { aborted } },
  };
}

describe("resolveActiveSessionChatRun", () => {
  it("returns the buffered visible text for the session run", () => {
    const chatAbortControllers = new Map([
      ["run-1", entry("agent:main:main", 10)],
      ["run-other", entry("agent:other:main", 20)],
    ]);
    const chatRunBuffers = new Map([["run-1", "正在写周报"]]);

    expect(
      resolveActiveSessionChatRun({
        sessionKeys: ["agent:main:main"],
        chatAbortControllers,
        chatRunBuffers,
      }),
    ).toEqual({ runId: "run-1", text: "正在写周报" });
  });

  it("prefers the parent run id and falls back to a child buffer", () => {
    const chatAbortControllers = new Map([
      ["round-1", entry("space:alpha", 10)],
      ["round-1:bot-2", entry("space:alpha", 30)],
      ["round-1:bot-3", entry("space:alpha", 20)],
    ]);
    const chatRunBuffers = new Map([["round-1:bot-2", "市场侧已完成"]]);

    expect(
      resolveActiveSessionChatRun({
        sessionKeys: ["space:alpha"],
        chatAbortControllers,
        chatRunBuffers,
      }),
    ).toEqual({ runId: "round-1", text: "市场侧已完成" });
    expect(
      listActiveSessionChatRunIds({
        sessionKeys: ["space:alpha"],
        chatAbortControllers,
      }).toSorted(),
    ).toEqual(["round-1", "round-1:bot-2", "round-1:bot-3"]);
  });

  it("ignores aborted controllers and other sessions", () => {
    const chatAbortControllers = new Map([
      ["run-dead", entry("main", 50, true)],
      ["run-live", entry("other", 10)],
    ]);

    expect(
      resolveActiveSessionChatRun({
        sessionKeys: ["main"],
        chatAbortControllers,
        chatRunBuffers: new Map([["run-dead", "partial"]]),
      }),
    ).toBeNull();
  });

  it("does not resume scratchpad text as the visible buffer", () => {
    const chatAbortControllers = new Map([["run-1", entry("main", 10)]]);
    const chatRunBuffers = new Map([["run-1", "Let me inspect the files before I answer."]]);

    expect(
      resolveActiveSessionChatRun({
        sessionKeys: ["main"],
        chatAbortControllers,
        chatRunBuffers,
      }),
    ).toEqual({ runId: "run-1", text: "" });
  });

  it("picks the newest run when several are active in the session", () => {
    const chatAbortControllers = new Map([
      ["run-old", entry("main", 10)],
      ["run-new", entry("main", 40)],
    ]);

    expect(
      resolveActiveSessionChatRun({
        sessionKeys: [" main "],
        chatAbortControllers,
        chatRunBuffers: new Map([
          ["run-old", "old"],
          ["run-new", "new"],
        ]),
      }),
    ).toEqual({ runId: "run-new", text: "new" });
  });
});
