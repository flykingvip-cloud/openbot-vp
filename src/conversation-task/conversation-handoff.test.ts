import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  buildGuestTaskMessage,
  buildHostFailReceipt,
  buildHostReturnReceipt,
  buildHostSendReceipt,
  conversationReplyNeedsConfirmation,
  collectConversationMentionTokens,
  conversationTranscriptExists,
  defaultConversationSessionKey,
  isFreshPeerReturn,
  isGroupConversationKey,
  latestInboundInterSessionSource,
  parseConversationAtMentions,
  resolveConversationPeer,
  routeStewardConversationMentions,
  stripResolvedAtMentions,
  type ConversationPeer,
} from "./conversation-handoff.js";

const peers: ConversationPeer[] = [
  {
    agentId: "bot-skill",
    displayName: "Skill孵化",
    sessionKey: "agent:bot-skill:main",
    sessionExists: true,
  },
  {
    agentId: "bot-2",
    displayName: "市场助手",
    sessionKey: "agent:bot-2:main",
    sessionExists: true,
  },
];

describe("conversation transcript reachability", () => {
  it("uses the same safe current-session path as chat when an explicit pointer is stale", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-path-parity-"));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "conv-other-root-"));
    const sessionId = "27600000-1111-4222-8333-123456789abc";
    const storePath = path.join(dir, "sessions.json");
    try {
      const external = path.join(outside, "foreign.jsonl");
      fs.writeFileSync(external, "{}\n");
      expect(conversationTranscriptExists(storePath, { sessionId, sessionFile: external })).toBe(
        false,
      );
      fs.writeFileSync(path.join(dir, `${sessionId}.jsonl`), "{}\n");
      expect(conversationTranscriptExists(storePath, { sessionId, sessionFile: external })).toBe(
        true,
      );
      expect(
        conversationTranscriptExists(storePath, { sessionId, sessionFile: "../foreign.jsonl" }),
      ).toBe(true);
      fs.unlinkSync(path.join(dir, `${sessionId}.jsonl`));
      fs.writeFileSync(path.join(dir, "old-session.jsonl"), "old history\n");
      expect(conversationTranscriptExists(storePath, { sessionId })).toBe(false);
      fs.mkdirSync(path.join(dir, `${sessionId}.jsonl`));
      expect(conversationTranscriptExists(storePath, { sessionId })).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("ignores a store pointer whose transcript file is missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "conv-transcript-"));
    const storePath = path.join(dir, "sessions.json");
    expect(
      conversationTranscriptExists(storePath, {
        sessionId: "missing",
        sessionFile: path.join(dir, "missing.jsonl"),
      }),
    ).toBe(false);
    const live = path.join(dir, "live.jsonl");
    fs.writeFileSync(live, "{}\n");
    expect(
      conversationTranscriptExists(storePath, {
        sessionId: "live",
        sessionFile: "live.jsonl",
      }),
    ).toBe(true);
  });
});

describe("conversation 1:1 handoff", () => {
  it("does not treat email addresses as robot mentions", async () => {
    const text = "请引导配置个人邮箱 owner+test@example.com，暂不发邮件";
    expect(parseConversationAtMentions(text)).toEqual([]);
    expect(parseConversationAtMentions("请@Skill孵化 核对 owner@example.com")).toEqual([
      "Skill孵化",
    ]);
    const listPeers = vi.fn();
    const injectHostNotice = vi.fn();
    const result = await routeStewardConversationMentions({
      sessionKey: "agent:main:employee:u1",
      messageText: text,
      requesterUserId: "u1",
      tenantId: "tenant-test",
      tenantAdmin: false,
      listPeers,
      injectHostNotice,
    });
    expect(result.handledRobotTask).toBe(false);
    expect(listPeers).not.toHaveBeenCalled();
    expect(injectHostNotice).not.toHaveBeenCalled();
  });

  it("resolves a unique Grok-style @mention to an existing main session", () => {
    expect(parseConversationAtMentions("将任务交给 @Skill孵化 去跑")).toEqual(["Skill孵化"]);
    expect(resolveConversationPeer("Skill孵化", peers)).toMatchObject({
      agentId: "bot-skill",
      sessionKey: "agent:bot-skill:main",
    });
    expect(resolveConversationPeer("bot-skill", peers)?.agentId).toBe("bot-skill");
    expect(resolveConversationPeer("不存在", peers)).toBeNull();
  });

  it("keeps 1:1 keys and rejects collaboration-group keys", () => {
    expect(defaultConversationSessionKey("bot-skill")).toBe("agent:bot-skill:main");
    expect(isGroupConversationKey("agent:bot-skill:main")).toBe(false);
    expect(isGroupConversationKey("agent:main:space:aegis")).toBe(true);
    expect(isGroupConversationKey("agent:bot-skill:main:space:grp-1")).toBe(true);
  });

  it("collects @tokens and strips them from the guest task body", () => {
    expect(
      collectConversationMentionTokens({
        messageText: "@Skill孵化 请确认收到只读验收",
        mentions: [{ target: { kind: "human", agentId: "user-1" } }],
      }),
    ).toEqual(["Skill孵化"]);
    expect(stripResolvedAtMentions("@Skill孵化 请确认收到只读验收", ["Skill孵化"])).toBe(
      "请确认收到只读验收",
    );
  });

  it("keeps user-visible send text to the message and a one-line result", () => {
    expect(
      buildGuestTaskMessage({
        hostSessionKey: "agent:main:employee:u1",
        guestDisplayName: "Skill孵化",
        task: "确认回执",
      }),
    ).toBe("确认回执");
    expect(
      buildHostSendReceipt({
        guestDisplayName: "Skill孵化",
        guestSessionKey: "agent:bot-skill:main",
        task: "确认回执",
      }),
    ).toBe("已发给Skill孵化。");
    expect(
      buildHostFailReceipt({ guestLabel: "Skill孵化", reason: "租户未确认，任务未发出" }),
    ).toBe("没发给Skill孵化。");
    expect(
      buildHostReturnReceipt({
        guestAgentId: "bot-skill",
        guestSessionKey: "agent:bot-skill:main",
        reply: "已确认",
      }),
    ).toBe("已确认");
    expect(conversationReplyNeedsConfirmation("明天的会议是哪一场？")).toBe(true);
    expect(conversationReplyNeedsConfirmation("资料已放在明天的会议文件夹。")).toBe(false);
  });

  it("does not swallow a steward @mention when tenant is missing", async () => {
    const notices: string[] = [];
    const result = await routeStewardConversationMentions({
      sessionKey: "agent:main:employee:u1",
      messageText: "@Skill孵化 请确认收到",
      requesterUserId: "u1",
      tenantId: null,
      tenantAdmin: true,
      dispatch: async () => {
        throw new Error("should not dispatch");
      },
      injectHostNotice: async ({ text }) => {
        notices.push(text);
      },
    });
    expect(result).toEqual({ handledRobotTask: true, dispatched: 0, failed: 1 });
    expect(notices[0]).toBe("没发给Skill孵化。");
  });

  it("dispatches the guest and skips the host steward run", async () => {
    const dispatch = vi.fn(async () => ({
      ok: true,
      reason: "accepted",
      runId: "run-guest",
      targetSessionKey: "agent:bot-skill:main",
      requesterSessionKey: "agent:main:employee:u1",
    }));
    const result = await routeStewardConversationMentions({
      sessionKey: "agent:main:employee:u1",
      messageText: "@Skill孵化 请确认收到只读验收",
      requesterUserId: "u1",
      tenantId: "001",
      tenantAdmin: true,
      listPeers: async () => peers,
      dispatch,
      injectHostNotice: async () => undefined,
    });
    expect(result).toEqual({ handledRobotTask: true, dispatched: 1, failed: 0 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        targetAgentId: "bot-skill",
        waitForReply: false,
        message: "请确认收到只读验收",
      }),
    );
  });

  it("sends a selected human mention to that user id and does not wake a robot", async () => {
    const notifyHuman = vi.fn(async () => true);
    const dispatch = vi.fn(async () => {
      throw new Error("should not dispatch");
    });
    const result = await routeStewardConversationMentions({
      sessionKey: "agent:main:employee:u1",
      messageText: "@王军 明天下午开会",
      mentions: [
        {
          displayName: "王军",
          target: { kind: "human", userId: "user-wang" },
        },
      ],
      requesterUserId: "u1",
      tenantId: "001",
      tenantAdmin: false,
      listPeers: async () => peers,
      dispatch,
      injectHostNotice: async () => undefined,
      notifyHuman,
    });
    expect(dispatch).not.toHaveBeenCalled();
    expect(notifyHuman).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-wang",
        displayName: "王军",
        message: "明天下午开会",
        fromSessionKey: "agent:main:employee:u1",
        fromAgentId: "main",
      }),
    );
    expect(result).toEqual({ handledRobotTask: true, dispatched: 0, failed: 0 });
  });

  it("tells the host when the named guest session is missing", async () => {
    const notices: string[] = [];
    const result = await routeStewardConversationMentions({
      sessionKey: "agent:main:employee:u1",
      messageText: "@Skill孵化 请确认收到",
      requesterUserId: "u1",
      tenantId: "001",
      tenantAdmin: true,
      listPeers: async () => [{ ...peers[0], sessionExists: false }],
      dispatch: async () => {
        throw new Error("should not dispatch");
      },
      injectHostNotice: async ({ text }) => {
        notices.push(text);
      },
    });
    expect(result.handledRobotTask).toBe(true);
    expect(result.dispatched).toBe(0);
    expect(notices[0]).toBe("没发给Skill孵化。");
  });
});

