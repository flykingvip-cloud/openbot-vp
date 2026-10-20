import { describe, expect, it } from "vitest";
import {
  applyWorkProgress,
  emptyWorkProgressState,
  labelForWorkProgressPhase,
  reduceWorkProgress,
  type WorkProgressInput,
  type WorkProgressState,
} from "./work-progress-phase.ts";

function run(events: WorkProgressInput[], start: WorkProgressState = emptyWorkProgressState()) {
  return events.reduce(reduceWorkProgress, start);
}

function label(state: WorkProgressState) {
  return labelForWorkProgressPhase(state.phase);
}

describe("work progress phase mapping", () => {
  it("shows 正在思考 when the turn starts and nothing has streamed yet", () => {
    expect(label(run([{ type: "turn-start" }]))).toBe("正在思考");
    expect(
      label(
        run([
          {
            type: "agent",
            event: { stream: "lifecycle", data: { phase: "start" } },
          },
        ]),
      ),
    ).toBe("正在思考");
    expect(label(run([{ type: "chat", state: "thinking", hasVisibleText: false }]))).toBe(
      "正在思考",
    );
  });

  it("shows 正在起草 while assistant text is produced", () => {
    const state = run([
      { type: "turn-start" },
      {
        type: "agent",
        event: { stream: "assistant", data: { text: "草稿", delta: "草稿" } },
      },
    ]);
    expect(label(state)).toBe("正在起草");
    expect(
      label(run([{ type: "turn-start" }, { type: "chat", state: "delta", hasVisibleText: true }])),
    ).toBe("正在起草");
  });

  it("shows 正在验证 while a tool call is in progress", () => {
    const state = run([
      { type: "turn-start" },
      {
        type: "agent",
        event: { stream: "tool", data: { phase: "start", name: "read" } },
      },
    ]);
    expect(label(state)).toBe("正在验证");
    expect(
      label(
        run(
          [
            {
              type: "agent",
              event: { stream: "tool", data: { phase: "update", name: "read" } },
            },
          ],
          state,
        ),
      ),
    ).toBe("正在验证");
  });

  it("keeps verifying until every in-flight tool finishes", () => {
    const state = run([
      {
        type: "agent",
        event: { stream: "tool", data: { phase: "start", toolCallId: "a" } },
      },
      {
        type: "agent",
        event: { stream: "tool", data: { phase: "start", toolCallId: "b" } },
      },
      {
        type: "agent",
        event: { stream: "tool", data: { phase: "result", toolCallId: "a" } },
      },
    ]);
    expect(label(state)).toBe("正在验证");
    expect(state.toolsInFlight).toBe(1);
  });

  it("shows 正在整理 after tool work and clears it on the final reply", () => {
    const afterTools = run([
      { type: "turn-start" },
      { type: "agent", event: { stream: "tool", data: { phase: "start", name: "web_fetch" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result", name: "web_fetch" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "start", name: "write" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result", name: "write" } } },
    ]);
    expect(label(afterTools)).toBe("正在整理");
    expect(afterTools.toolsInFlight).toBe(0);

    const drafting = run(
      [
        {
          type: "agent",
          event: { stream: "assistant", data: { text: "写好了", delta: "写好了" } },
          hasVisibleText: true,
        },
      ],
      afterTools,
    );
    expect(label(drafting)).toBe("正在起草");

    const cleared = run([{ type: "chat", state: "final", hasVisibleText: true }], drafting);
    expect(label(cleared)).toBeNull();
    expect(cleared.toolsInFlight).toBe(0);
  });

  it("reaches 正在整理 when tool work is followed directly by the final reply", () => {
    const afterTools = run([
      { type: "turn-start" },
      { type: "agent", event: { stream: "tool", data: { phase: "start", name: "web_fetch" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result", name: "web_fetch" } } },
    ]);
    expect(label(afterTools)).toBe("正在整理");
    expect(label(run([{ type: "chat", state: "final" }], afterTools))).toBeNull();
  });

  it("does not show 正在整理 on a turn that never runs a tool", () => {
    const state = run([
      { type: "turn-start" },
      {
        type: "agent",
        event: { stream: "assistant", data: { text: "直接回复", delta: "直接回复" } },
      },
    ]);
    expect(label(state)).toBe("正在起草");
    expect(label(state)).not.toBe("正在整理");
  });

  it("keeps 正在整理 if a duplicate tool result arrives after the tools have drained", () => {
    const state = run([
      { type: "agent", event: { stream: "tool", data: { phase: "start" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result" } } },
    ]);
    expect(label(state)).toBe("正在整理");
  });

  it("still shows 正在整理 for compaction close-out before the visible reply", () => {
    const state = run([
      { type: "agent", event: { stream: "tool", data: { phase: "start" } } },
      { type: "agent", event: { stream: "tool", data: { phase: "result" } } },
      { type: "agent", event: { stream: "compaction", data: { phase: "start" } } },
    ]);
    expect(label(state)).toBe("正在整理");
    const settled = run(
      [
        {
          type: "agent",
          event: { stream: "compaction", data: { phase: "end", willRetry: false } },
        },
      ],
      state,
    );
    expect(label(settled)).toBe("正在整理");
  });

  it("leaves wrapping when compaction retries or visible text resumes", () => {
    const wrapping = run([
      { type: "agent", event: { stream: "compaction", data: { phase: "start" } } },
    ]);
    expect(
      label(
        run(
          [
            {
              type: "agent",
              event: { stream: "compaction", data: { phase: "end", willRetry: true } },
            },
          ],
          wrapping,
        ),
      ),
    ).toBe("正在思考");
    expect(
      label(
        run(
          [
            {
              type: "agent",
              event: { stream: "assistant", data: { text: "结论", delta: "结论" } },
            },
          ],
          wrapping,
        ),
      ),
    ).toBe("正在起草");
  });

  it("does not let a later lifecycle start erase drafting or verifying", () => {
    const drafting = run([
      {
        type: "agent",
        event: { stream: "assistant", data: { text: "在写", delta: "在写" } },
      },
    ]);
    expect(
      label(
        run(
          [{ type: "agent", event: { stream: "lifecycle", data: { phase: "start" } } }],
          drafting,
        ),
      ),
    ).toBe("正在起草");
    const verifying = run([{ type: "agent", event: { stream: "tool", data: { phase: "start" } } }]);
    expect(
      label(
        run(
          [
            { type: "chat", state: "thinking" },
            { type: "chat", state: "delta", hasVisibleText: true },
          ],
          verifying,
        ),
      ),
    ).toBe("正在验证");
  });

  it("clears on lifecycle end, error, abort, and chat terminal states", () => {
    const active = run([{ type: "turn-start" }]);
    for (const input of [
      { type: "agent", event: { stream: "lifecycle", data: { phase: "end" } } },
      { type: "agent", event: { stream: "lifecycle", data: { phase: "error" } } },
      { type: "agent", event: { stream: "lifecycle", data: { phase: "end", aborted: true } } },
      { type: "chat", state: "final" },
      { type: "chat", state: "aborted" },
      { type: "chat", state: "error" },
      { type: "clear" },
    ] satisfies WorkProgressInput[]) {
      expect(label(run([input], active))).toBeNull();
    }
  });

  it("does not change the label when the same non-terminal event is repeated", () => {
    const thinking = run([{ type: "turn-start" }]);
    const again = run(
      [{ type: "agent", event: { stream: "lifecycle", data: { phase: "start" } } }],
      thinking,
    );
    expect(again).toEqual(thinking);
  });

  it("writes the label onto a host and clears it without touching other fields", () => {
    const host = {
      workProgressPhase: null as "thinking" | "drafting" | "verifying" | "wrapping" | null,
      workProgressToolsInFlight: 0,
      chatMessages: [{ role: "assistant", text: "keep" }],
    };
    applyWorkProgress(host, { type: "turn-start" });
    expect(labelForWorkProgressPhase(host.workProgressPhase)).toBe("正在思考");
    expect(host.chatMessages).toEqual([{ role: "assistant", text: "keep" }]);
    applyWorkProgress(host, { type: "chat", state: "final" });
    expect(host.workProgressPhase).toBeNull();
    expect(host.workProgressToolsInFlight).toBe(0);
  });

  it("ignores hosts that do not track work progress", () => {
    const host = { chatStream: "" };
    applyWorkProgress(host, { type: "turn-start" });
    expect(host).toEqual({ chatStream: "" });
  });
});
