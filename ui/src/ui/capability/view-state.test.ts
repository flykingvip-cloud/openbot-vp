import { describe, expect, it } from "vitest";
import {
  handleChatEvent,
  type ChatEventPayload,
  type ChatEventState,
} from "../controllers/chat.ts";
import { adaptChatEventCapabilityState } from "./view-state.ts";

describe("adaptChatEventCapabilityState", () => {
  it("writes stewardMainSessionKey onto the live host instead of a shallow copy", () => {
    const employeeKey = "agent:main:employee:alice";
    const host: ChatEventState & {
      hello?: { snapshot?: { sessionDefaults?: { mainSessionKey?: string } } } | null;
    } = {
      sessionKey: employeeKey,
      chatRunId: "run-live-paint",
      chatMessages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      chatStream: "",
      chatStreamStartedAt: Date.now(),
      chatStreamSessionKey: employeeKey,
      chatThinkingProgress: null,
      lastError: null,
      stewardMainSessionKey: null,
      hello: {
        snapshot: {
          sessionDefaults: {
            mainSessionKey: employeeKey,
          },
        },
      },
    };
    const adapted = adaptChatEventCapabilityState(host);
    expect(adapted).toBe(host);
    expect(host.stewardMainSessionKey).toBe(employeeKey);

    const payload: ChatEventPayload = {
      runId: "run-live-paint",
      sessionKey: employeeKey,
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "窗口生效" }] },
    };
    expect(handleChatEvent(adapted, payload)).toBe("final");
    expect(host.chatRunId).toBeNull();
    expect(host.chatMessages.some((entry) => JSON.stringify(entry).includes("窗口生效"))).toBe(
      true,
    );
  });
});
