import fs from "node:fs";
import {
  applyOguiDecisionToVisibleText,
  type OguiDecisionRunBinding,
} from "../../../config/sessions/ogui-decision-engine.js";
import { oguiWaitBlocksSession } from "../../../config/sessions/ogui-decision-wait-registry.js";
import { rewritePlanSpeakFinal } from "../../../shared/text/plan-speak-final.js";
import { getRunReplyLanguage } from "../../../shared/text/run-reply-language.js";
import {
  enforceVisibleReplyLanguage,
  enforceVisibleReplyTexts,
} from "../../../shared/text/visible-reply-language.js";
import { latestUserText } from "../../execution-stall-continue.js";
import { replyForTaskSurfaceUtterance } from "../../task-surface/apply.js";
import {
  isOrdinalClarificationQuiz,
  isPrimarilyTaskSurfaceUtterance,
  parseKeepOnlyOrdinal,
} from "../../task-surface/surface.js";
import { readSkillSmokeClock, settleTurnCompletion } from "../../turn-completion/contract.js";

type ReplyMessage = {
  role?: string;
  stopReason?: string;
  content?: unknown;
};

function assistantVisibleText(message: ReplyMessage): string {
  const content = message.content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  return content
    .map((block) => {
      if (!block || typeof block !== "object") {
        return "";
      }
      const entry = block as { type?: unknown; text?: unknown };
      return entry.type === "text" && typeof entry.text === "string" ? entry.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function replaceAssistantVisibleText(message: ReplyMessage, next: string): void {
  if (typeof message.content === "string") {
    message.content = next;
    return;
  }
  if (!Array.isArray(message.content)) {
    message.content = [{ type: "text", text: next }];
    return;
  }
  let replaced = false;
  for (const block of message.content) {
    if (!block || typeof block !== "object") {
      continue;
    }
    const entry = block as { type?: unknown; text?: string };
    if (entry.type === "text" && typeof entry.text === "string") {
      entry.text = replaced ? "" : next;
      replaced = true;
    }
  }
  if (!replaced) {
    message.content.push({ type: "text", text: next });
  }
}

function patchSessionTranscriptLine(sessionFile: string, from: string, to: string): void {
  if (!from.trim() || from === to) {
    return;
  }
  let raw: string;
  try {
    raw = fs.readFileSync(sessionFile, "utf8");
  } catch {
    return;
  }
  const trailingNewline = raw.endsWith("\n");
  const lines = raw.split("\n");
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!line?.trim()) {
      continue;
    }
    let entry: {
      type?: string;
      message?: ReplyMessage;
    };
    try {
      entry = JSON.parse(line) as { type?: string; message?: ReplyMessage };
    } catch {
      continue;
    }
    if (entry.type !== "message" || entry.message?.role !== "assistant") {
      continue;
    }
    if (entry.message.stopReason === "toolUse") {
      continue;
    }
    if (assistantVisibleText(entry.message).trim() !== from.trim()) {
      continue;
    }
    replaceAssistantVisibleText(entry.message, to);
    lines[index] = JSON.stringify(entry);
    const next = lines.join("\n");
    fs.writeFileSync(sessionFile, trailingNewline || next.endsWith("\n") ? next : `${next}\n`);
    return;
  }
}

/**
 * Rewrite the final stop answer before it is snapshotted, flushed, or returned
 * as channel payloads. toolUse narration is not a reply and is left alone.
 */
export async function rewriteAttemptVisibleReply(params: {
  runId: string;
  assistantTexts: string[];
  messages: ReplyMessage[];
  sessionFile?: string;
  workspaceDir?: string;
  sessionKey?: string;
  nowMs?: number;
  /** Absent when the OGUI lifecycle flag is off. */
  oguiDecisionRun?: OguiDecisionRunBinding;
}): Promise<void> {
  const language = getRunReplyLanguage(params.runId);

  let original = "";
  let target: ReplyMessage | undefined;
  for (let index = params.messages.length - 1; index >= 0; index -= 1) {
    const message = params.messages[index];
    if (!message || message.role !== "assistant" || message.stopReason === "toolUse") {
      continue;
    }
    original = assistantVisibleText(message);
    target = message;
    break;
  }

  const applyMessageRewrite = (from: string, to: string) => {
    if (!target || !from.trim() || from === to) {
      return;
    }
    replaceAssistantVisibleText(target, to);
    if (params.sessionFile) {
      patchSessionTranscriptLine(params.sessionFile, from, to);
    }
    const joined = params.assistantTexts.join("\n\n").trim();
    if (joined === from.trim()) {
      params.assistantTexts.splice(0, params.assistantTexts.length, to);
    }
  };

  if (language === "zh" && target && original.trim()) {
    const rewritten = await enforceVisibleReplyLanguage({
      text: original,
      expectedLanguage: "zh",
      runId: params.runId,
    });
    if (rewritten !== original) {
      applyMessageRewrite(original, rewritten);
      original = rewritten;
    }
  }

  // Plan-speak pass-through: do not invent pause/confirm at reply layer.
  // Continue / human-gate / completion stay with the executor + turn-completion.
  const planSpeakContext = latestUserText(params.messages);
  if (target && original.trim()) {
    const nextVisible = rewritePlanSpeakFinal(original, planSpeakContext);
    if (nextVisible !== original) {
      applyMessageRewrite(original, nextVisible);
      original = nextVisible;
    }
  }

  if (language === "zh") {
    const nextTexts = await enforceVisibleReplyTexts({
      texts: params.assistantTexts,
      expectedLanguage: "zh",
      runId: params.runId,
    });
    if (nextTexts !== params.assistantTexts) {
      params.assistantTexts.splice(0, params.assistantTexts.length, ...nextTexts);
    }
  }

  // Same pass-through on channel text payloads (no invented pause CTA).
  for (let i = 0; i < params.assistantTexts.length; i += 1) {
    const cur = params.assistantTexts[i];
    if (typeof cur !== "string") {
      continue;
    }
    const next = rewritePlanSpeakFinal(cur, planSpeakContext);
    if (next !== cur) {
      params.assistantTexts[i] = next;
    }
  }

  // Keep-only already has one ordinal. A second quiz is replaced by the receipt.
  const surfaceUser = planSpeakContext.trim();
  if (
    target &&
    original.trim() &&
    params.workspaceDir &&
    parseKeepOnlyOrdinal(surfaceUser) != null &&
    (isOrdinalClarificationQuiz(original) || isPrimarilyTaskSurfaceUtterance(surfaceUser))
  ) {
    const receipt = replyForTaskSurfaceUtterance({
      text: surfaceUser,
      workspaceDir: params.workspaceDir,
      agentId: "main",
      sessionFile: params.sessionFile,
    });
    if (receipt && receipt !== original) {
      applyMessageRewrite(original, receipt);
      original = receipt;
    }
  }

  // Turn-completion contract is the last word on the visible final.
  let finalText = (
    target ? assistantVisibleText(target) : params.assistantTexts.join("\n\n")
  ).trim();
  let oguiWaitActive = oguiWaitBlocksSession(params.sessionKey);
  if (finalText && params.oguiDecisionRun?.allowIssue) {
    const applied = await applyOguiDecisionToVisibleText({
      text: finalText,
      binding: params.oguiDecisionRun,
    });
    if (applied.text !== finalText) {
      applyMessageRewrite(finalText, applied.text);
      finalText = applied.text.trim();
    }
    oguiWaitActive = applied.oguiWaitActive;
  }
  if (finalText) {
    const settled = settleTurnCompletion({
      userText: planSpeakContext,
      assistantText: finalText,
      workspaceDir: params.workspaceDir,
      sessionKey: params.sessionKey,
      nowMs: params.nowMs ?? Date.now(),
      smokeStartedAtMs: readSkillSmokeClock(params.sessionKey),
      ...(oguiWaitActive ? { oguiWaitActive: true } : {}),
    });
    if (settled.visibleText !== finalText) {
      applyMessageRewrite(finalText, settled.visibleText);
      const joined = params.assistantTexts.join("\n\n").trim();
      if (joined !== settled.visibleText.trim()) {
        params.assistantTexts.splice(0, params.assistantTexts.length, settled.visibleText);
      }
    }
  }
}
