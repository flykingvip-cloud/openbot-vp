import { describe, expect, test } from "vitest";
import {
  TURN_PROCESS_LOOKUP_EN,
  TURN_PROCESS_LOOKUP_ZH,
  TURN_PROCESS_WORKING_EN,
  TURN_PROCESS_WORKING_ZH,
  formatCollaborationReplyLanguageInstruction,
  formatTurnProcessPlaceholder,
  resolveCollaborationReplyLanguage,
  sanitizeCollaborationVisibleReply,
  stripReplyLanguageSample,
} from "./reply-language.js";

describe("resolveCollaborationReplyLanguage", () => {
  test("uses a persistent group language contract when set", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: "Please reply in English",
        groupLanguage: "zh",
      }),
    ).toBe("zh");
  });

  test("prefers the latest user message language", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: "王老师今天给你们布置新任务了吗",
        inboundHistory: [{ sender: "CEO", body: "Please reply in English only for this thread." }],
      }),
    ).toBe("zh");
  });

  test("falls back to recent human history when user message is ambiguous", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: "ok",
        inboundHistory: [
          { sender: "招聘经理", body: "I'm ready." },
          { sender: "CEO", body: "请大家确认一下今天有没有新任务" },
        ],
        humanNames: ["CEO", "王军"],
        botNames: ["招聘经理", "薪酬专业经理"],
      }),
    ).toBe("zh");
  });

  test("keeps Chinese when the user sentence only adds a short latin token", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: "[Mon 2026-09-28 12:35 UTC] 请重新生成这份ppt",
      }),
    ).toBe("zh");
  });

  test("does not let an English focus fence flip a Chinese request", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: [
          "[FOCUS_CANCELLED]",
          "Previous tasks in this conversation are cancelled. Do not continue, complete, summarize, or reuse their goals or unfinished work. Execute only the current user message.",
          "",
          "将上面的ppt生成报告",
        ].join("\n"),
      }),
    ).toBe("zh");
  });

  test("strips system envelopes before counting letters", () => {
    expect(
      stripReplyLanguageSample(
        "[Mon 2026-09-28 12:40 UTC] [FOCUS_CANCELLED]\n上一任务已取消。不要继续未完成的步骤。\n\n重新同步",
      ),
    ).toBe("重新同步");
  });

  test("ignores compaction / bot envelopes when scanning history", () => {
    expect(
      resolveCollaborationReplyLanguage({
        userMessage: "??",
        inboundHistory: [
          {
            sender: "用户",
            body: "Pre-compaction memory flush. Store durable memories only in memory/2026-08-12.md",
          },
          { sender: "助手", body: "Looking at the chat history, I should add incremental value." },
          { sender: "CEO", body: "Did Wang assign any new tasks today for the team?" },
        ],
        humanNames: ["CEO"],
        botNames: ["招聘经理"],
      }),
    ).toBe("en");
  });
});

