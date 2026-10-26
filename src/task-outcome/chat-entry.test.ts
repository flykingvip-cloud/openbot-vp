import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { chatTurnTaskId, ensureChatTurnTaskOutcome } from "./chat-entry.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";

describe("chat entry taskId", () => {
  let agentDir = "";
  let cfg: OpenBotConfig;

  beforeEach(() => {
    agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-entry-"));
    cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
  });

  afterEach(() => {
    fs.rmSync(agentDir, { recursive: true, force: true });
  });

  it("creates durable task at entry with session-scoped taskId", () => {
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-1",
      sessionKey: "sess-a",
      subjectRef: "platform-user:u1",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }
    expect(opened.taskId).toBe(
      chatTurnTaskId({ agentId: "bot", runId: "run-1", sessionKey: "sess-a" }),
    );
    expect(opened.record.lifecycle).toBe("awaiting_acceptance");
    const store = new DurableTaskOutcomeStore(path.join(agentDir, TASK_OUTCOME_STORE_DIRNAME));
    expect(store.loadTask(opened.taskId)?.taskId).toBe(opened.taskId);
  });

  it("rejects restore with different subject", () => {
    const a = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-2",
      sessionKey: "sess-b",
      subjectRef: "user-a",
    });
    expect(a.ok).toBe(true);
    const b = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-2",
      sessionKey: "sess-b",
      subjectRef: "user-b",
    });
    expect(b.ok).toBe(false);
  });
});
