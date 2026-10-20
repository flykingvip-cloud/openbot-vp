import { describe, expect, it } from "vitest";
import {
  isCronParkedNoticeMessage,
  parseCronResultSurfaceSections,
  readCronResultMessageMeta,
  resolveCronResultArtifactRecord,
  resolveImplicitCronReplyContext,
} from "./cron-result-message.ts";

const SAMPLE_MESSAGE = [
  "**定时任务结果** · 市场分析",
  "",
  "## 任务摘要",
  "",
  "**状态**：✅ 成功",
  "**耗时**：1 分 5 秒",
  "",
  "共 12 个 Skill",
  "",
  "## 任务成果",
  "",
  "| id | name |",
  "| --- | --- |",
  "| notion | Notion |",
  "",
  "---",
  "",
  "任务 ID：`abc-123`",
].join("\n");

describe("parseCronResultSurfaceSections", () => {
  it("splits new three-part template", () => {
    const sections = parseCronResultSurfaceSections(SAMPLE_MESSAGE);
    expect(sections?.title).toBe("市场分析");
    expect(sections?.summaryMarkdown).toContain("✅ 成功");
    expect(sections?.summaryMarkdown).toContain("共 12 个 Skill");
    expect(sections?.deliverableMarkdown).toContain("| notion | Notion |");
    expect(sections?.footerMarkdown).toContain("任务 ID：`abc-123`");
  });

  it("parses occurrence cards labeled 定时执行结果", () => {
    const text = [
      "**定时执行结果** · 市场分析",
      "",
      "## 任务摘要",
      "",
      "**状态**：✅ 成功",
      "",
      "## 任务成果",
      "",
      "完成",
      "",
      "---",
      "",
      "定时任务 ID：`abc-123`",
    ].join("\n");
    expect(parseCronResultSurfaceSections(text)?.title).toBe("市场分析");
    expect(
      readCronResultMessageMeta({ role: "assistant", content: [{ type: "text", text }] }),
    ).toEqual({
      jobId: "abc-123",
      jobName: "市场分析",
    });
  });
});

describe("resolveCronResultArtifactRecord", () => {
  it("builds artifact from deliverable section only", () => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: SAMPLE_MESSAGE }],
      openclawCronResult: { jobId: "abc-123", jobName: "市场分析" },
    };
    const artifact = resolveCronResultArtifactRecord(message);
    expect(artifact?.artifactId).toMatch(/^cron-result:abc-123:/);
    expect(artifact?.title).toBe("市场分析 · 本次执行成果");
    expect(String(artifact?.sourceMessage)).toContain("| notion | Notion |");
    expect(String(artifact?.sourceMessage)).not.toContain("## 任务摘要");
  });
});

describe("resolveImplicitCronReplyContext", () => {
  it("is display-only and must not be wired into chat.send (EA-B1)", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: SAMPLE_MESSAGE }] }];
    expect(resolveImplicitCronReplyContext(messages)?.jobId).toBe("abc-123");
  });

  it("returns latest cron result when no user message follows", () => {
    const messages = [{ role: "assistant", content: [{ type: "text", text: SAMPLE_MESSAGE }] }];
    expect(resolveImplicitCronReplyContext(messages)?.jobId).toBe("abc-123");
  });

  it("returns null after user has replied", () => {
    const messages = [
      {
        role: "assistant",
        content: [{ type: "text", text: SAMPLE_MESSAGE }],
        openclawCronResult: { jobId: "abc-123" },
      },
      { role: "user", content: [{ type: "text", text: "请补充" }] },
    ];
    expect(resolveImplicitCronReplyContext(messages)).toBeNull();
  });
});

describe("readCronResultMessageMeta", () => {
  it("reads embedded openclawCronResult metadata", () => {
    expect(
      readCronResultMessageMeta({
        role: "assistant",
        content: [{ type: "text", text: "ignored" }],
        openclawCronResult: {
          jobId: "job-1",
          runId: "run-1",
          jobName: "市场分析",
        },
      }),
    ).toEqual({
      jobId: "job-1",
      runId: "run-1",
      jobName: "市场分析",
    });
  });

  it("parses job id from injected markdown body", () => {
    expect(
      readCronResultMessageMeta({
        role: "assistant",
        content: [
          {
            type: "text",
            text: [
              "**定时任务结果** · 市场分析",
              "",
              "**摘要**",
              "完成",
              "",
              "任务 ID：`abc-123`",
            ].join("\n"),
          },
        ],
      }),
    ).toEqual({
      jobId: "abc-123",
      jobName: "市场分析",
    });
  });

  it("detects parked-wake notices and skips artifact projection", () => {
    const message = {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "**定时任务结果** · 竞品价格\n\n[CRON_PARKED_NOTICE]\n\n定时任务已完成。\n\n任务 ID：`job-1`",
        },
      ],
      openclawCronResult: { jobId: "job-1", jobName: "竞品价格", kind: "parked_notice" },
    };
    expect(isCronParkedNoticeMessage(message)).toBe(true);
    expect(readCronResultMessageMeta(message)).toMatchObject({
      jobId: "job-1",
      kind: "parked_notice",
      parkReason: "park",
    });
    expect(resolveCronResultArtifactRecord(message)).toBeNull();
  });
});
