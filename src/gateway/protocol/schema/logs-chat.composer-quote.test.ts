import { describe, expect, it } from "vitest";
import { validateChatSendParams } from "../index.js";

describe("chat.send composerQuote", () => {
  it("accepts structured quote metadata alongside composer body", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:space:grp-1",
        message: "@bot-b 为什么？",
        idempotencyKey: "run-quote-meta",
        composerQuote: {
          messageId: "m-1",
          excerpt: "@bot-a 请先检查数据",
        },
      }),
    ).toBe(true);
  });

  it("rejects empty composerQuote excerpt", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:main:main",
        message: "继续",
        idempotencyKey: "run-quote-empty",
        composerQuote: {
          excerpt: "",
        },
      }),
    ).toBe(false);
  });

  it("accepts plugin mention targets for MCP connectors and plugins", () => {
    expect(
      validateChatSendParams({
        sessionKey: "agent:bot-panda:main",
        message: "请用 @GitHub 开 issue",
        idempotencyKey: "run-plugin-mention",
        mentions: [
          {
            mention_id: "m-plugin",
            displayName: "GitHub",
            offset: 3,
            length: 7,
            targetKind: "plugin",
            targetId: "plugin:connector:github-personal:id-github",
            target: { kind: "plugin", pluginId: "plugin:connector:github-personal:id-github" },
          },
        ],
      }),
    ).toBe(true);
  });
});
