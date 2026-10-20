import { describe, expect, it } from "vitest";
import {
  omitParkedPriorTurns,
  omitTaskStatusSeparators,
  transcriptEntriesForInboundTurn,
} from "../../conversation-task/focus-switch.js";
import { boundChatHistoryMessages } from "./chat.js";

function visibleText(message: unknown): string {
  if (!message || typeof message !== "object") {
    return "";
  }
  const content = (message as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .join("");
}

describe("task status separator order", () => {
  it("keeps the user sentence before the park notice in refreshed history and out of model context", () => {
    const userText = "现在改做供应商合同审查";
    const statusLine = "已挂起「竞品价格」，开始「供应商合同审查」。";
    const entries = transcriptEntriesForInboundTurn({
      userMessage: {
        role: "user",
        content: [{ type: "text", text: userText }],
        contextCut: true,
      },
      taskStatusLine: statusLine,
    });
    const history = boundChatHistoryMessages({
      rawMessages: [
        { role: "user", content: [{ type: "text", text: "生成今日竞品价格检查结果" }] },
        { role: "assistant", content: [{ type: "text", text: "价格还在查" }] },
        ...entries,
      ],
      limit: 20,
      includeTools: true,
      historyCursorEnabled: false,
    });
    const texts = history.messages.map(visibleText);
    const userAt = texts.findIndex((text) => text.includes(userText));
    const statusAt = texts.findIndex((text) => text.includes("已挂起"));
    expect(userAt).toBeGreaterThanOrEqual(0);
    expect(statusAt).toBeGreaterThan(userAt);
    expect(history.messages[statusAt]).toMatchObject({ role: "system", taskStatusSeparator: true });

    const model = omitTaskStatusSeparators(omitParkedPriorTurns(entries));
    expect(model).toHaveLength(1);
    expect(model[0]).toMatchObject({ role: "user", contextCut: true });
    expect(JSON.stringify(model)).not.toContain("已挂起");
    expect(JSON.stringify(model)).not.toContain("开始");
  });
});
