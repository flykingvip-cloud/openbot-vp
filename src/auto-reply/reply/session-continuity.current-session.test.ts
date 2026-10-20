import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  commitSessionContinuityForCurrentSession,
  loadLatestSessionContinuityCheckpoint,
} from "./session-continuity.js";

let tempDir = "";

afterEach(async () => {
  if (tempDir) {
    await fs.rm(tempDir, { recursive: true, force: true });
    tempDir = "";
  }
});

describe("session continuity current-session checkpoints", () => {
  it("creates a checkpoint from the current session transcript", async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-continuity-current-"));
    const sessionFile = path.join(tempDir, "sess-1.jsonl");
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({
          type: "session",
          id: "sess-1",
          timestamp: new Date().toISOString(),
          cwd: tempDir,
        }),
        JSON.stringify({
          type: "message",
          id: "m1",
          timestamp: new Date().toISOString(),
          message: { role: "user", content: [{ type: "text", text: "帮我整理 OpenBot 演讲提纲" }] },
        }),
        JSON.stringify({
          type: "message",
          id: "m2",
          timestamp: new Date().toISOString(),
          message: { role: "assistant", content: [{ type: "text", text: "这是提纲初稿" }] },
        }),
      ].join("\n"),
      "utf8",
    );

    const checkpoint = await commitSessionContinuityForCurrentSession({
      cfg: {},
      workspaceDir: tempDir,
      agentId: "main",
      sessionKey: "main",
      sessionEntry: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        sessionFile,
      },
      reason: "turn_completed",
    });

    expect(checkpoint?.summary).toContain("帮我整理 OpenBot 演讲提纲");

    const latest = await loadLatestSessionContinuityCheckpoint({
      cfg: {},
      workspaceDir: tempDir,
      agentId: "main",
      sessionKey: "main",
      sessionEntry: {
        sessionId: "sess-1",
        updatedAt: Date.now(),
        sessionFile,
      },
    });
    expect(latest?.id).toBe(checkpoint?.id);
  });
});
