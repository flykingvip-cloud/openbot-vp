import { describe, expect, it } from "vitest";
import { buildKnowledgePublishIntent } from "../../gateway/knowledge/publish-intent.js";
import {
  classifyInboundDepth,
  derivePreviousInboundDepthFromMessages,
  hasUnfinishedToolRunInMessages,
  INBOUND_DEPTH_CLASSIFIER_VERSION,
  isInboundContinuation,
  isInboundDepthEmployeeStewardSession,
  resolveInboundSessionKind,
  shouldApplyChatLaneSkip,
  shouldApplyRetrieveKnowledgePolicy,
  shouldApplyRetrieveToolPolicy,
  detectExplicitLiveIntent,
  type InboundDepthInput,
} from "./inbound-depth.js";

function baseInput(overrides: Partial<InboundDepthInput> = {}): InboundDepthInput {
  return {
    text: "",
    hasAttachments: false,
    hasLinks: false,
    sessionKind: "employee",
    hasUnfinishedToolRun: false,
    hasExplicitKnowledgeIntent: false,
    hasExplicitWriteIntent: false,
    hasExplicitPublishIntent: false,
    ...overrides,
  };
}

describe("classifyInboundDepth", () => {
  it("classifies conservative table cases", () => {
    const rows: Array<{ name: string; input: InboundDepthInput; depth: string; reason: string }> = [
      {
        name: "zh greeting",
        input: baseInput({ text: "晚上好" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "en greeting",
        input: baseInput({ text: "good evening" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "explain",
        input: baseInput({ text: "用一句话解释什么是知识库" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "rewrite",
        input: baseInput({ text: "把这句话改得更礼貌：赶紧处理" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "followup without tool",
        input: baseInput({ text: "然后呢", previousDepth: "act" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "steward project risk",
        input: baseInput({ text: "帮我看一下本周项目风险" }),
        depth: "retrieve",
        reason: "steward_knowledge_intent",
      },
      {
        name: "steward mark read",
        input: baseInput({ text: "把这条消息标记已读" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward send email",
        input: baseInput({ text: "发一封邮件给 daniel@example.com" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward set reminder",
        input: baseInput({ text: "定个提醒" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward book meeting zh",
        input: baseInput({ text: "预订会议" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward schedule meeting zh short",
        input: baseInput({ text: "约个会" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward arrange meeting zh",
        input: baseInput({ text: "安排会议" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward book meeting en",
        input: baseInput({ text: "book a meeting with the team" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "steward schedule meeting en",
        input: baseInput({ text: "schedule a meeting for tomorrow" }),
        depth: "act",
        reason: "steward_operational_intent",
      },
      {
        name: "meeting book stays chat outside employee",
        input: baseInput({ text: "预订会议", sessionKind: "other" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "knowledge minutes",
        input: baseInput({ text: "帮我查一下上周的会议纪要" }),
        depth: "retrieve",
        reason: "explicit_knowledge_query",
      },
      {
        name: "knowledge base",
        input: baseInput({ text: "查询知识库里的差旅政策" }),
        depth: "retrieve",
        reason: "explicit_knowledge_query",
      },
      {
        name: "write workspace",
        input: baseInput({ text: "把结论写入工作区 notes.md" }),
        depth: "act",
        reason: "explicit_write_or_side_effect",
      },
      {
        name: "publish nl",
        input: baseInput({ text: "把这份草稿发布到知识库" }),
        depth: "act",
        reason: "explicit_publish_intent",
      },
      {
        name: "wechat typeset and publish go",
        input: baseInput({ text: "开始排版和发布这篇文章到公众号" }),
        depth: "act",
        reason: "execution_typeset_or_channel_publish",
      },
      {
        name: "explain typesetting stays chat",
        input: baseInput({ text: "用一句话解释什么是排版" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "attachment no verb",
        input: baseInput({ text: "看看这个", hasAttachments: true }),
        depth: "chat",
        reason: "attachments_without_task_verb",
      },
      {
        name: "link only",
        input: baseInput({ text: "https://example.com/doc", hasLinks: true }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "fuzzy request",
        input: baseInput({ text: "帮我处理一下这个" }),
        depth: "chat",
        reason: "default_chat",
      },
      {
        name: "open cloud pc and log in",
        input: baseInput({ text: "我需要你直接打开云端电脑，登录京东" }),
        depth: "act",
        reason: "account_computer_browser",
      },
      {
        name: "public page fetch does not open the cloud pc",
        input: baseInput({
          text: "抓取 https://example.com 公开首页标题，不要打开云电脑",
          hasLinks: true,
        }),
        depth: "retrieve",
        reason: "public_web_tool",
      },
      {
        name: "cloud pc outside employee sessions",
        input: baseInput({
          text: "Open the cloud PC and log in",
          sessionKind: "other",
        }),
        depth: "act",
        reason: "account_computer_browser",
      },
      {
        name: "knowledge query wins over login wording",
        input: baseInput({ text: "查询知识库里的登录方式" }),
        depth: "retrieve",
        reason: "explicit_knowledge_query",
      },
    ];

    for (const row of rows) {
      const result = classifyInboundDepth(row.input);
      expect(result.depth, row.name).toBe(row.depth);
      expect(result.reasons, row.name).toContain(row.reason);
      expect(result.classifierVersion).toBe(INBOUND_DEPTH_CLASSIFIER_VERSION);
      expect(JSON.stringify(result)).not.toContain(row.input.text);
    }
  });

  it("reuses the publish-intent parser for structured handoff messages", () => {
    const draft = buildKnowledgePublishIntent({
      objectId: "obj-1",
      objectTitle: "差旅政策",
      provider: "personal-email",
      suggestedAction: "send",
    }).draftMessage;
    const result = classifyInboundDepth(baseInput({ text: draft }));
    expect(result.depth).toBe("act");
    expect(result.reasons).toEqual(["explicit_publish_intent"]);
    expect(result.routeStrength).toBe("explicit");
    expect(result.ceiling.maxToolMode).toBe("write");
  });

  it("keeps an authorized channel publish on the act lane outside steward sessions", () => {
    const rows = [
      "开始排版和发布这篇文章到公众号",
      "帮我排版并发布到公众号",
      "把这篇文章推到草稿箱",
      "继续排版",
      "typeset and publish this article",
      "publish this article to wechat",
    ];
    for (const text of rows) {
      const result = classifyInboundDepth(baseInput({ text, sessionKind: "other" }));
      expect(result.depth, text).toBe("act");
      expect(result.reasons, text).toEqual(["execution_typeset_or_channel_publish"]);
      expect(result.ceiling.maxToolMode, text).toBe("write");
      expect(shouldApplyChatLaneSkip({ routerEnabled: true, depth: result.depth })).toBe(false);
      expect(JSON.stringify(result)).not.toContain(text);
    }

    for (const text of ["公众号下周发什么选题", "发布会几点开始", "帮我处理一下这个"]) {
      const result = classifyInboundDepth(baseInput({ text, sessionKind: "employee" }));
      expect(result.depth, text).toBe("chat");
      expect(result.reasons, text).toEqual(["default_chat"]);
    }
  });

  it("inherits previous depth only when a tool run is unfinished", () => {
    const inherited = classifyInboundDepth(
      baseInput({
        text: "继续",
        previousDepth: "act",
        hasUnfinishedToolRun: true,
      }),
    );
    expect(inherited.depth).toBe("act");
    expect(inherited.reasons).toEqual(["continuation_unfinished_tool"]);
    expect(inherited.routeStrength).toBe("weak");

    const ignored = classifyInboundDepth(
      baseInput({
        text: "继续",
        previousDepth: "act",
        hasUnfinishedToolRun: false,
      }),
    );
    expect(ignored.depth).toBe("chat");
  });

  it("does not treat routeStrength as a numeric probability", () => {
    const result = classifyInboundDepth(baseInput({ text: "晚上好" }));
    expect(["explicit", "strong", "weak", "unknown"]).toContain(result.routeStrength);
    expect(result).not.toHaveProperty("confidence");
    expect(result).not.toHaveProperty("probability");
  });

  it("stays under 10ms p99 on a local burst", () => {
    const samples: number[] = [];
    for (let i = 0; i < 400; i += 1) {
      const started = performance.now();
      classifyInboundDepth(baseInput({ text: i % 2 === 0 ? "晚上好" : "查询知识库里的差旅政策" }));
      samples.push(performance.now() - started);
    }
    const sorted = samples.toSorted((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)] ?? 0;
    expect(p99).toBeLessThan(10);
  });
});

describe("resolveInboundSessionKind", () => {
  it("maps employee steward, space, and other keys", () => {
    expect(
      resolveInboundSessionKind("agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2"),
    ).toBe("employee");
    expect(resolveInboundSessionKind("agent:main:space:group-1")).toBe("space");
    expect(resolveInboundSessionKind("main")).toBe("other");
  });
});

describe("isInboundDepthEmployeeStewardSession", () => {
  it("accepts personal employee steward keys on the main agent", () => {
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2",
        agentId: "main",
      }),
    ).toBe(true);
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:main:space:group-1",
        agentId: "main",
      }),
    ).toBe(false);
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2",
        agentId: "analyst",
      }),
    ).toBe(false);
  });
  it("accepts allowlisted agents on employee keys, excludes spaces, honors case", () => {
    const key = "agent:main:employee:c7f8e59e-4705-4fe0-a763-5fa62d66e6f2";
    // allowlisted custom agent on an employee session -> in scope
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: key,
        agentId: "analyst",
        allowlist: ["analyst"],
      }),
    ).toBe(true);
    // case-insensitive match
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: key,
        agentId: "Analyst",
        allowlist: ["analyst"],
      }),
    ).toBe(true);
    // not in the allowlist -> out of scope
    expect(
      isInboundDepthEmployeeStewardSession({ sessionKey: key, agentId: "analyst", allowlist: [] }),
    ).toBe(false);
    // empty agentId is still treated as the default main steward -> in scope
    expect(
      isInboundDepthEmployeeStewardSession({ sessionKey: key, agentId: "", allowlist: [] }),
    ).toBe(true);
    // allowlist never overrides the employee session-kind requirement (space stays excluded)
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:main:space:group-1",
        agentId: "analyst",
        allowlist: ["analyst"],
      }),
    ).toBe(false);
  });
  it("accepts an allowlisted custom agent's primary personal session (agent:<id>:main), excluding its spaces", () => {
    // A custom assistant's primary 1:1 session is agent:<id>:main, which resolves
    // to "other" (not "employee"); the allowlist must still bring it into scope.
    expect(resolveInboundSessionKind("agent:bot-skill:main")).toBe("other");
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:bot-skill:main",
        agentId: "bot-skill",
        allowlist: ["bot-skill"],
      }),
    ).toBe(true);
    // case-insensitive on the agentId
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:bot-skill:main",
        agentId: "Bot-Skill",
        allowlist: ["bot-skill"],
      }),
    ).toBe(true);
    // the same agent's collaboration space stays excluded (rest !== "main")
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:bot-skill:main:space:grp-1",
        agentId: "bot-skill",
        allowlist: ["bot-skill"],
      }),
    ).toBe(false);
    // primary session but the agent is not allowlisted -> out of scope
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:bot-skill:main",
        agentId: "bot-skill",
        allowlist: [],
      }),
    ).toBe(false);
    // main's own non-employee primary session is not brought in by this path
    expect(
      isInboundDepthEmployeeStewardSession({
        sessionKey: "agent:main:main",
        agentId: "main",
        allowlist: ["bot-skill"],
      }),
    ).toBe(false);
  });
});

