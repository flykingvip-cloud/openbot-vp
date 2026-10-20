import { describe, expect, test } from "vitest";
import {
  charNgramSet,
  classifyUsefulPosts,
  isNoReplyText,
  cosineSimilarity,
  exceedsSimilarityCeiling,
  jaccardSimilarity,
  QUALITY_CLASSIFIER_VERSION,
} from "./quality-classifier.js";

const LONG_A = "预算应分两期压缩并在下周复盘结论";
const LONG_B = "数据库迁移窗口定在周五并写好回滚步骤";

describe("useful-v1", () => {
  test("version is useful-v1", () => {
    expect(QUALITY_CLASSIFIER_VERSION).toBe("useful-v1");
  });

  test("similarity ceilings are strict", () => {
    expect(exceedsSimilarityCeiling({ jaccard: 0.55, cosine: null })).toBe(true);
    expect(exceedsSimilarityCeiling({ jaccard: 0.549, cosine: null })).toBe(false);
    expect(exceedsSimilarityCeiling({ jaccard: 0.1, cosine: 0.9 })).toBe(true);
    expect(exceedsSimilarityCeiling({ jaccard: 0.1, cosine: 0.899 })).toBe(false);
    expect(exceedsSimilarityCeiling({ jaccard: 0.1, cosine: null })).toBe(false);
  });

  test("rule 1 rejects NO_REPLY, placeholder, and duplicate suppression", () => {
    const verdicts = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "a", text: "NO_REPLY", atMs: 1 },
        { agentId: "b", text: "收到", atMs: 2 },
        { agentId: "c", text: LONG_A, atMs: 3, duplicateSuppressed: true },
      ],
    });
    expect(verdicts.every((item) => !item.useful)).toBe(true);
    expect(
      verdicts.every((item) => item.failedRules.includes("no_reply_or_placeholder_or_duplicate")),
    ).toBe(true);
  });

  test("skill-alias clarification stops do not poison a later retry as near_duplicate", () => {
    const stop = "这一步有两个做法，请指定用哪一个。";
    const retry = "预算应分两期压缩并在下周复盘结论";
    const verdicts = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "a", text: stop, atMs: 1 },
        { agentId: "b", text: retry, atMs: 2 },
      ],
    });
    expect(verdicts.find((item) => item.agentId === "b")?.failedRules ?? []).not.toContain(
      "near_duplicate",
    );
  });

  test("rule 2 uses Jaccard, and cosine only when both embeddings exist", () => {
    expect(jaccardSimilarity(charNgramSet(LONG_A), charNgramSet(LONG_B))).toBeLessThan(0.55);
    const duplicated = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "a", text: LONG_A, atMs: 1 },
        { agentId: "b", text: LONG_A, atMs: 2 },
      ],
    });
    expect(duplicated[0]?.useful).toBe(true);
    expect(duplicated[1]?.useful).toBe(false);
    expect(duplicated[1]?.failedRules).toContain("near_duplicate");

    const embedding = [1, 0, 0];
    const cosineOnly = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "a", text: LONG_A, atMs: 1, embedding },
        { agentId: "b", text: LONG_B, atMs: 2, embedding },
      ],
    });
    expect(cosineSimilarity(embedding, embedding)).toBe(1);
    expect(cosineOnly[1]?.useful).toBe(false);
    expect(cosineOnly[1]?.failedRules).toContain("near_duplicate");

    const jaccardOnly = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "a", text: LONG_A, atMs: 1 },
        { agentId: "b", text: LONG_B, atMs: 2, embedding },
      ],
    });
    expect(jaccardOnly[1]?.useful).toBe(true);
  });

  test("rule 3 rejects pure courtesy under 8 effective chars unless it is a roll-call template", () => {
    const courtesy = classifyUsefulPosts({
      needSource: "none",
      posts: [
        { agentId: "short", text: "abcdefg", atMs: 1 },
        { agentId: "enough", text: "预算复盘结论已经写好", atMs: 2 },
        { agentId: "hello", text: "你好谢谢", atMs: 3 },
      ],
    });
    expect(courtesy.find((item) => item.agentId === "short")?.failedRules).toContain(
      "pure_courtesy",
    );
    expect(courtesy.find((item) => item.agentId === "enough")?.useful).toBe(true);
    expect(courtesy.find((item) => item.agentId === "hello")?.failedRules).toContain(
      "pure_courtesy",
    );
  });

  test("rule 4 is need-scene specific", () => {
    const rollCall = classifyUsefulPosts({
      needSource: "roll_call",
      posts: [
        { agentId: "template-only", text: "到", atMs: 1 },
        { agentId: "intro", text: "我是阿宁", atMs: 2 },
      ],
    });
    expect(rollCall.find((item) => item.agentId === "template-only")?.failedRules).toContain(
      "need_intent",
    );
    expect(rollCall.find((item) => item.agentId === "intro")?.useful).toBe(true);

    const task = classifyUsefulPosts({
      needSource: "task",
      posts: [
        { agentId: "bare", text: "已经做完了请看一下这个结果说明", atMs: 1 },
        { agentId: "cited", text: "已完成 task-42 的接口调整并附上结论", atMs: 2 },
      ],
    });
    expect(task.find((item) => item.agentId === "bare")?.failedRules).toContain("need_intent");
    expect(task.find((item) => item.agentId === "cited")?.useful).toBe(true);

    const mention = classifyUsefulPosts({
      needSource: "mention",
      triggerText: "预算超了怎么办",
      posts: [
        { agentId: "off", text: "今天天气不错适合出门散步聊天", atMs: 1 },
        { agentId: "on", text: "预算可以分两期压缩并下周复盘", atMs: 2 },
      ],
    });
    expect(mention.find((item) => item.agentId === "off")?.failedRules).toContain("need_intent");
    expect(mention.find((item) => item.agentId === "on")?.useful).toBe(true);

    const unlabeled = classifyUsefulPosts({
      needSource: "none",
      triggerText: "预算超了怎么办",
      posts: [{ agentId: "off", text: "今天天气不错适合出门散步聊天", atMs: 1 }],
    });
    expect(unlabeled[0]?.useful).toBe(true);
  });
});

describe("isNoReplyText Chinese silence aliases", () => {
  test("matches exact Chinese silence paraphrases", () => {
    expect(isNoReplyText("无需回复")).toBe(true);
    expect(isNoReplyText("  不用回复  ")).toBe(true);
    expect(isNoReplyText("无增量")).toBe(true);
    expect(isNoReplyText("暂无增量")).toBe(true);
  });

  test("does not match sentences that merely contain those words", () => {
    expect(isNoReplyText("无需回复以外我还有增量")).toBe(false);
    expect(isNoReplyText("本轮无增量可补充，但结论如下：继续")).toBe(false);
  });

  test("still matches canonical NO_REPLY", () => {
    expect(isNoReplyText("NO_REPLY")).toBe(true);
    expect(isNoReplyText("no_reply")).toBe(true);
  });
});
