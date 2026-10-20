import { describe, expect, it, vi } from "vitest";
import {
  createLifecycleSkillToolAttributionHandler,
  resolveLifecycleSkillNamesLoaded,
} from "./lifecycle-tool-attribution.js";

const recordStart = vi.fn();
const recordResult = vi.fn();

vi.mock("./record.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./record.js")>();
  return {
    ...actual,
    recordLifecycleSkillToolStart: (...args: unknown[]) => recordStart(...args),
    recordLifecycleSkillToolResult: (...args: unknown[]) => recordResult(...args),
  };
});

describe("lifecycle tool attribution handler", () => {
  it("filters lifecycle binding skill names", () => {
    expect(resolveLifecycleSkillNamesLoaded(["weather", "ob-asset-s1", "notes"])).toEqual([
      "ob-asset-s1",
    ]);
  });

  it("records start and result for tool stream events", () => {
    recordStart.mockClear();
    recordResult.mockClear();
    const forwarded: unknown[] = [];
    const handler = createLifecycleSkillToolAttributionHandler(
      {
        agentId: "robot-a",
        runId: "run-1",
        sessionKey: "agent:robot-a:main",
        loadedSkillNames: ["ob-asset-s1"],
      },
      {
        onAgentEvent: (evt) => {
          forwarded.push(evt);
        },
      },
    );

    handler({
      stream: "tool",
      data: {
        phase: "start",
        name: "notes",
        toolCallId: "call-1",
        args: { openbotSkillId: "skill-1" },
        startedAt: 1000,
      },
    });
    handler({
      stream: "tool",
      data: {
        phase: "result",
        name: "notes",
        toolCallId: "call-1",
        isError: false,
      },
    });
    handler({ stream: "assistant", data: { text: "hi" } });

    expect(recordStart).toHaveBeenCalledOnce();
    expect(recordResult).toHaveBeenCalledOnce();
    expect(forwarded).toHaveLength(3);
  });

  it("reads selectedSkillId from event data when present", () => {
    recordStart.mockClear();
    const handler = createLifecycleSkillToolAttributionHandler({
      agentId: "robot-a",
      runId: "run-2",
      loadedSkillNames: ["ob-asset-s1"],
    });
    handler({
      stream: "tool",
      data: {
        phase: "start",
        name: "notes",
        toolCallId: "call-2",
        selectedSkillId: "skill-from-event",
      },
    });
    expect(recordStart.mock.calls[0]?.[0]?.selectedSkillId).toBe("skill-from-event");
  });
});
