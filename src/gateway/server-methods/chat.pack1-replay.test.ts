/**
 * Pack 1 replay: protocol error, a normal follow-up, /new, then another message.
 * This is source evidence, not a LIVE pass.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { handleChatEvent, type ChatEventState } from "../../../ui/src/ui/controllers/chat.ts";
import { interactionAdmissionFact } from "../../agent-runtime/command/route-interaction.js";
import { INTERACTION_PROSE_PROTOCOL_DOWNGRADE } from "../../agent-runtime/contracts/interaction.js";
import { resetSharedDataGovernanceCatalogForTests } from "../data-governance/runtime-catalog.js";
import { appendUserTranscriptMessage, ensureTranscriptFile } from "./chat.js";

const dirs: string[] = [];

function chatState(sessionKey: string): ChatEventState {
  return {
    sessionKey,
    chatMessages: [],
    chatRunId: null,
    chatStream: null,
    chatStreamStartedAt: null,
    chatStreamSessionKey: null,
    chatStreamReplyLanguage: null,
    chatThinkingProgress: null,
    workProgressPhase: null,
    workProgressToolsInFlight: 0,
    lastError: null,
    stewardMainSessionKey: sessionKey,
  };
}

function texts(state: ChatEventState): string[] {
  return state.chatMessages.map((message) => JSON.stringify(message));
}

afterEach(() => {
  resetSharedDataGovernanceCatalogForTests();
  for (const dir of dirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

it("replays a protocol error, a normal reply, /new, and the next message without stuck occupancy", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "openbot-pack1-replay-"));
  dirs.push(stateDir);
  const previousState = process.env.OPENBOT_STATE_DIR;
  process.env.OPENBOT_STATE_DIR = stateDir;
  resetSharedDataGovernanceCatalogForTests();
  const cwd = fs.mkdtempSync(path.join(stateDir, "workspace-"));
  const sessions = fs.mkdtempSync(path.join(stateDir, "sessions-"));
  const sessionKey = "agent:main:employee:usr-ceo";
  const state = chatState(sessionKey);

  const firstTranscript = path.join(sessions, "before-new.jsonl");
  expect(
    (
      await ensureTranscriptFile({
        transcriptPath: firstTranscript,
        sessionId: "sess-before",
        cwd,
        tenantId: "ent-456",
        ownerUserId: "usr-ceo",
        failClosed: true,
      })
    ).ok,
  ).toBe(true);

  state.chatRunId = "run-1";
  const raw = `SyntaxError: Unexpected token '今', "今天是 2026 年"... is not valid JSON`;
  expect(
    handleChatEvent(state, {
      runId: "run-1",
      sessionKey,
      state: "error",
      errorMessage: raw,
    }),
  ).toBe("error");
  expect(state.chatRunId).toBeNull();
  expect(state.lastError).toBeNull();
  expect(texts(state).join("\n")).not.toContain("SyntaxError");
  expect(texts(state).filter((row) => row.includes("没有开始任务"))).toHaveLength(1);

  const followup = await appendUserTranscriptMessage({
    sessionId: "sess-before",
    storePath: path.join(sessions, "sessions.json"),
    sessionFile: firstTranscript,
    idempotencyKey: "msg-2",
    message: { role: "user", content: [{ type: "text", text: "刚才的回答请压缩成一句话" }] },
    workspaceCwd: cwd,
    tenantId: "ent-456",
    ownerUserId: "usr-ceo",
    failClosed: true,
  });
  expect(followup.ok).toBe(true);
  state.chatRunId = "run-2";
  expect(
    handleChatEvent(state, {
      runId: "run-2",
      sessionKey,
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "今天是星期一。" }] },
    }),
  ).toBe("final");
  expect(state.chatRunId).toBeNull();
  expect(texts(state).filter((row) => row.includes("今天是星期一"))).toHaveLength(1);

  const falseStart = interactionAdmissionFact({
    kind: "respond",
    text: "好的，我现在制作报告",
    clarification: false,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });
  expect(falseStart).toEqual({
    admitted: false,
    protocolDowngrade: INTERACTION_PROSE_PROTOCOL_DOWNGRADE,
  });

  const resetTranscript = path.join(sessions, "after-new.jsonl");
  expect(fs.existsSync(resetTranscript)).toBe(false);
  expect(
    (
      await ensureTranscriptFile({
        transcriptPath: resetTranscript,
        sessionId: "sess-after",
        cwd,
        tenantId: "ent-456",
        ownerUserId: "usr-ceo",
        failClosed: true,
      })
    ).ok,
  ).toBe(true);
  const afterNew = await appendUserTranscriptMessage({
    sessionId: "sess-after",
    storePath: path.join(sessions, "sessions.json"),
    sessionFile: resetTranscript,
    idempotencyKey: "msg-3",
    message: { role: "user", content: [{ type: "text", text: "请写一份入职清单" }] },
    workspaceCwd: cwd,
    tenantId: "ent-456",
    ownerUserId: "usr-ceo",
    failClosed: true,
  });
  expect(afterNew.ok).toBe(true);
  state.chatMessages = [];
  state.chatRunId = "run-3";
  expect(
    handleChatEvent(state, {
      runId: "run-3",
      sessionKey,
      state: "final",
      message: { role: "assistant", content: [{ type: "text", text: "清单如下。" }] },
    }),
  ).toBe("final");
  expect(state.chatRunId).toBeNull();
  expect(texts(state)).toHaveLength(1);
  expect(texts(state)[0]).toContain("清单如下");
  expect(texts(state).join("\n")).not.toContain("SyntaxError");
  expect(texts(state).join("\n")).not.toContain("authorized workspace cwd");

  const before = fs.readFileSync(firstTranscript, "utf8");
  const after = fs.readFileSync(resetTranscript, "utf8");
  expect(before).toContain("压缩成一句话");
  expect(after).toContain("入职清单");
  expect(after).not.toContain("压缩成一句话");
  expect(before).not.toContain("入职清单");

  if (previousState === undefined) {
    delete process.env.OPENBOT_STATE_DIR;
  } else {
    process.env.OPENBOT_STATE_DIR = previousState;
  }
});