describe("hasUnfinishedToolRunInMessages", () => {
  it("detects unpaired tool calls and ignores completed or generation-only turns", () => {
    expect(
      hasUnfinishedToolRunInMessages([
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_write_1", name: "write" }],
        },
      ]),
    ).toBe(true);
    expect(
      hasUnfinishedToolRunInMessages([
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_write_1", name: "write" }],
        },
        { role: "toolResult", toolCallId: "call_write_1" },
      ]),
    ).toBe(false);
    expect(
      hasUnfinishedToolRunInMessages([
        { role: "assistant", content: [{ type: "text", text: "正在思考" }] },
      ]),
    ).toBe(false);
  });
});

describe("derivePreviousInboundDepthFromMessages", () => {
  it("reclassifies the last non-continuation user turn from transcript", () => {
    expect(isInboundContinuation("继续")).toBe(true);
    expect(isInboundContinuation("晚上好")).toBe(false);
    expect(
      derivePreviousInboundDepthFromMessages([
        { role: "user", content: "把结论写入工作区 notes.md" },
        {
          role: "assistant",
          content: [{ type: "toolCall", id: "call_write_1", name: "write" }],
        },
        { role: "user", content: "继续" },
      ]),
    ).toBe("act");
    expect(
      derivePreviousInboundDepthFromMessages([
        { role: "user", content: "查询知识库里的差旅政策" },
        { role: "user", content: "然后呢" },
      ]),
    ).toBe("retrieve");
    expect(derivePreviousInboundDepthFromMessages([{ role: "user", content: "晚上好" }])).toBe(
      "chat",
    );
    expect(derivePreviousInboundDepthFromMessages([{ role: "user", content: "继续" }])).toBe(
      undefined,
    );
  });
});