describe("reply lands in the sender session", () => {
  it("reads the inbound robot only when that turn is still the latest user turn", () => {
    const inbound = JSON.stringify({
      message: {
        role: "user",
        content: [{ type: "text", text: "明天下午参加线上会议" }],
        provenance: {
          kind: "inter_session",
          sourceSessionKey: "agent:secretary:main",
          sourceTool: "conversation_send",
        },
      },
    });
    expect(latestInboundInterSessionSource(`${inbound}\n`)).toBe("agent:secretary:main");
    const ownerAfter = JSON.stringify({
      message: { role: "user", content: [{ type: "text", text: "先别回" }] },
    });
    expect(latestInboundInterSessionSource(`${inbound}\n${ownerAfter}\n`)).toBeUndefined();
  });

  it("treats only a peer line posted during this send as already in the chat", () => {
    const line = {
      role: "user",
      timestamp: 2_000,
      content: [{ type: "text", text: "还缺开始时间和链接" }],
      provenance: {
        kind: "inter_session",
        sourceSessionKey: "agent:pm:main",
        sourceTool: "conversation_send",
        sourceSenderLabel: "项目管理",
      },
    };
    expect(isFreshPeerReturn(line, "agent:pm:main", 1_000)).toBe(true);
    expect(isFreshPeerReturn(line, "agent:pm:main", 3_000)).toBe(false);
    expect(isFreshPeerReturn({ ...line, role: "assistant" }, "agent:pm:main", 1_000)).toBe(false);
    expect(
      isFreshPeerReturn(
        {
          ...line,
          provenance: { ...line.provenance, sourceTool: "other" },
        },
        "agent:pm:main",
        1_000,
      ),
    ).toBe(false);
  });
});
