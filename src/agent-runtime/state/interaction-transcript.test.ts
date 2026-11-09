import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { persistInteractionMessage } from "./interaction-transcript.js";
it("persists channel dialogue once without creating task state", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "channel-interaction-"));
  try {
    const sessionFile = path.join(dir, "session.jsonl");
    const common = { sessionFile, sessionId: "channel", cwd: dir, messageId: "message" };
    persistInteractionMessage({ ...common, role: "user", text: "你好" });
    persistInteractionMessage({ ...common, role: "user", text: "你好" });
    persistInteractionMessage({ ...common, role: "assistant", text: "你好，有什么需要帮助？" });
    const manager = openSessionManager(sessionFile);
    expect(manager.getSessionId()).toBe("channel");
    expect(manager.buildSessionContext().messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(fs.existsSync(`${sessionFile}.task-board.json`)).toBe(false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
