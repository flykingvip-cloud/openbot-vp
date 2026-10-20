import { describe, expect, it, vi } from "vitest";
import { runWorkbenchNavSelection } from "./workbench-actions.ts";

describe("runWorkbenchNavSelection", () => {
  it("routes assistant clicks to the assistant home session", () => {
    const onPrimaryModuleChange = vi.fn();
    const onTeamSelectedKeyChange = vi.fn();
    const onSelectSession = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "assistant",
        selectionKey: "agent:market:main",
        sourceKey: "agent:market:telegram:direct:alice",
      },
      {
        onPrimaryModuleChange,
        onTeamSelectedKeyChange,
        onSelectSession,
      },
    );

    expect(onPrimaryModuleChange).toHaveBeenCalledWith("assistant");
    expect(onTeamSelectedKeyChange).toHaveBeenCalledWith("agent:market:main");
    expect(onSelectSession).toHaveBeenCalledWith("agent:market:main");
  });

  it("falls back to the selection key when no bound history session exists", () => {
    const onSelectSession = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "assistant",
        selectionKey: "main",
      },
      {
        onPrimaryModuleChange: vi.fn(),
        onTeamSelectedKeyChange: vi.fn(),
        onSelectSession,
      },
    );

    expect(onSelectSession).toHaveBeenCalledWith("main");
  });

  it("opens collaboration history on the scoped mirror, not the space alias", () => {
    const onSelectSession = vi.fn();
    const onTeamSelectedKeyChange = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "collaboration",
        selectionKey: "space:alpha",
        sourceKey: "agent:main:main:space:alpha",
      },
      {
        onPrimaryModuleChange: vi.fn(),
        onTeamSelectedKeyChange,
        onSelectSession,
      },
    );

    expect(onSelectSession).toHaveBeenCalledWith("agent:main:main:space:alpha");
    expect(onTeamSelectedKeyChange).toHaveBeenCalledWith("space:alpha");
    expect(onSelectSession.mock.invocationCallOrder[0]).toBeLessThan(
      onTeamSelectedKeyChange.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
  });

  it("keeps wechat directory source keys off the history session", () => {
    const onSelectSession = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "collaboration",
        selectionKey: "space:product-rd",
        sourceKey: "agent:main:wechat:group:product-rd",
      },
      {
        onPrimaryModuleChange: vi.fn(),
        onTeamSelectedKeyChange: vi.fn(),
        onSelectSession,
      },
    );

    expect(onSelectSession).toHaveBeenCalledWith("space:product-rd");
  });

  it("acknowledges sibling sessions so the unread badge resets after a click", () => {
    const onSelectSession = vi.fn();
    const onAcknowledgeSiblingSessions = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "assistant",
        selectionKey: "agent:bot-2:main",
        siblingSessionKeys: [
          "agent:bot-2:main",
          "agent:bot-2:cron:abc",
          "agent:bot-2:wecom:group:daniel",
          "  ",
          "",
        ],
      },
      {
        onPrimaryModuleChange: vi.fn(),
        onTeamSelectedKeyChange: vi.fn(),
        onSelectSession,
        onAcknowledgeSiblingSessions,
      },
    );

    expect(onSelectSession).toHaveBeenCalledWith("agent:bot-2:main");
    expect(onAcknowledgeSiblingSessions).toHaveBeenCalledTimes(1);
    // The primary session is already acknowledged via the regular session
    // switch path, so the sibling fan-out skips it. Whitespace-only and
    // empty entries are also filtered out so we never write garbage keys
    // into `sessionSeenAt`.
    expect(onAcknowledgeSiblingSessions).toHaveBeenCalledWith([
      "agent:bot-2:cron:abc",
      "agent:bot-2:wecom:group:daniel",
    ]);
  });

  it("skips the sibling acknowledgement when no companion sessions are provided", () => {
    const onAcknowledgeSiblingSessions = vi.fn();

    runWorkbenchNavSelection(
      {
        module: "assistant",
        selectionKey: "agent:main:main",
        siblingSessionKeys: ["agent:main:main"],
      },
      {
        onPrimaryModuleChange: vi.fn(),
        onTeamSelectedKeyChange: vi.fn(),
        onSelectSession: vi.fn(),
        onAcknowledgeSiblingSessions,
      },
    );

    expect(onAcknowledgeSiblingSessions).not.toHaveBeenCalled();
  });
});