describe("sanitizeCollaborationVisibleReply", () => {
  const leakedPlanning = [
    'The CEO (黄老师, per 王军\'s clarification that CEO = his friend 黄老师) is asking: "王老师今天给你们布置新任务了吗".',
    "This is a direct question from the CEO (黄老师). I'm 招聘经理. Looking at the chat history: 文化总监 (lead) has already answered this question.",
    "Per my role as a supplement in this round, I should NOT repeat the full answer already given by 文化总监. I should provide incremental value only.",
    "As 招聘经理, what incremental value can I add? Let me keep it very brief to avoid repetition: confirm no new task,",
  ].join("\n\n");

  test("suppresses mixed Chinese/English planning drafts for zh users", () => {
    const result = sanitizeCollaborationVisibleReply({
      text: leakedPlanning,
      expectedLanguage: "zh",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/language_planning/);
    }
  });

  test("keeps Chinese reply with brief Chinese meta-reasoning", () => {
    const text = [
      "先核对同轮结论：文化总监已说明今天没有新任务。",
      "黄老师好，我是薪酬专业经理。王军老师今天没有布置新任务；营销副总成果已收口，静候审阅。",
    ].join("\n\n");
    const result = sanitizeCollaborationVisibleReply({
      text,
      expectedLanguage: "zh",
    });
    expect(result).toEqual({ ok: true, text, trimmed: false });
  });

  test("keeps the Chinese answer when an English planning preface is mixed in", () => {
    const text = [
      "Looking at the chat history, I should provide incremental value only and not repeat the full answer.",
      "黄老师好，我是招聘经理。王军老师今天没有布置新任务，岗位说明书已交付待审。",
    ].join("\n\n");
    const result = sanitizeCollaborationVisibleReply({
      text,
      expectedLanguage: "zh",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trimmed).toBe(true);
      expect(result.text).toContain("我是招聘经理");
      expect(result.text).not.toContain("incremental value");
    }
  });

  test("keeps English replies for English users", () => {
    const text =
      "Quick check: the coordinator already covered status. No new task from Wang today; deliverables await review.";
    expect(
      sanitizeCollaborationVisibleReply({
        text,
        expectedLanguage: "en",
      }),
    ).toEqual({ ok: true, text, trimmed: false });
  });

  test("strips short English planning openers for zh users", () => {
    const result = sanitizeCollaborationVisibleReply({
      text: "I'll start by looking at my workspace to see what's there.",
      expectedLanguage: "zh",
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("wrong_language_planning");
    }
  });

  test.each([
    "I'll fetch the latest workspace files first.",
    "I'll gather the matching notes and then answer.",
    "I'll check the local export folder next.",
    "I'll look through the current workspace.",
    "Now I inspect the session transcript.",
    "Good — I'll start with the local paths.",
  ])("strips %s for zh users", (text) => {
    const result = sanitizeCollaborationVisibleReply({
      text,
      expectedLanguage: "zh",
    });
    expect(result.ok).toBe(false);
  });

  test("keeps English planning-status for English users", () => {
    const text = "I'll start by looking at my workspace to see what's there.";
    expect(
      sanitizeCollaborationVisibleReply({
        text,
        expectedLanguage: "en",
      }),
    ).toEqual({ ok: true, text, trimmed: false });
  });

  test("keeps the Chinese answer after an I'll-start English preface", () => {
    const result = sanitizeCollaborationVisibleReply({
      text: [
        "I'll start by looking at my workspace to see what's there.",
        "本机目录已经核对完，微信导出需要先放到本地导出目录。",
      ].join("\n\n"),
      expectedLanguage: "zh",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.trimmed).toBe(true);
      expect(result.text).toContain("本机目录已经核对完");
      expect(result.text).not.toContain("I'll start");
    }
  });

  test("strips leaked DSML so protocol text never reaches the group transcript", () => {
    const result = sanitizeCollaborationVisibleReply({
      text: [
        "我继续盘点技能。",
        "<｜｜DSML｜｜tool_calls>",
        '<｜｜DSML｜｜invoke name="exec">',
        '<｜｜DSML｜｜parameter name="command" string="true">ls</｜｜DSML｜｜parameter>',
        "</｜｜DSML｜｜invoke>",
        "</｜｜DSML｜｜tool_calls>",
      ].join("\n"),
      expectedLanguage: "zh",
    });
    expect(result).toEqual({ ok: true, text: "我继续盘点技能。", trimmed: true });
  });
});

describe("formatCollaborationReplyLanguageInstruction", () => {
  test("emits zh/en/neutral instructions that lock thinking and reply", () => {
    expect(formatCollaborationReplyLanguageInstruction("zh")).toContain(
      "思考过程不得出现在回复正文里",
    );
    expect(formatCollaborationReplyLanguageInstruction("zh")).not.toContain("允许简短中文元推理");
    expect(formatCollaborationReplyLanguageInstruction("en")).toContain(
      "Think and reply in English",
    );
    expect(formatCollaborationReplyLanguageInstruction(null)).toContain(
      "Reasoning must never appear in the reply text",
    );
  });
});

describe("formatTurnProcessPlaceholder", () => {
  test("uses the existing Chinese process sentences by default", () => {
    expect(formatTurnProcessPlaceholder("zh", "lookup")).toBe(TURN_PROCESS_LOOKUP_ZH);
    expect(formatTurnProcessPlaceholder("zh", "working")).toBe(TURN_PROCESS_WORKING_ZH);
    expect(formatTurnProcessPlaceholder(null, "lookup")).toBe(TURN_PROCESS_LOOKUP_ZH);
    expect(TURN_PROCESS_LOOKUP_ZH).toBe("正在查资料");
    expect(TURN_PROCESS_WORKING_ZH).toBe("正在处理");
  });

  test("follows English when the user asked in English", () => {
    expect(formatTurnProcessPlaceholder("en", "lookup")).toBe(TURN_PROCESS_LOOKUP_EN);
    expect(formatTurnProcessPlaceholder("en", "working")).toBe(TURN_PROCESS_WORKING_EN);
  });
});
