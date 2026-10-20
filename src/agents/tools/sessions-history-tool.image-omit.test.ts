import { beforeEach, describe, expect, it, vi } from "vitest";

const callGatewayMock = vi.fn();
vi.mock("../../gateway/call.js", () => ({
  callGateway: (opts: unknown) => callGatewayMock(opts),
}));

vi.mock("../../config/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/config.js")>();
  return {
    ...actual,
    loadConfig: () => ({
      session: {
        mainKey: "main",
        scope: "per-sender",
        agentToAgent: { maxPingPongTurns: 2 },
      },
      tools: {
        sessions: { visibility: "all" },
      },
    }),
    resolveGatewayPort: () => 18789,
  };
});

import "../test-helpers/fast-core-tools.js";
import { createOpenClawTools } from "../openclaw-tools.js";

const PLACEHOLDER = "[sessions_history omitted: message too large]";

function historyTool() {
  const tool = createOpenClawTools().find((candidate) => candidate.name === "sessions_history");
  if (!tool) {
    throw new Error("missing sessions_history tool");
  }
  return tool;
}

describe("sessions_history newest-message image omit", () => {
  beforeEach(() => {
    callGatewayMock.mockReset();
  });

  it("keeps caption text on the newest source.data image and leaves older images intact", async () => {
    const olderPayload = "OLDER_IMAGE_BYTES_KEEP";
    const newestPayload = "N".repeat(140 * 1024);
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method !== "chat.history") {
        return {};
      }
      return {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "上一张还在" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: olderPayload,
                },
                fileName: "old.png",
              },
            ],
          },
          {
            role: "user",
            content: [
              { type: "text", text: "看这张截图里的报价" },
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: "image/png",
                  data: newestPayload,
                },
                fileName: "报价截图.png",
                mimeType: "image/png",
                assetId: "asset-42",
              },
            ],
          },
        ],
      };
    });

    const result = await historyTool().execute("call-image-last", { sessionKey: "main" });
    const details = result.details as {
      messages?: Array<{ content?: unknown }>;
    };
    expect(details.messages).toHaveLength(2);
    const serialized = JSON.stringify(details.messages);
    const older = JSON.stringify(details.messages?.[0]);
    const newest = JSON.stringify(details.messages?.[1]);
    expect(older).toContain("上一张还在");
    expect(older).toContain(olderPayload);
    expect(newest).toContain("看这张截图里的报价");
    expect(newest).toContain("[image omitted:");
    expect(newest).toContain("报价截图.png");
    expect(newest).toContain("asset-42");
    expect(newest).not.toContain(PLACEHOLDER);
    expect(newest.includes(newestPayload.slice(0, 80))).toBe(false);
    expect(serialized).not.toContain(PLACEHOLDER);
  });

  it("truncates a long newest text message instead of replacing it", async () => {
    const text = `纯文本${"字".repeat(5_000)}`;
    callGatewayMock.mockImplementation(async (opts: unknown) => {
      const request = opts as { method?: string };
      if (request.method !== "chat.history") {
        return {};
      }
      return {
        messages: [{ role: "user", content: [{ type: "text", text }] }],
      };
    });

    const result = await historyTool().execute("call-long-text", { sessionKey: "main" });
    const details = result.details as { messages?: unknown[] };
    const serialized = JSON.stringify(details.messages);
    expect(details.messages).toHaveLength(1);
    expect(serialized).toContain("…(truncated)…");
    expect(serialized).toContain("纯文本");
    expect(serialized).not.toContain(PLACEHOLDER);
  });
});
