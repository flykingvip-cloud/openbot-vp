import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../config/config.js";
import { validateChatEvent } from "../gateway/protocol/index.js";
import { ensureChatTurnTaskOutcome } from "./chat-entry.js";
import {
  buildChatTaskUpdateEvent,
  readChatTurnOutcomeTip,
  resolveChatFinalTaskUpdate,
} from "./chat-task-update.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("chat task update from an outcome tip", () => {
  it("includes taskId, agentId, and outcomeVersion only when the tip exists", () => {
    expect(buildChatTaskUpdateEvent(null)).toBeNull();
    expect(
      buildChatTaskUpdateEvent({
        taskId: "",
        agentId: "bot",
        outcomeVersion: 1,
        judgement: "success",
      }),
    ).toBeNull();

    const agentDir = fs.mkdtempSync(path.join(os.tmpdir(), "chat-task-update-"));
    dirs.push(agentDir);
    const cfg = { agents: { list: [{ id: "bot", agentDir }] } } as unknown as OpenBotConfig;
    const opened = ensureChatTurnTaskOutcome(cfg, {
      agentId: "bot",
      runId: "run-1",
      sessionKey: "agent:bot:main",
      subjectRef: "subject:alice",
    });
    expect(opened.ok).toBe(true);
    if (!opened.ok) {
      return;
    }

    const tip = readChatTurnOutcomeTip({
      cfg,
      agentId: "bot",
      runId: "run-1",
      sessionKey: "agent:bot:main",
    });
    const event = buildChatTaskUpdateEvent(tip);
    expect(event?.task).toMatchObject({
      taskId: opened.taskId,
      agentId: "bot",
      outcomeVersion: opened.record.outcomeVersion,
      id: opened.taskId,
    });
    expect(event?.task.taskId).not.toBe("card-only");
    expect(JSON.stringify(event)).not.toContain("已重新执行");

    const payload = {
      runId: "run-1",
      sessionKey: "agent:bot:main",
      seq: 1,
      state: "final" as const,
      message: { role: "assistant", content: [{ type: "text", text: "完成" }] },
      taskUpdate: event,
    };
    expect(validateChatEvent(payload)).toBe(true);

    fs.rmSync(path.join(agentDir, "task-outcomes"), { recursive: true, force: true });
    expect(
      resolveChatFinalTaskUpdate({
        cfg,
        sessionKey: "agent:bot:main",
        runId: "run-1",
        agentId: "bot",
      }),
    ).toBeNull();
  });
});
