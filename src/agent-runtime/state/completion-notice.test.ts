import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { appendTaskCompletionNotice } from "./completion-notice.js";
it("appends an idempotent completion leaf through SessionManager with its parent intact", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "completion-notice-"));
  try {
    const file = path.join(dir, "session.jsonl");
    fs.writeFileSync(file, "");
    const manager = openSessionManager(file);
    const userId = manager.appendMessage({ role: "user", content: "任务", timestamp: 1 });
    const binding = { taskId: "a", executionAttempt: "run", deliverableVersion: "v1" };
    expect(appendTaskCompletionNotice(file, binding, "完成")).toBe(true);
    expect(appendTaskCompletionNotice(file, binding, "完成")).toBe(true);
    const entries = openSessionManager(file).getBranch();
    expect(entries.filter((entry) => entry.type === "message")).toHaveLength(2);
    expect(entries.at(-1)?.parentId).toBe(userId);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
