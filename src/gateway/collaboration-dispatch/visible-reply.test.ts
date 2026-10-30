import { describe, expect, it } from "vitest";
import {
  classifyCollaborationAbortIntent,
  collaborationInfraFailureDetail,
  collaborationSkipReasonForMissingReply,
  formatCollaborationDispatchFailure,
  formatCollaborationRoundAbortNotice,
  normalizeVisibleCollaborationReply,
  recoverLatestVisibleAssistantText,
} from "./visible-reply.js";

describe("normalizeVisibleCollaborationReply", () => {
  it("keeps a finished draft after stripping reply tags", () => {
    expect(
      normalizeVisibleCollaborationReply(
        "[[reply_to_current]]老大，三个模块的骨架立得住，建议把整场调成一条主线。",
      ),
    ).toContain("三个模块的骨架立得住");
  });

  it("drops silent and placeholder replies", () => {
    expect(normalizeVisibleCollaborationReply("NO_REPLY")).toBeNull();
    expect(normalizeVisibleCollaborationReply("收到")).toBeNull();
    expect(normalizeVisibleCollaborationReply("   ")).toBeNull();
  });

  it("drops Chinese silence paraphrases like 无需回复", () => {
    expect(normalizeVisibleCollaborationReply("无需回复")).toBeNull();
    expect(normalizeVisibleCollaborationReply("不用回复")).toBeNull();
    expect(normalizeVisibleCollaborationReply("无增量")).toBeNull();
    expect(
      collaborationSkipReasonForMissingReply({
        combinedReplyRaw: "无需回复",
        messages: [],
        sinceMs: 0,
      }),
    ).toBe("silent");
  });
});

describe("recoverLatestVisibleAssistantText", () => {
  const sinceMs = 1_780_000_000_000;

  it("recovers the latest in-turn assistant draft and ignores older turns", () => {
    const recovered = recoverLatestVisibleAssistantText({
      sinceMs,
      messages: [
        {
          role: "assistant",
          timestamp: sinceMs - 60_000,
          content: [{ type: "text", text: "上一轮《组织新未来》总结报告" }],
        },
        {
          role: "user",
          timestamp: sinceMs + 10,
          content: [{ type: "text", text: "继续前面的任务" }],
        },
        {
          role: "assistant",
          timestamp: sinceMs + 1_200,
          content: [
            {
              type: "text",
              text: "[[reply_to_current]]30分钟建议这样分配：开场 3 分钟，定义 8 分钟。",
            },
          ],
        },
      ],
    });
    expect(recovered).toBe("30分钟建议这样分配：开场 3 分钟，定义 8 分钟。");
  });

  it("skips NO_REPLY even when it is the latest assistant line", () => {
    expect(
      recoverLatestVisibleAssistantText({
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 400,
            content: [{ type: "text", text: "NO_REPLY" }],
          },
        ],
      }),
    ).toBeNull();
  });

  it("does not throw when the transcript list is missing", () => {
    expect(
      recoverLatestVisibleAssistantText({
        sinceMs,
        messages: undefined,
      }),
    ).toBeNull();
  });

  it("recovers sibling text from a mixed tool, thinking, and hole shape", () => {
    const essay = "这一轮的可见回复已经写好。";
    expect(
      recoverLatestVisibleAssistantText({
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 800,
            content: [
              { type: "thinking", thinking: "plan" },
              null,
              { type: "text", text: essay },
              { type: "toolCall", name: "search" },
            ],
          },
        ],
      }),
    ).toBe(essay);
  });
});

describe("collaborationInfraFailureDetail", () => {
  it("turns an AccountWorkerFailedError empty turn into the docker CLI notice", () => {
    const detail = collaborationInfraFailureDetail({
      sinceMs: 1_780_000_000_000,
      combinedReplyRaw: "",
      messages: [
        {
          role: "assistant",
          timestamp: 1_780_000_000_500,
          content: [
            {
              type: "text",
              text: "⚠️ Agent failed before reply: AccountWorkerFailedError: Sandbox mode requires Docker, but the docker command was not found in PATH.",
            },
          ],
        },
      ],
    });
    expect(detail).toContain("DOCKER_CLI_MISSING");
    expect(
      formatCollaborationRoundAbortNotice({
        agentName: "高密度分析",
        skipReason: "crash",
        errorMessage: detail ?? undefined,
      }),
    ).not.toMatch(/没能交上正文|未产出正文/);
    expect(
      formatCollaborationRoundAbortNotice({
        agentName: "高密度分析",
        skipReason: "empty",
      }),
    ).toContain("没能交上正文");
    expect(
      formatCollaborationRoundAbortNotice({
        agentName: "高密度分析",
        skipReason: "empty",
      }),
    ).not.toContain("本轮没有形成可见回复");
  });
});

describe("classifyCollaborationAbortIntent", () => {
  it("classifies continue, nudge, deliver, and divert heuristics", () => {
    expect(classifyCollaborationAbortIntent("请继续写下一章")).toBe("continue");
    expect(classifyCollaborationAbortIntent("催办立刻续跑")).toBe("nudge");
    expect(classifyCollaborationAbortIntent("请交付 binding 成果")).toBe("deliver");
    expect(classifyCollaborationAbortIntent("电脑占用请 divert")).toBe("divert");
    expect(classifyCollaborationAbortIntent("随便问一句")).toBe("none");
    expect(classifyCollaborationAbortIntent(undefined)).toBe("none");
  });
});

