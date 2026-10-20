import { describe, expect, it } from "vitest";
import {
  latestTurnHasAssistantReply,
  mergeIncomingHistoryWithLocalUserTurn,
} from "./merge-local-user-history.ts";

describe("mergeIncomingHistoryWithLocalUserTurn", () => {
  it("keeps the local user instruction when history returns only assistant results", () => {
    const local = [
      { id: "old", role: "user", content: [{ type: "text", text: "earlier" }] },
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "请检索订单参谋 MCP" }],
      },
    ];
    const incoming = [{ role: "assistant", content: [{ type: "text", text: "检索情况" }] }];

    expect(mergeIncomingHistoryWithLocalUserTurn(local, incoming)).toEqual([
      local[0],
      local[1],
      incoming[0],
    ]);
  });

  it("uses server history when it already contains the same user turn", () => {
    const local = [
      {
        id: "local-run-1",
        role: "user",
        content: [{ type: "text", text: "请检索订单参谋 MCP" }],
      },
    ];
    const incoming = [
      { id: "persisted", role: "user", content: [{ type: "text", text: "请检索订单参谋 MCP" }] },
      { role: "assistant", content: [{ type: "text", text: "检索情况" }] },
    ];

    expect(mergeIncomingHistoryWithLocalUserTurn(local, incoming)).toEqual(incoming);
  });

  it("keeps the local new-robot greeting until a model assistant reply arrives", () => {
    const opening = {
      id: "local-growth-opening-agent:helper:main",
      role: "assistant",
      content: [{ type: "text", text: "你好，我是邮件助理。" }],
    };
    const incomingUser = [{ role: "user", content: [{ type: "text", text: "\u200b" }] }];
    expect(mergeIncomingHistoryWithLocalUserTurn([opening], incomingUser)).toEqual([
      opening,
      incomingUser[0],
    ]);
    const modelReply = [{ role: "assistant", content: [{ type: "text", text: "我是邮件助理。" }] }];
    expect(mergeIncomingHistoryWithLocalUserTurn([opening], modelReply)).toEqual(modelReply);
  });
});

describe("latestTurnHasAssistantReply", () => {
  it("is false until an assistant lands after the latest user", () => {
    expect(
      latestTurnHasAssistantReply([{ role: "user", content: [{ type: "text", text: "task" }] }]),
    ).toBe(false);
    expect(
      latestTurnHasAssistantReply([
        { role: "user", content: [{ type: "text", text: "task" }] },
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ]),
    ).toBe(true);
  });
});
