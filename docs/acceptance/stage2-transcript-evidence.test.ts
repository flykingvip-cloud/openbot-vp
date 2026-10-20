/**
 * Stage 2 transcript write-path evidence (narrow).
 *
 * Proves chat early-persist user leaves go through SessionManager.appendMessage
 * (via appendPersistedAgentMessageToTranscript), not appendFileSync bare JSONL.
 * Does NOT claim Stage 2 overall PASS or a live agent turn E3.
 * stage8_eligible stays false.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { openSessionManager } from "../../src/agents/pi-sdk/session.js";
import { appendPersistedAgentMessageToTranscript } from "../../src/gateway/server-methods/chat-transcript-inject.js";

describe("Stage 2 chat transcript SessionManager write path (E3, narrow PASS)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("chat leaf helper uses SessionManager and chains parentId", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage2-ev-"));
    dirs.push(dir);
    const transcriptPath = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      transcriptPath,
      `${JSON.stringify({
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "sess-ev",
        timestamp: new Date().toISOString(),
        cwd: dir,
      })}\n`,
      "utf8",
    );

    const a = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: {
        role: "user",
        id: "local-ev-1",
        content: [{ type: "text", text: "stage2 evidence" }],
        timestamp: Date.now(),
        idempotencyKey: "ev-1",
      },
    });
    const b = appendPersistedAgentMessageToTranscript({
      transcriptPath,
      message: {
        role: "user",
        id: "local-ev-2",
        content: [{ type: "text", text: "stage2 evidence 2" }],
        timestamp: Date.now(),
        idempotencyKey: "ev-2",
      },
    });
    expect(a.ok && b.ok).toBe(true);
    const sm = openSessionManager(transcriptPath);
    expect(sm.getLeafId()).toBe(b.messageId);
    expect(sm.getEntry(b.messageId!)?.parentId).toBe(a.messageId);
  });

  it("chat.ts early-persist path imports SessionManager helper (E1 source anchor)", () => {
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/gateway/server-methods/chat.ts"),
      "utf8",
    );
    expect(src).toContain("appendPersistedAgentMessageToTranscript");
    expect(src).not.toMatch(/appendTranscriptMessageEntry\s*\(/);
  });
});