describe("shouldApplyChatLaneSkip", () => {
  it("applies for depth=chat when router is on, or steward already classified (classify-only)", () => {
    expect(shouldApplyChatLaneSkip({ routerEnabled: false, depth: "chat" })).toBe(false);
    expect(
      shouldApplyChatLaneSkip({
        routerEnabled: false,
        depth: "chat",
        stewardClassified: true,
      }),
    ).toBe(true);
    expect(shouldApplyChatLaneSkip({ routerEnabled: true, depth: "retrieve" })).toBe(false);
    expect(shouldApplyChatLaneSkip({ routerEnabled: true, depth: "act" })).toBe(false);
    expect(
      shouldApplyChatLaneSkip({
        routerEnabled: false,
        depth: "act",
        stewardClassified: true,
      }),
    ).toBe(false);
    expect(shouldApplyChatLaneSkip({ routerEnabled: true, depth: undefined })).toBe(false);
    expect(shouldApplyChatLaneSkip({ routerEnabled: true, depth: "chat" })).toBe(true);
  });
});

describe("shouldApplyRetrieveKnowledgePolicy", () => {
  it("applies only when the knowledge policy flag is on and depth is retrieve", () => {
    expect(
      shouldApplyRetrieveKnowledgePolicy({ knowledgePolicyEnabled: false, depth: "retrieve" }),
    ).toBe(false);
    expect(
      shouldApplyRetrieveKnowledgePolicy({ knowledgePolicyEnabled: true, depth: "chat" }),
    ).toBe(false);
    expect(shouldApplyRetrieveKnowledgePolicy({ knowledgePolicyEnabled: true, depth: "act" })).toBe(
      false,
    );
    expect(
      shouldApplyRetrieveKnowledgePolicy({ knowledgePolicyEnabled: true, depth: undefined }),
    ).toBe(false);
    expect(
      shouldApplyRetrieveKnowledgePolicy({ knowledgePolicyEnabled: true, depth: "retrieve" }),
    ).toBe(true);
  });
});

describe("shouldApplyRetrieveToolPolicy", () => {
  it("applies only when the tool policy flag is on and depth is retrieve", () => {
    expect(shouldApplyRetrieveToolPolicy({ toolPolicyEnabled: false, depth: "retrieve" })).toBe(
      false,
    );
    expect(shouldApplyRetrieveToolPolicy({ toolPolicyEnabled: true, depth: "chat" })).toBe(false);
    expect(shouldApplyRetrieveToolPolicy({ toolPolicyEnabled: true, depth: "act" })).toBe(false);
    expect(shouldApplyRetrieveToolPolicy({ toolPolicyEnabled: true, depth: undefined })).toBe(
      false,
    );
    expect(shouldApplyRetrieveToolPolicy({ toolPolicyEnabled: true, depth: "retrieve" })).toBe(
      true,
    );
  });
});

describe("detectExplicitLiveIntent", () => {
  it("requires an explicit live or API cue", () => {
    expect(detectExplicitLiveIntent("查询知识库里的差旅政策")).toBe(false);
    expect(detectExplicitLiveIntent("查询雪球最新实时数据")).toBe(true);
  });
});
