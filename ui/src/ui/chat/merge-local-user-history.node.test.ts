import { describe, expect, it } from "vitest";
import {
  isOptimisticLocalUserMessage,
  latestTurnHasAssistantReply,
  mergeIncomingHistoryWithLocalUserTurn,
} from "./merge-local-user-history.ts";

describe("mergeIncomingHistoryWithLocalUserTurn", () => {
  it("keeps an in-flight local user row when history has not caught up", () => {
    const local = [
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "build the report" }],
      },
    ];
    const incoming = [
      {
        id: "asst-1",
        role: "assistant",
        content: [{ type: "text", text: "working" }],
      },
    ];
    expect(mergeIncomingHistoryWithLocalUserTurn(local, incoming)).toEqual([local[0], incoming[0]]);
  });

  it("drops the optimistic row once history echoes the same local-* id", () => {
    const local = [
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "build the report" }],
      },
    ];
    const incoming = [
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "build the report" }],
        senderLabel: "CEO",
      },
      {
        id: "asst-1",
        role: "assistant",
        content: [{ type: "text", text: "done" }],
      },
    ];
    expect(mergeIncomingHistoryWithLocalUserTurn(local, incoming)).toEqual(incoming);
  });

  it("keeps a new same-text send when history only has an older non-local duplicate", () => {
    // Owner repro: history already has old "继续"; user sends new "继续";
    // refresh returns only the old persisted row → must NOT drop the new bubble.
    const local = [
      {
        id: "local-run-new",
        role: "user",
        content: [{ type: "text", text: "继续" }],
      },
    ];
    const incoming = [
      {
        id: "persisted-old-继续",
        role: "user",
        content: [{ type: "text", text: "继续" }],
        senderLabel: "CEO",
      },
    ];
    const merged = mergeIncomingHistoryWithLocalUserTurn(local, incoming);
    expect(merged.some((m) => (m as { id?: string }).id === "local-run-new")).toBe(true);
    // Must not collapse to history-only (pre-fix dropped the optimistic row).
    expect(merged).not.toEqual(incoming);
  });

  it("recognizes optimistic local user ids", () => {
    expect(
      isOptimisticLocalUserMessage({
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }),
    ).toBe(true);
    expect(
      isOptimisticLocalUserMessage({
        id: "persisted-1",
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }),
    ).toBe(false);
  });

  it("detects whether the latest user turn already has an assistant reply", () => {
    expect(
      latestTurnHasAssistantReply([
        { role: "user", content: [{ type: "text", text: "a" }] },
        { role: "assistant", content: [{ type: "text", text: "b" }] },
      ]),
    ).toBe(true);
    expect(
      latestTurnHasAssistantReply([{ role: "user", content: [{ type: "text", text: "a" }] }]),
    ).toBe(false);
  });

  it("keeps local growth openings when history has no model assistant yet", () => {
    const local = [
      {
        id: "local-growth-opening-agent:helper:main",
        role: "assistant",
        content: [{ type: "text", text: "opening" }],
      },
    ];
    const incoming = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
    expect(mergeIncomingHistoryWithLocalUserTurn(local, incoming)).toEqual([local[0], incoming[0]]);
  });

  it("keeps in-flight local bubble when only older duplicate text exists in history", () => {
    const local = [
      {
        id: "local-older",
        role: "user",
        content: [{ type: "text", text: "你好" }],
      },
      {
        id: "asst-1",
        role: "assistant",
        content: [{ type: "text", text: "在" }],
      },
      {
        id: "local-run-new",
        role: "user",
        content: [{ type: "text", text: "你好" }],
      },
    ];
    const incoming = [
      {
        id: "local-older",
        role: "user",
        content: [{ type: "text", text: "你好" }],
        senderLabel: "CEO",
      },
      {
        id: "asst-1",
        role: "assistant",
        content: [{ type: "text", text: "在" }],
      },
    ];
    const merged = mergeIncomingHistoryWithLocalUserTurn(local, incoming);
    expect(merged.some((m) => (m as { id?: string }).id === "local-run-new")).toBe(true);
  });
});
