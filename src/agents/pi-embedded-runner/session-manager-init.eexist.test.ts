import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION, SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { openSessionManager } from "../pi-sdk/session.js";
import { prepareSessionManagerForRun } from "./session-manager-init.js";

let tempRoot: string | undefined;

afterEach(async () => {
  if (!tempRoot) {
    return;
  }
  await fs.rm(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("prepareSessionManagerForRun empty-jsonl EEXIST", () => {
  it("does not EEXIST when session jsonl already exists as 0-byte (restore/abort)", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sm-eexist-"));
    const sessionFile = path.join(tempRoot, "41f40fa1-empty.jsonl");
    const sessionId = "41f40fa1-067c-42e9-8e3f-41ff158592e4";

    // Checkpoint restore / abort can leave a 0-byte transcript path on disk.
    await fs.writeFile(sessionFile, "", "utf-8");
    expect((await fs.stat(sessionFile)).size).toBe(0);

    const sessionManager = openSessionManager(sessionFile, tempRoot, tempRoot);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile,
      hadSessionFile: true,
      sessionId,
      cwd: tempRoot,
    });

    // Path must be absent so SessionManager._persist can openSync(..., "wx").
    await expect(fs.access(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });
    expect((sessionManager as unknown as { flushed: boolean }).flushed).toBe(false);

    // Reproduce the flush that previously threw EEXIST after restore+send.
    expect(() => {
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "ping after restore" }],
        timestamp: Date.now(),
      } as Parameters<SessionManager["appendMessage"]>[0]);
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "pong" }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as unknown as Parameters<SessionManager["appendMessage"]>[0]);
    }).not.toThrow();

    const raw = await fs.readFile(sessionFile, "utf-8");
    expect(raw.length).toBeGreaterThan(0);
    expect(raw).toContain('"role":"user"');
    expect(raw).toContain('"role":"assistant"');
    expect(raw).toContain(CURRENT_SESSION_VERSION.toString());
  });

  it("does not EEXIST for header-only (no assistant) pre-created session files", async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-sm-eexist-hdr-"));
    const sessionFile = path.join(tempRoot, "header-only.jsonl");
    const sessionId = "sess-header-only-1";
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: sessionId,
      timestamp: new Date(0).toISOString(),
      cwd: tempRoot,
    };
    await fs.writeFile(sessionFile, `${JSON.stringify(header)}\n`, "utf-8");

    const sessionManager = openSessionManager(sessionFile, tempRoot, tempRoot);
    await prepareSessionManagerForRun({
      sessionManager,
      sessionFile,
      hadSessionFile: true,
      sessionId,
      cwd: tempRoot,
    });

    await expect(fs.access(sessionFile)).rejects.toMatchObject({ code: "ENOENT" });

    expect(() => {
      sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "hello" }],
        timestamp: Date.now(),
      } as Parameters<SessionManager["appendMessage"]>[0]);
      sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "world" }],
        timestamp: Date.now(),
        stopReason: "stop",
      } as unknown as Parameters<SessionManager["appendMessage"]>[0]);
    }).not.toThrow();

    const raw = await fs.readFile(sessionFile, "utf-8");
    expect(raw).toContain('"role":"assistant"');
  });
});
