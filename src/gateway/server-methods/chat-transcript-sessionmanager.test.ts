import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { openSessionManager } from "../../agents/pi-sdk/session.js";
import { appendPersistedAgentMessageToTranscript } from "./chat-transcript-inject.js";

describe("appendPersistedAgentMessageToTranscript (Stage 2 chat leaf)", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function createTranscript(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-sm-"));
    dirs.push(dir);
    const transcriptPath = path.join(dir, "session.jsonl");
    const header = {
      type: "session",
      version: CURRENT_SESSION_VERSION,
      id: "sess-stage2",
      timestamp: new Date().toISOString(),
      cwd: dir,
    };
    fs.writeFileSync(transcriptPath, `${JSON.stringify(header)}\n`, "utf8");
    return transcriptPath;
  }

  it("writes the user leaf through SessionManager.appendMessage with a parentId chain", () => {
    const transcriptPath = createTranscript();
    const first = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: {
        role: "user",
        content: [{ type: "text", text: "hello stage2" }],
        timestamp: Date.now(),
        idempotencyKey: "idem-1",
      },
    });
    expect(first.ok).toBe(true);
    expect(first.messageId).toBeTruthy();

    const second = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: {
        role: "user",
        content: [{ type: "text", text: "follow-up" }],
        timestamp: Date.now(),
        idempotencyKey: "idem-2",
      },
    });
    expect(second.ok).toBe(true);
    expect(second.messageId).toBeTruthy();
    expect(second.messageId).not.toBe(first.messageId);

    const sm = openSessionManager(transcriptPath);
    const leaf = sm.getLeafEntry();
    expect(leaf?.id).toBe(second.messageId);
    expect(leaf?.parentId).toBe(first.messageId);

    const raw = fs.readFileSync(transcriptPath, "utf8");
    expect(raw).not.toMatch(/^\{"message":/m); // no bare { message } lines
    expect(raw).toContain('"type":"message"');
  });
});
