import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CURRENT_SESSION_VERSION } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { persistInteractionMessage } from "../agent-runtime/state/index.js";
import { openSessionManager } from "../agents/pi-sdk/session.js";
import { SILENT_REPLY_TOKEN } from "../auto-reply/tokens.js";
import {
  EMPTY_FINAL_ASSISTANT_TEXT,
  planDirectChatFallbackPersist,
  transcriptHasVisibleAssistantAfterUser,
  visibleAssistantTextAfterUser,
} from "./server-methods/chat-terminal-transcript.js";
import {
  formatChatTurnTerminalText,
  persistRejectedInteractionTurn,
  REJECTED_INTERACTION_TURN_TEXT,
} from "./chat-interaction-failure.js";

const ADMISSION_REJECTED_TEXT = "任务状态已变化或执行未获准，本次未启动；请确认当前目标后重试。";
const ADMISSION_DUPLICATE_TEXT = "该执行请求已经接纳，未重复启动。";

function assistantRoles(sessionFile: string): string[] {
  return openSessionManager(sessionFile)
    .buildSessionContext()
    .messages.filter((message) => message.role === "assistant")
    .map((message) => {
      const content = message.content;
      if (typeof content === "string") {
        return content;
      }
      if (Array.isArray(content)) {
        return content
          .map((part) =>
            part && typeof part === "object" && "text" in part ? String(part.text ?? "") : "",
          )
          .join("");
      }
      return "";
    });
}

describe("t339 interaction feedback persistence contract", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function sessionFixture() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "t339-feedback-"));
    dirs.push(dir);
    const sessionFile = path.join(dir, "session.jsonl");
    fs.writeFileSync(
      sessionFile,
      `${JSON.stringify({
        type: "session",
        version: CURRENT_SESSION_VERSION,
        id: "sess",
        cwd: dir,
        timestamp: new Date().toISOString(),
      })}\n`,
    );
    return { dir, sessionFile, common: { sessionFile, sessionId: "sess", cwd: dir } };
  }

  it("writes exactly one assistant notice after a failed decision and keeps internals out of the bubble", async () => {
    const { sessionFile, common } = sessionFixture();
    persistInteractionMessage({ ...common, messageId: "run-a", role: "user", text: "hello" });
    const error = Object.assign(new Error("Interaction did not return a final decision"), {
      interactionPhase: "interpretation" as const,
      reason: "empty",
    });
    const first = await persistRejectedInteractionTurn({
      error,
      runId: "run-a",
      append: async (text, key) => {
        persistInteractionMessage({
          ...common,
          messageId: key,
          role: "assistant",
          text,
        });
        return { ok: true };
      },
    });
    const second = await persistRejectedInteractionTurn({
      error,
      runId: "run-a",
      append: async (text, key) => {
        persistInteractionMessage({
          ...common,
          messageId: key,
          role: "assistant",
          text,
        });
        return { ok: true };
      },
    });
    const bubbles = assistantRoles(sessionFile);
    expect(first.persisted).toBe(true);
    expect(second.persisted).toBe(true);
    expect(bubbles).toHaveLength(1);
    expect(bubbles[0]).toBe(first.text);
    expect(bubbles[0]).not.toMatch(/SyntaxError|stack at |Interaction did not return/);
    expect(JSON.stringify(formatChatTurnTerminalText(error))).not.toMatch(/SyntaxError|\\\\{/);
  });

  it("does not double-write a successful interaction reply when fallback runs after persistOwnTranscript", () => {
    const { sessionFile, common } = sessionFixture();
    persistInteractionMessage({ ...common, messageId: "run-ok", role: "user", text: "hi" });
    persistInteractionMessage({
      ...common,
      messageId: "run-ok",
      role: "assistant",
      text: "你好，我在。",
    });
    persistInteractionMessage({
      ...common,
      messageId: "run-ok",
      role: "assistant",
      text: "你好，我在。",
    });
    const messages = openSessionManager(sessionFile).buildSessionContext().messages;
    expect(transcriptHasVisibleAssistantAfterUser(messages, "run-ok")).toBe(true);
    expect(assistantRoles(sessionFile)).toEqual(["你好，我在。"]);
    const plan = planDirectChatFallbackPersist({
      combinedReply: "你好，我在。",
      transcriptHasVisibleAssistant: true,
      existingAssistantText: visibleAssistantTextAfterUser(messages, "run-ok"),
    });
    expect(plan).toEqual({ kind: "reuse", text: "你好，我在。" });
  });

  it("persists an admission rejection through the same transcript path and is not rewritten by fallback", () => {
    const { sessionFile, common } = sessionFixture();
    persistInteractionMessage({ ...common, messageId: "run-deny", role: "user", text: "start" });
    persistInteractionMessage({
      ...common,
      messageId: "run-deny",
      role: "assistant",
      text: ADMISSION_REJECTED_TEXT,
    });
    const messages = openSessionManager(sessionFile).buildSessionContext().messages;
    expect(assistantRoles(sessionFile)).toEqual([ADMISSION_REJECTED_TEXT]);
    expect(
      planDirectChatFallbackPersist({
        combinedReply: ADMISSION_REJECTED_TEXT,
        transcriptHasVisibleAssistant: transcriptHasVisibleAssistantAfterUser(messages, "run-deny"),
        existingAssistantText: visibleAssistantTextAfterUser(messages, "run-deny"),
      }),
    ).toEqual({ kind: "reuse", text: ADMISSION_REJECTED_TEXT });
    persistInteractionMessage({
      ...common,
      messageId: "run-dup",
      role: "user",
      text: "again",
    });
    persistInteractionMessage({
      ...common,
      messageId: "run-dup",
      role: "assistant",
      text: ADMISSION_DUPLICATE_TEXT,
    });
    expect(assistantRoles(sessionFile).filter((text) => text === ADMISSION_DUPLICATE_TEXT)).toEqual([
      ADMISSION_DUPLICATE_TEXT,
    ]);
  });

  it("plans an EMPTY_FINAL persist when the interaction path ends with no executor and no reply", () => {
    expect(
      planDirectChatFallbackPersist({
        combinedReply: "",
        transcriptHasVisibleAssistant: false,
      }),
    ).toEqual({ kind: "append-empty-final", text: EMPTY_FINAL_ASSISTANT_TEXT });
  });

  it("does not treat an intentional silent token as a user-visible bubble to force-write", () => {
    expect(SILENT_REPLY_TOKEN).toBeTruthy();
    const plan = planDirectChatFallbackPersist({
      combinedReply: "",
      transcriptHasVisibleAssistant: false,
    });
    expect(plan.kind).toBe("append-empty-final");
    expect(plan.kind === "append-empty-final" ? plan.text : "").not.toBe(SILENT_REPLY_TOKEN);
  });
});
