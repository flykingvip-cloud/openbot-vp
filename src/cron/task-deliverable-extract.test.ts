import { describe, expect, it } from "vitest";
import {
  NO_DELIVERABLE_PLACEHOLDER,
  splitTaskOutcomeFromAgentOutput,
  buildTaskOutcomeHeadline,
  buildCronDeliverablePromptSection,
} from "./task-deliverable-extract.js";

describe("splitTaskOutcomeFromAgentOutput", () => {
  it("does not treat process-only summary as a deliverable", () => {
    const split = splitTaskOutcomeFromAgentOutput(
      "我先检查了凭证，再调用接口创建草稿，media_id=abc123，请查收。",
    );
    expect(split.hasDeliverable).toBe(false);
    expect(split.deliverableMarkdown).toBe(NO_DELIVERABLE_PLACEHOLDER);
    expect(split.processText).toContain("media_id");
  });

  it("extracts tagged deliverable and strips it from process", () => {
    const raw = [
      "正在上传封面并创建草稿…",
      "",
      '<<DELIVERABLE title="小米AGI狂飙" type="article" url="https://mp.weixin.qq.com/s/abc">>',
      "# 小米AGI狂飙",
      "",
      "正文第一段。",
      "<</DELIVERABLE>>",
      "",
      "草稿已创建，可在后台预览。",
    ].join("\n");
    const split = splitTaskOutcomeFromAgentOutput(raw);
    expect(split.hasDeliverable).toBe(true);
    expect(split.deliverables).toHaveLength(1);
    expect(split.deliverables[0]?.title).toBe("小米AGI狂飙");
    expect(split.deliverables[0]?.url).toContain("mp.weixin.qq.com");
    expect(split.deliverableMarkdown).toContain("正文第一段");
    expect(split.deliverableMarkdown).toContain("<<DELIVERABLE");
    expect(split.processText).toContain("正在上传封面");
    expect(split.processText).not.toContain("正文第一段");
  });
});

describe("buildTaskOutcomeHeadline", () => {
  it("prefers deliverable title", () => {
    expect(
      buildTaskOutcomeHeadline({
        processText: "很长的过程……",
        hasDeliverable: true,
        deliverables: [{ kind: "tag", title: "终稿", body: "x".repeat(50) }],
      }),
    ).toContain("终稿");
  });
});

describe("buildCronDeliverablePromptSection", () => {
  it("requires DELIVERABLE envelope for task outputs", () => {
    const section = buildCronDeliverablePromptSection();
    expect(section).toContain("<<DELIVERABLE");
    expect(section).toContain("任务成果声明");
    expect(section).toContain("file=");
    expect(section).toContain("url=");
  });
});
