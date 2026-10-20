import { describe, expect, it } from "vitest";
import { extractDeliverableEnvelope } from "./deliverable-envelope.ts";

describe("shared deliverable-envelope quoted coverage gate", () => {
  const body =
    "本周复盘：企业版需要新增 SSO 单点登录与自动对账能力，预计可提升老客户续费率约 12%，建议下个迭代优先落地。";

  it("does not treat an incidental 「」 quote inside a long article as an envelope", () => {
    const article = [
      "# 做模型还是做产品？一个创始人的生死选择题",
      "AI 行业正在走向寡头化，模型逐渐基础设施化，同质化加剧。".repeat(20),
      "有人问我：「你和 OpenAI / Anthropic 有什么本质区别？」这是个好问题。",
      "产品才是流量入口，没有产品，模型只是裸 API，只能打价格战。".repeat(20),
    ].join("\n\n");
    expect(extractDeliverableEnvelope(article)).toBeNull();
  });

  it("honors a 「」 quote that dominates the message", () => {
    const text = `帮你记一下：\n「${body}」`;
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("quoted");
    expect(envelope?.body).toBe(body);
  });

  it("keeps honoring tagged <<DELIVERABLE>> envelopes regardless of coverage", () => {
    const wrapper = "闲聊铺垫内容，与成果无关。".repeat(50);
    const text = `${wrapper}\n<<DELIVERABLE title="结论">>\n${body}\n<</DELIVERABLE>>\n${wrapper}`;
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("tag");
    expect(envelope?.title).toBe("结论");
    expect(envelope?.body).toBe(body);
  });

  it("parses a declared workspace file from a single-line multi-attribute tag", () => {
    const text = `已生成好了。\n<<DELIVERABLE title="Alice简历" type="doc" file="Alice_爱丽_瑜伽老师简历.docx">>\n${body}\n<</DELIVERABLE>>`;
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("tag");
    expect(envelope?.title).toBe("Alice简历");
    expect(envelope?.type).toBe("doc");
    expect(envelope?.file).toBe("Alice_爱丽_瑜伽老师简历.docx");
    expect(envelope?.body).toBe(body);
  });

  it("rejects a declared file that traverses outside the workspace", () => {
    const text = `<<DELIVERABLE title="报告" file="../../etc/passwd">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(text)?.file).toBeUndefined();
  });

  it("parses a declared published url and ignores non-http values", () => {
    const httpText = `<<DELIVERABLE title="公众号文章" type="article" url="https://mp.weixin.qq.com/s/abc">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(httpText)?.url).toBe("https://mp.weixin.qq.com/s/abc");
    const badText = `<<DELIVERABLE title="x" url="javascript:alert(1)">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(badText)?.url).toBeUndefined();
  });

  it("parses unwritten=1 so a missing file is not treated as synced", () => {
    const text = `<<DELIVERABLE title="底稿" file="analysis/model.md" unwritten="1">>\n${body}\n<</DELIVERABLE>>`;
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.file).toBe("analysis/model.md");
    expect(envelope?.unwritten).toBe(true);
  });

  it("parses logicalId for stable collaboration deliverable identity", () => {
    const text = `<<DELIVERABLE title="市场周报" logicalId="weekly-market-brief">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(text)?.logicalId).toBe("weekly-market-brief");
  });

  it("parses settle=confirmed vs retryable vs conflict (PR C + P1 checksum)", () => {
    const confirmed = `<<DELIVERABLE title="底稿" file="analysis/model.md" settle="confirmed">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(confirmed)?.settle).toBe("confirmed");
    const retryable = `<<DELIVERABLE title="底稿" file="analysis/model.md" settle="retryable">>\n${body}\n<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(retryable)?.settle).toBe("retryable");
    const conflict = `<<DELIVERABLE title="底稿" file="analysis/model.md" settle="conflict">>
${body}
<</DELIVERABLE>>`;
    expect(extractDeliverableEnvelope(conflict)?.settle).toBe("conflict");
  });
});
