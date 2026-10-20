import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createConversationSendTool } from "./conversation-send-tool.js";

const toolSource = readFileSync(
  fileURLToPath(new URL("./conversation-send-tool.ts", import.meta.url)),
  "utf8",
);

describe("conversation_send tool", () => {
  it("is a 1:1 Grok-style mention send and not a group task", () => {
    const tool = createConversationSendTool();
    expect(tool.name).toBe("conversation_send");
    expect(tool.description).toContain("有没有发出去");
    expect(tool.description).toContain("answerInChat");
    expect(tool.description).toContain("posted");
    expect(tool.description).toContain("不要复述");
    expect(tool.description).toContain("不限轮次");
    expect(tool.description).not.toContain("先问主人");
    expect(tool.description).toContain("taskId");
    expect(tool.description).not.toContain("对象会话");
    expect(tool.description).not.toContain("确认");
    expect(toolSource).toContain("injectReply: false");
    expect(toolSource).toContain("postConversationPeerLine");
    expect(toolSource).toContain("postConversationOutboundLine");
    expect(toolSource).toContain("latestInboundInterSessionSource");
    expect(toolSource).toContain("fromDisplayName");
    expect(toolSource).not.toContain("confirmationRound");
    expect(toolSource).not.toContain("诊断交接");
    expect(toolSource).not.toContain("applyFocusResumeGate");
    expect(toolSource).not.toContain("FOCUS_RESUME_REQUIRES_OWNER");
    expect(toolSource).toContain("evaluateCurrentTaskSend");
    expect(toolSource).not.toContain("FOCUS_RESUME_SESSION_UNAVAILABLE");
    expect(toolSource).toContain("readSessionTaskBoard");
    expect(toolSource).toContain("validateConversationDispatch");
    expect(toolSource).toContain("successCriteria");
    expect(toolSource).toContain("forbiddenZones");
    expect(toolSource).toContain("dispatch_ticket_incomplete");
    expect(toolSource).not.toContain("user.daibai.ask");
    expect(toolSource).not.toContain("tools.agentToAgent.enabled=true");
  });
});
