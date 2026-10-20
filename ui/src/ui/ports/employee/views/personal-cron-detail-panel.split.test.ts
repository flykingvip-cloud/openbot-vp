import { describe, expect, it } from "vitest";
import { splitCronRunLogBody } from "./personal-cron-detail-panel.ts";

describe("splitCronRunLogBody", () => {
  it("keeps process-only output as process", () => {
    const split = splitCronRunLogBody("调用 API 成功 media_id=xyz");
    expect(split.hasDeliverable).toBe(false);
    expect(split.processText).toContain("media_id");
    expect(split.deliverableText).toBeNull();
  });

  it("splits envelope into process + deliverable", () => {
    const raw = [
      "正在上传封面…",
      '<<DELIVERABLE title="周报" type="article" url="https://mp.weixin.qq.com/s/x">>',
      "# 周报",
      "正文第一段。",
      "<</DELIVERABLE>>",
      "草稿已创建。",
    ].join("\n");
    const split = splitCronRunLogBody(raw);
    expect(split.hasDeliverable).toBe(true);
    expect(split.processText).toContain("正在上传封面");
    expect(split.processText).toContain("草稿已创建");
    expect(split.processText).not.toContain("正文第一段");
    expect(split.deliverableText).toContain("周报");
    expect(split.deliverableText).toContain("正文第一段");
    expect(split.deliverableText).toContain("mp.weixin.qq.com");
  });
});
