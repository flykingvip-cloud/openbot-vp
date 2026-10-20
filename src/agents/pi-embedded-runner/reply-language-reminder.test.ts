import { describe, expect, it } from "vitest";
import {
  registerRunReplyLanguage,
  resetRunReplyLanguageForTest,
} from "../../shared/text/run-reply-language.js";
import {
  appendReplyLanguageReminder,
  installReplyLanguageReminder,
  REPLY_LANGUAGE_REMINDERS,
} from "./reply-language-reminder.js";

describe("reply language reminder", () => {
  it("appends the Chinese reminder once, after the last complete message", () => {
    const first = appendReplyLanguageReminder([{ role: "user", content: "帮我看购物车" }], "zh");
    expect(first.at(-1)).toMatchObject({ role: "user", content: REPLY_LANGUAGE_REMINDERS.zh });
    const second = appendReplyLanguageReminder(first, "zh");
    expect(second).toBe(first);
  });

  it("appends an English reminder when the turn language is English", () => {
    const messages = appendReplyLanguageReminder([{ role: "user", content: "status" }], "en");
    expect(messages.at(-1)).toMatchObject({ content: "Reply to the user in English." });
  });

  it("does not insert between a tool call and its result", () => {
    const messages = [
      { role: "user", content: "打开浏览器" },
      {
        role: "assistant",
        content: [{ type: "toolCall", name: "browser", arguments: { action: "status" } }],
      },
    ];
    expect(appendReplyLanguageReminder(messages, "zh")).toBe(messages);
  });

  it("installs the reminder on every transform when the run language is set", async () => {
    resetRunReplyLanguageForTest();
    registerRunReplyLanguage("run-zh", "zh");
    const agent: Parameters<typeof installReplyLanguageReminder>[0]["agent"] = {};
    const remove = installReplyLanguageReminder({ agent, runId: "run-zh" });
    const input = [{ role: "user", content: "继续", timestamp: 1 }] as unknown as Parameters<
      NonNullable<typeof agent.transformContext>
    >[0];
    const transformed = (await agent.transformContext?.(input)) as Array<{ content?: string }>;
    expect(transformed.at(-1)?.content).toBe("用中文回复用户。");
    remove();
    resetRunReplyLanguageForTest();
  });
});
