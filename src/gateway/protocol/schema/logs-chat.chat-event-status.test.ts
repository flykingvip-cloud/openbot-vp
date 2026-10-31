import type { Static } from "@sinclair/typebox";
import { describe, expect, it } from "vitest";
import { validateChatEvent } from "../index.js";
import { ChatEventSchema } from "./logs-chat.js";

/**
 * R7: `status` must enter canonical ChatEvent protocol.
 * Frontend union types alone are insufficient — validateChatEvent is authority.
 */

type ChatEvent = Static<typeof ChatEventSchema>;

describe("ChatEventSchema accepts non-terminal status (R7)", () => {
  it("validateChatEvent accepts R6-shaped status receipt egress payload", () => {
    const payload: ChatEvent = {
      runId: "run-parent-1:discuss-to-task-receipt",
      sessionKey: "space:grp-demo",
      seq: 0,
      state: "status",
      message: {
        id: "discuss-to-task-receipt:run-parent-1",
        receiptId: "discuss-to-task-receipt:run-parent-1",
        role: "assistant",
        content: [{ type: "text", text: "正式任务已建立，任务编号 T-1。" }],
        timestamp: 1000,
        senderLabel: "协作调度",
        discussToTaskReceipt: true,
        collaborationRoundId: "run-parent-1",
      },
    };
    expect(validateChatEvent(payload)).toBe(true);
  });

  it("generated ChatEvent type includes status (client compatibility)", () => {
    const state: ChatEvent["state"] = "status";
    expect(state).toBe("status");
    // Exhaustive-ish allowlist shared with gateway egress + UI reducer.
    const allowed = ["delta", "final", "aborted", "error", "thinking", "status"] as const;
    expect(allowed).toContain("status");
    for (const s of allowed) {
      expect(
        validateChatEvent({
          runId: "run-compat",
          sessionKey: "agent:main:main",
          seq: 0,
          state: s,
          ...(s === "thinking"
            ? {
                thinking: {
                  steps: [{ id: "s0", label: "理解问题", status: "active" }],
                  activeIndex: 0,
                  percent: 10,
                  placeholder: "…",
                },
              }
            : { message: { role: "assistant", content: [{ type: "text", text: "x" }] } }),
        }),
      ).toBe(true);
    }
  });

  it("validateChatEvent rejects unknown / client-local-only states", () => {
    const base = {
      runId: "run-1",
      sessionKey: "agent:main:main",
      seq: 1,
    };
    expect(validateChatEvent({ ...base, state: "not-a-real-state" })).toBe(false);
    // user_echo is UI-local; not part of canonical ChatEventSchema
    expect(validateChatEvent({ ...base, state: "user_echo" })).toBe(false);
  });

  it("flag-off style status copy (identical text shape) still validates", () => {
    const payload = {
      runId: "run-a:discuss-to-task-receipt",
      sessionKey: "space:grp",
      seq: 0,
      state: "status",
      message: {
        id: "discuss-to-task-receipt:run-a",
        receiptId: "discuss-to-task-receipt:run-a",
        role: "assistant",
        content: [{ type: "text", text: "当前组未启用正式任务能力，尚未建立正式任务。" }],
        timestamp: Date.now(),
        discussToTaskReceipt: true,
      },
    };
    expect(validateChatEvent(payload)).toBe(true);
  });
});
