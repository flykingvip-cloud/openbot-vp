import { describe, expect, it } from "vitest";
import {
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
    ).not.toContain("未产出正文");
    expect(
      formatCollaborationRoundAbortNotice({
        agentName: "高密度分析",
        skipReason: "empty",
      }),
    ).toContain("未产出正文");
  });
});

describe("formatCollaborationRoundAbortNotice", () => {
  it("explains silent, timeout, and crash outcomes in user-facing Chinese", () => {
    expect(
      formatCollaborationRoundAbortNotice({ agentName: "熊猫学习", skipReason: "silent" }),
    ).toContain("换个更具体的问题");
    expect(formatCollaborationRoundAbortNotice({ skipReason: "timeout" })).toContain("@备用成员");
    expect(
      formatCollaborationRoundAbortNotice({
        skipReason: "crash",
        errorMessage: "数字人执行中断，请再试一次",
      }),
    ).toContain("@其他成员接手");
    expect(formatCollaborationRoundAbortNotice({ skipReason: "duplicate" })).toContain(
      "补充新角度",
    );
  });
});

describe("formatCollaborationDispatchFailure", () => {
  it("maps module-not-found to a retryable user sentence", () => {
    expect(
      formatCollaborationDispatchFailure(
        new Error("Cannot find module '/tmp/dist/auth-profiles-x.js': code=ERR_MODULE_NOT_FOUND"),
      ),
    ).toBe("数字人执行中断，请再试一次");
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