describe("formatCollaborationRoundAbortNotice", () => {
  it("uses assistant tone without the rigid brand-header prefix", () => {
    const notice = formatCollaborationRoundAbortNotice({
      agentName: "熊猫学习",
      skipReason: "empty",
    });
    expect(notice).not.toContain("本轮没有形成可见回复");
    expect(notice).toMatch(/^我理解/);
    expect(notice).toContain("没能交上正文");
  });

  it("explains silent, timeout, crash, duplicate, and empty outcomes", () => {
    expect(
      formatCollaborationRoundAbortNotice({ agentName: "熊猫学习", skipReason: "silent" }),
    ).toContain("静默回执");
    expect(
      formatCollaborationRoundAbortNotice({ agentName: "熊猫学习", skipReason: "silent" }),
    ).toContain("换个更具体的问题");
    expect(formatCollaborationRoundAbortNotice({ skipReason: "timeout" })).toContain("@备用成员");
    expect(formatCollaborationRoundAbortNotice({ skipReason: "timeout" })).toContain("超时");
    expect(
      formatCollaborationRoundAbortNotice({
        skipReason: "crash",
        errorMessage: "数字人执行中断，请再试一次",
      }),
    ).toContain("@其他成员接手");
    expect(
      formatCollaborationRoundAbortNotice({
        skipReason: "crash",
        errorMessage: "数字人执行中断，请再试一次",
      }),
    ).toContain("执行中断");
    expect(formatCollaborationRoundAbortNotice({ skipReason: "duplicate" })).toContain(
      "补充新角度",
    );
    expect(
      formatCollaborationRoundAbortNotice({ agentName: "高密度分析", skipReason: "empty" }),
    ).toContain("没能交上正文");
  });

  it("uses the generic shell when there is no intent signal", () => {
    const notice = formatCollaborationRoundAbortNotice({
      userText: "你好，在吗",
    });
    expect(notice).not.toContain("本轮没有形成可见回复");
    expect(notice).toContain("稍后再发或缩短问题重试");
    expect(notice).toContain("@其他成员接手");
    expect(notice).toContain("补充目标/约束后重发");
    expect(notice).toContain("续写、催办还是交付");
  });

  it("branches for continue and deliver intents while naming the agent", () => {
    const continueNotice = formatCollaborationRoundAbortNotice({
      agentName: "熊猫学习",
      skipReason: "empty",
      userText: "请继续写下一章",
    });
    expect(continueNotice).toContain("熊猫学习");
    expect(continueNotice).toContain("续写");
    expect(continueNotice).toContain("请继续");
    expect(continueNotice).not.toContain("本轮没有形成可见回复");

    const deliverNotice = formatCollaborationRoundAbortNotice({
      agentName: "CEO助理",
      skipReason: "empty",
      userText: "请交付本周成果 binding",
    });
    expect(deliverNotice).toContain("CEO助理");
    expect(deliverNotice).toMatch(/交付|成果/);
    expect(deliverNotice).toContain("binding");
    expect(deliverNotice).not.toContain("本轮没有形成可见回复");
  });
});

describe("formatCollaborationDispatchFailure", () => {
  it("maps module-not-found to a retryable user sentence", () => {
    expect(
      formatCollaborationDispatchFailure(
        new Error("Cannot find module '/tmp/dist/auth-profiles-x.js': code=ERR_MODULE_NOT_FOUND"),
      ),
    ).toContain("请再试一次");
  });

  it("maps common failures and never returns bare 协作回合执行失败", () => {
    expect(
      formatCollaborationDispatchFailure(new Error("workspace_authorization_failed")),
    ).toContain("工作区未授权");
    expect(formatCollaborationDispatchFailure(new Error("ETIMEDOUT waiting"))).toContain("超时");
    expect(formatCollaborationDispatchFailure(new Error("AbortError"))).toContain("中断");
    const unknown = formatCollaborationDispatchFailure(new Error("some-weird-infra-xyz"));
    expect(unknown).not.toBe("协作回合执行失败");
    expect(unknown).not.toContain("协作回合执行失败");
    expect(unknown).toMatch(/重试|接手/);
  });
});

describe("collaborationSkipReasonForMissingReply", () => {
  it("treats a stored NO_REPLY as silence when the delivered text was stripped", () => {
    const sinceMs = 1_780_000_000_000;
    expect(
      collaborationSkipReasonForMissingReply({
        combinedReplyRaw: "",
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 20,
            content: [{ type: "text", text: "NO_REPLY" }],
          },
        ],
      }),
    ).toBe("silent");
  });

  it("treats a missing transcript as an empty reply, not a length crash", () => {
    expect(
      collaborationSkipReasonForMissingReply({
        combinedReplyRaw: "",
        sinceMs: 1_780_000_000_000,
        messages: undefined,
      }),
    ).toBe("empty");
    expect(
      collaborationInfraFailureDetail({
        combinedReplyRaw: "",
        sinceMs: 1_780_000_000_000,
        messages: undefined,
      }),
    ).toBeNull();
  });

  it("classifies a silent token beside a tool block as silence, and blank text as empty", () => {
    const sinceMs = 1_780_000_000_000;
    expect(
      collaborationSkipReasonForMissingReply({
        combinedReplyRaw: "",
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 30,
            content: [
              { type: "text", text: "NO_REPLY" },
              { type: "toolCall", name: "search" },
            ],
          },
        ],
      }),
    ).toBe("silent");
    expect(
      collaborationSkipReasonForMissingReply({
        combinedReplyRaw: "",
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 40,
            content: [{ type: "text", text: "   " }, null],
          },
        ],
      }),
    ).toBe("empty");
    expect(
      recoverLatestVisibleAssistantText({
        sinceMs,
        messages: [
          {
            role: "assistant",
            timestamp: sinceMs + 40,
            content: [{ type: "text", text: "   " }],
          },
        ],
      }),
    ).toBeNull();
  });
});
