import { describe, expect, it } from "vitest";
import { isDeliverableResultArtifact } from "../../shared/preview-artifact/deposit-tier.js";
import { sanitizeChatHistoryMessagesForTest } from "./chat.js";

describe("chat history deliverable chip survives control-channel sanitize", () => {
  it("keeps structured artifact after stripping <<DELIVERABLE>> tags from visible text", () => {
    const raw =
      '旁白：SOP 已落盘。\n<<DELIVERABLE title="邮件发送 SOP" type="doc" file="email-sending-sop.md">>\n- 个人邮箱流程\n<</DELIVERABLE>>';
    const result = sanitizeChatHistoryMessagesForTest([
      { role: "assistant", content: [{ type: "text", text: raw }], timestamp: Date.now() },
    ]);
    expect(result).toHaveLength(1);
    const message = result[0] as Record<string, unknown>;
    const block = (message.content as Array<{ text?: string }>)[0];
    expect(block?.text ?? "").not.toContain("<<DELIVERABLE");
    expect(block?.text ?? "").not.toContain("file=");
    expect(message.artifact).toBeTruthy();
    expect(isDeliverableResultArtifact(message.artifact as Record<string, unknown>)).toBe(true);
    const meta = (message.artifact as { providerMetadata?: Record<string, unknown> })
      .providerMetadata;
    expect(meta?.workspaceFilename).toBe("email-sending-sop.md");
    expect(meta?.declared).toBe(true);
  });
});
