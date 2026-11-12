import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

import { readLatestAssistantReply } from "./agent-step.js";

describe("readLatestAssistantReply", () => {
  it("does not return a historical reply for a new send with no fresh output", async () => {
    callGatewayMock.mockResolvedValue({
      messages: [
        { role: "assistant", timestamp: 100, content: [{ type: "text", text: "上周已完成" }] },
        { role: "assistant", timestamp: 300, content: [] },
      ],
    });
    expect(
      await readLatestAssistantReply({ sessionKey: "agent:peer:main", afterMs: 200 }),
    ).toBeUndefined();
  });
  it("accepts a fresh timestamped reply and rejects unknown freshness", async () => {
    callGatewayMock.mockResolvedValue({
      messages: [
        { role: "assistant", timestamp: 300, content: [{ type: "text", text: "明天参加" }] },
        { role: "assistant", content: [{ type: "text", text: "不明轮次" }] },
      ],
    });
    expect(await readLatestAssistantReply({ sessionKey: "agent:peer:main", afterMs: 200 })).toBe(
      "明天参加",
    );
  });
  beforeEach(() => {
    callGatewayMock.mockClear();
  });

  it("returns the most recent assistant message when compaction markers trail history", async () => {
    callGatewayMock.mockResolvedValue({
      messages: [
        {
          role: "assistant",
          content: [{ type: "text", text: "All checks passed and changes were pushed." }],
        },
        { role: "toolResult", content: [{ type: "text", text: "tool output" }] },
        { role: "system", content: [{ type: "text", text: "Compaction" }] },
      ],
    });

    const result = await readLatestAssistantReply({ sessionKey: "agent:main:child" });

    expect(result).toBe("All checks passed and changes were pushed.");
    expect(callGatewayMock).toHaveBeenCalledWith({
      method: "chat.history",
      params: { sessionKey: "agent:main:child", limit: 50 },
    });
  });

  it("falls back to older assistant text when latest assistant has no text", async () => {
    callGatewayMock.mockResolvedValue({
      messages: [
        { role: "assistant", content: [{ type: "text", text: "older output" }] },
        { role: "assistant", content: [] },
        { role: "system", content: [{ type: "text", text: "Compaction" }] },
      ],
    });

    const result = await readLatestAssistantReply({ sessionKey: "agent:main:child" });

    expect(result).toBe("older output");
  });
});
