import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
  recordAcceptedChatRequest,
  completeAcceptedChatRequest,
  recoverInterruptedChatRequests,
  CHAT_RESTART_INTERRUPTED_TEXT,
} from "./chat-request-recovery.js";
const roots: string[] = [];
function root() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-recovery-"));
  roots.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of roots.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
it("leaves a live request alone, reports an interrupted request once after a new boot", async () => {
  const dir = root();
  const append = vi.fn(async () => ({ ok: true }));
  recordAcceptedChatRequest("run", "session", dir);
  expect(await recoverInterruptedChatRequests({ sessionKey: "session", root: dir, append })).toBe(
    0,
  );
  expect(append).not.toHaveBeenCalled();
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new-boot",
      append,
    }),
  ).toBe(1);
  expect(append).toHaveBeenCalledWith(CHAT_RESTART_INTERRUPTED_TEXT, "run:restart-interrupted");
  expect(CHAT_RESTART_INTERRUPTED_TEXT).not.toContain("没有启动");
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new-boot",
      append,
    }),
  ).toBe(0);
});
it("keeps failed durable appends for retry and isolates sessions", async () => {
  const dir = root();
  recordAcceptedChatRequest("run", "session", dir);
  const append = vi.fn(async () => ({ ok: false }));
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "other",
      root: dir,
      currentBootId: "new",
      append,
    }),
  ).toBe(0);
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new",
      append,
    }),
  ).toBe(0);
  append.mockResolvedValue({ ok: true });
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new",
      append,
    }),
  ).toBe(1);
});
it("does not report a completed request on restart", async () => {
  const dir = root();
  recordAcceptedChatRequest("run", "session", dir);
  completeAcceptedChatRequest("run", "session", dir);
  const append = vi.fn(async () => ({ ok: true }));
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new",
      append,
    }),
  ).toBe(0);
  expect(append).not.toHaveBeenCalled();
});

it("preserves damaged records without blocking history or disclosing another session", async () => {
  const dir = root();
  recordAcceptedChatRequest("run", "session", dir);
  const recoveryRoot = path.join(dir, "chat-request-recovery");
  const sessionDir = path.join(recoveryRoot, fs.readdirSync(recoveryRoot)[0]);
  const receipt = path.join(sessionDir, fs.readdirSync(sessionDir)[0]);
  fs.writeFileSync(receipt, "broken-json");
  const append = vi.fn(async () => ({ ok: true }));
  expect(
    await recoverInterruptedChatRequests({
      sessionKey: "session",
      root: dir,
      currentBootId: "new",
      append,
    }),
  ).toBe(0);
  expect(append).not.toHaveBeenCalled();
  expect(fs.readFileSync(receipt, "utf8")).toBe("broken-json");
});
