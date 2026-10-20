import { describe, expect, it } from "vitest";
import {
  buildPeerDeliveryTranscriptMessage,
  buildPeerOutboundTranscriptMessage,
} from "./chat-transcript-inject.js";

describe("peer delivery transcript line", () => {
  it("writes the sending robot into the other session without a handover banner", () => {
    const message = buildPeerDeliveryTranscriptMessage({
      message: "还缺开始时间、时长、议题和会议链接。",
      senderLabel: "项目管理",
      sourceSessionKey: "agent:pm:main",
      sourcePlatformUserId: "user-1",
      now: 1_700_000_000_000,
    });
    expect(message.role).toBe("user");
    expect(message.senderLabel).toBe("项目管理");
    expect(message.provenance).toMatchObject({
      kind: "inter_session",
      sourceSessionKey: "agent:pm:main",
      sourceTool: "conversation_send",
      sourceSenderLabel: "项目管理",
      sourcePlatformUserId: "user-1",
    });
    expect(JSON.stringify(message)).not.toContain("任务接收");
    expect(JSON.stringify(message)).not.toContain("诊断交接");
    expect(JSON.stringify(message)).toContain("还缺开始时间、时长、议题和会议链接。");
  });

  it("stamps sent targets on the sender transcript without a handover banner", () => {
    const message = buildPeerOutboundTranscriptMessage({
      message: "请准备明天的会议资料",
      targets: [
        { label: "大白管家", agentId: "steward", sessionKey: "agent:steward:main" },
        { label: "  ", agentId: "skip" },
        { label: "高级秘书", agentId: "secretary" },
      ],
      now: 1_700_000_000_000,
    });
    expect(message.role).toBe("assistant");
    expect(message.openclawPeerOutbound).toBe(true);
    expect(message.sentTo).toEqual([
      { label: "大白管家", agentId: "steward", sessionKey: "agent:steward:main" },
      { label: "高级秘书", agentId: "secretary" },
    ]);
    expect(JSON.stringify(message)).not.toContain("任务发出");
    expect(JSON.stringify(message)).toContain("请准备明天的会议资料");
  });

  it("keeps a sent sentence that looks like a process line", () => {
    const message = buildPeerOutboundTranscriptMessage({
      message: "我先查一下文档。",
      targets: [{ label: "大白管家", agentId: "steward" }],
      now: 1_700_000_000_000,
    });
    expect(JSON.stringify(message)).toContain("我先查一下文档。");
  });
});
