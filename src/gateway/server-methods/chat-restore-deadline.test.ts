import { describe, expect, it } from "vitest";
import {
  ChatRestoreTimeoutError,
  createChatRestoreDeadline,
  isChatRestoreTimeout,
  raceChatRestoreWork,
  resolveChatRestoreDeadlineMs,
} from "./chat-restore-deadline.js";

describe("chat restore deadline", () => {
  it("uses the default deadline unless the env override is a positive number", () => {
    expect(resolveChatRestoreDeadlineMs({})).toBe(20_000);
    expect(resolveChatRestoreDeadlineMs({ OPENBOT_CHAT_RESTORE_DEADLINE_MS: "40" })).toBe(40);
    expect(resolveChatRestoreDeadlineMs({ OPENBOT_CHAT_RESTORE_DEADLINE_MS: "nope" })).toBe(20_000);
  });

  it("rejects hung restore work when the deadline aborts", async () => {
    const deadline = createChatRestoreDeadline(30);
    let hung = true;
    const work = new Promise<never>((_resolve, reject) => {
      deadline.signal.addEventListener(
        "abort",
        () => {
          hung = false;
          reject(deadline.signal.reason);
        },
        { once: true },
      );
    });
    await expect(raceChatRestoreWork(work, deadline.signal)).rejects.toBeInstanceOf(
      ChatRestoreTimeoutError,
    );
    expect(hung).toBe(false);
    expect(isChatRestoreTimeout(deadline.signal.reason, deadline.signal)).toBe(true);
    deadline.clear();
  });
});
