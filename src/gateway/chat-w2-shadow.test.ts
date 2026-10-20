import { describe, expect, it } from "vitest";
import { scheduleChatW2MentionShadow } from "./chat-w2-shadow.js";

describe("chat W2 batch-5 shadow", () => {
  it("schedules mention shadow without throwing when env is off", () => {
    expect(() =>
      scheduleChatW2MentionShadow({
        siteId: "S16-chat-mention-workspace",
        resolvedLocator: "/host/ws",
      }),
    ).not.toThrow();
  });
});
