import { describe, expect, it } from "vitest";
import {
  extractDeliverableEnvelope,
  extractLocatedDeliverableEnvelopes,
  extractQuotedDeliverableEnvelopes,
  parseDeliverableAttributes,
  resolveDeliverableBody,
  stripDeliverableEnvelopeTags,
} from "./deliverable-envelope.ts";

describe("deliverable-envelope", () => {
  const body = [
    "## 中医诊断学习简报",
    "",
    "### 💡 学习建议",
    "",
    "1. 先掌握望诊中的神色与形态观察要点。",
    "2. 熟记问诊十问的顺序与临床意义。",
    "3. 结合脉诊与闻诊形成完整四诊链条。".repeat(2),
  ].join("\n");

  it("extracts tagged deliverable bodies with optional title", () => {
    const text = [
      "好的，简报整理好了：",
      "",
      '<<DELIVERABLE title="中医诊断学习简报">>',
      body,
      "<</DELIVERABLE>>",
      "",
      "如果需要我可以继续展开某一部分。",
    ].join("\n");
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("tag");
    expect(envelope?.title).toBe("中医诊断学习简报");
    expect(envelope?.body).toBe(body);
    expect(text).toContain("如果需要我可以继续展开");
    expect(envelope?.body).not.toContain("如果需要我可以继续展开");
  });

  it("extracts quoted deliverable bodies", () => {
    const text = ["整理如下：", "", "「", body, "」", "", "够详细吗？"].join("\n");
    const envelopes = extractQuotedDeliverableEnvelopes(text);
    expect(envelopes).toHaveLength(1);
    expect(envelopes[0]?.body).toBe(body);
    expect(extractDeliverableEnvelope(text)?.kind).toBe("quoted");
  });

  it("prefers tagged envelopes over quoted ones", () => {
    const text = [
      "「这是旧格式不应采用」",
      '<<DELIVERABLE title="正式成果">>',
      body,
      "<</DELIVERABLE>>",
    ].join("\n");
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("tag");
    expect(envelope?.title).toBe("正式成果");
    expect(envelope?.body).toBe(body);
  });

  it("resolveDeliverableBody returns envelope contents only", () => {
    const text = ["完成啦！", "<<DELIVERABLE>>", body, "<</DELIVERABLE>>", "还需要补充吗？"].join(
      "\n",
    );
    expect(resolveDeliverableBody(text)).toBe(body);
  });

  it("ignores envelopes that are too short", () => {
    expect(extractDeliverableEnvelope("<<DELIVERABLE>>短<</DELIVERABLE>>")).toBeNull();
    expect(extractDeliverableEnvelope("「太短」")).toBeNull();
  });

  it("does not treat an incidental 「」 quote inside a long article as an envelope", () => {
    const article = [
      "# 做模型还是做产品？一个创始人的生死选择题",
      "",
      "AI 行业正在走向寡头化，模型逐渐基础设施化，同质化加剧。".repeat(20),
      "",
      "有人问我：「你和 OpenAI / Anthropic 有什么本质区别？」这是个好问题。",
      "",
      "产品才是流量入口，没有产品，模型只是裸 API，只能打价格战。".repeat(20),
    ].join("\n");
    // The quote covers a tiny fraction of the article, so it must NOT hijack the
    // deliverable body (regression: preview collapsing the article to one sentence).
    expect(extractDeliverableEnvelope(article)).toBeNull();
  });

  it("still honors a 「」 quote that dominates the message", () => {
    const quoted = "记得明天九点前把季度复盘、下季度目标和预算表整理好发到群里，谢谢大家配合。";
    const text = `帮你记一下：\n「${quoted}」`;
    const envelope = extractDeliverableEnvelope(text);
    expect(envelope?.kind).toBe("quoted");
    expect(envelope?.body).toBe(quoted);
  });

  it("parses declared file/url attributes from a single-line multi-attribute tag", () => {
    const fileText = [
      '<<DELIVERABLE title="Alice简历" type="doc" file="Alice_爱丽_瑜伽老师简历.docx">>',
      body,
      "<</DELIVERABLE>>",
    ].join("\n");
    const fileEnvelope = extractDeliverableEnvelope(fileText);
    expect(fileEnvelope?.type).toBe("doc");
    expect(fileEnvelope?.file).toBe("Alice_爱丽_瑜伽老师简历.docx");
    expect(fileEnvelope?.body).toBe(body);

    const urlText = [
      '<<DELIVERABLE title="公众号文章" type="article" url="https://mp.weixin.qq.com/s/abc">>',
      body,
      "<</DELIVERABLE>>",
    ].join("\n");
    expect(extractDeliverableEnvelope(urlText)?.url).toBe("https://mp.weixin.qq.com/s/abc");
  });

  it("lists every tagged envelope that declares a file or url", () => {
    const text = [
      '<<DELIVERABLE title="PDF" file="deck.pdf">>摘要<</DELIVERABLE>>',
      '<<DELIVERABLE title="网页" file="deck.html">>摘要<</DELIVERABLE>>',
      '<<DELIVERABLE title="无位置">>这段没有 file 也没有 url，不应进入多成果列表。<</DELIVERABLE>>',
    ].join("\n");
    const located = extractLocatedDeliverableEnvelopes(text);
    expect(located.map((entry) => entry.file)).toEqual(["deck.pdf", "deck.html"]);
  });

  it("parseDeliverableAttributes strips path traversal and rejects non-http urls", () => {
    expect(parseDeliverableAttributes('file="../../secret.docx"').file).toBeUndefined();
    expect(parseDeliverableAttributes('url="javascript:alert(1)"').url).toBeUndefined();
  });

  it("strips raw DELIVERABLE tags for chat display", () => {
    const sample = [
      "完成啦！",
      '<<DELIVERABLE title="简报" file="deliverables/brief.html">>',
      "正文",
      "<</DELIVERABLE>>",
    ].join("\n");
    const stripped = stripDeliverableEnvelopeTags(sample);
    expect(stripped).not.toMatch(/<<\s*DELIVERABLE/i);
    expect(stripped).toContain("完成啦！");
    expect(stripped).toContain("正文");
  });

});
