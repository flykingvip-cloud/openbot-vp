// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  clearInteractiveChoiceSelectionState,
  getSelectedChoiceKey,
  renderChatDeliveryView,
} from "./chat-delivery-view.ts";
import {
  buildInteractiveChoiceSubmitMessage,
  formatChoiceComposerText,
  interactiveChoicePanelId,
  isCollaborationSupplementMessage,
  parseChatDelivery,
  resolveChatDelivery,
  shouldUseChatDeliveryComponent,
} from "./chat-delivery.ts";

/** A. 大白 1:1 wechat export — full 4 fields */
const DABAI_WECHAT = [
  "本机微信客户端数据在容器目录里，不能直接当知识库。",
  "",
  "建议先导出到 ~/OpenBot/wechat-exports/，导出后把文件夹路径发给我。",
  "",
  "下一步",
  "把聊天记录导出到建议目录",
  "",
  "你选",
  "A · 按步骤导出（我带你）",
  "B · 我已有导出目录",
  "C · 只看客户端数据在哪",
].join("\n");

/** B. Lead full envelope with choices */
const LEAD_QUANBIAN = [
  "先做本地 sidecar 验收，再谈 LIVE 切流。",
  "",
  "Gateway 18789 已通；3000 仍缺协议引擎。",
  "",
  "下一步",
  "补上用户自备的 protocol 引擎并 curl 出真码",
  "",
  "你选",
  "A · 继续本机验收清单",
  "B · 先写协议引擎接入说明",
].join("\n");

/** C. Supplement ≤3 lines, no choices */
const SUPPLEMENT =
  "补充：curl 验收顺序是 TRANSPORT_UNCONFIGURED → PROTOCOL_ENGINE_UNCONFIGURED → 真 qrCodeUrl。";

describe("parseChatDelivery", () => {
  it("A: parses 大白 1:1 wechat-export full 4 fields", () => {
    const delivery = parseChatDelivery(DABAI_WECHAT);
    expect(delivery).not.toBeNull();
    expect(delivery?.conclusion).toBe("本机微信客户端数据在容器目录里，不能直接当知识库。");
    expect(delivery?.detail).toContain("~/OpenBot/wechat-exports/");
    expect(delivery?.next).toBe("把聊天记录导出到建议目录");
    expect(delivery?.choices).toEqual([
      { key: "A", label: "按步骤导出（我带你）" },
      { key: "B", label: "我已有导出目录" },
      { key: "C", label: "只看客户端数据在哪" },
    ]);
    expect(shouldUseChatDeliveryComponent(DABAI_WECHAT)).toBe(true);
  });

  it("B: parses Lead full envelope with choices", () => {
    const delivery = parseChatDelivery(LEAD_QUANBIAN);
    expect(delivery?.conclusion).toBe("先做本地 sidecar 验收，再谈 LIVE 切流。");
    expect(delivery?.detail).toContain("Gateway 18789");
    expect(delivery?.next).toContain("protocol 引擎");
    expect(delivery?.choices?.map((c) => c.key)).toEqual(["A", "B"]);
    expect(shouldUseChatDeliveryComponent(LEAD_QUANBIAN)).toBe(true);
  });

  it("C: Supplement ≤3 lines no choices → parse without choices / gate OK", () => {
    const delivery = parseChatDelivery(SUPPLEMENT);
    expect(delivery?.conclusion).toBe(SUPPLEMENT);
    expect(delivery?.detail).toBeUndefined();
    expect(delivery?.next).toBeUndefined();
    expect(delivery?.choices).toBeUndefined();
    expect(shouldUseChatDeliveryComponent(SUPPLEMENT, { isSupplement: true })).toBe(true);
    // Without supplement flag, short-ish single line still fails chitchat if >8 chars —
    // but must not invent choices.
    expect(delivery?.choices).toBeUndefined();
  });

  it("D: streaming keeps the same skeleton once structure exists", () => {
    expect(shouldUseChatDeliveryComponent(DABAI_WECHAT, { streaming: true })).toBe(true);
    expect(shouldUseChatDeliveryComponent(DABAI_WECHAT, { isStreaming: true })).toBe(true);
    expect(resolveChatDelivery({}, DABAI_WECHAT, { streaming: true })?.conclusion).toContain(
      "本机微信",
    );
    expect(shouldUseChatDeliveryComponent("你好", { streaming: true })).toBe(false);
  });

  it("uses delivery chrome for two-paragraph replies without markers", () => {
    const text = [
      "先把本机微信导出目录接上，再谈入库。",
      "",
      "客户端数据目录不能直接当知识库，导出后把路径发给我即可。",
    ].join("\n");
    expect(shouldUseChatDeliveryComponent(text)).toBe(true);
    expect(parseChatDelivery(text)?.detail).toContain("不能直接当知识库");
  });

  it("uses delivery chrome for a longer conclusion-only draft", () => {
    const text = "本机微信客户端数据在容器目录里，不能直接当知识库。";
    expect(shouldUseChatDeliveryComponent(text)).toBe(true);
    expect(parseChatDelivery(text)?.conclusion).toBe(text);
  });

  it("E: 「你好」 short chitchat → shouldUse false", () => {
    expect(parseChatDelivery("你好")?.conclusion).toBe("你好");
    expect(shouldUseChatDeliveryComponent("你好")).toBe(false);
    expect(shouldUseChatDeliveryComponent("好的！")).toBe(false);
    expect(shouldUseChatDeliveryComponent("收到")).toBe(false);
    expect(resolveChatDelivery({ role: "assistant" }, "你好")).toBeNull();
  });

  it("strips 【结论】 bracket labels from fields", () => {
    const text = [
      "【结论】本机数据不能直接入库。",
      "",
      "【现状】容器目录只读。",
      "",
      "【下一步】先导出",
      "",
      "【选项】",
      "A · 导出",
      "B · 换路径",
    ].join("\n");
    const delivery = parseChatDelivery(text);
    expect(delivery?.conclusion).toBe("本机数据不能直接入库。");
    expect(delivery?.detail).toContain("容器目录只读");
    expect(delivery?.next).toBe("先导出");
    expect(delivery?.choices?.[0]?.label).toBe("导出");
    expect(JSON.stringify(delivery)).not.toContain("【");
  });

  it("accepts A. / A、 choice markers", () => {
    const text = ["结论一行。", "", "你选", "A. 方案甲", "B、方案乙"].join("\n");
    const delivery = parseChatDelivery(text);
    expect(delivery?.choices).toEqual([
      { key: "A", label: "方案甲" },
      { key: "B", label: "方案乙" },
    ]);
  });

  it("detects collaboration supplement via contributionRole / flags", () => {
    expect(isCollaborationSupplementMessage({ contributionRole: "supplement" })).toBe(true);
    expect(isCollaborationSupplementMessage({ collaborationRole: "supplement" })).toBe(true);
    expect(isCollaborationSupplementMessage({ isSupplement: true })).toBe(true);
    expect(isCollaborationSupplementMessage({ contributionRole: "lead" })).toBe(false);
  });

  it("keeps deliverable body after the second paragraph", () => {
    const text = [
      "当前可调用 skill 共 12 项。",
      "",
      "清单不等于已安装；能不能调由工具注册表决定。",
      "",
      "要指定深度请用 @。",
      "",
      "| skill | 说明 |",
      "| --- | --- |",
      "| wechat-personal-kb | 个人微信知识库 |",
      "| reply-surface-protocol | 对外回复信道 |",
    ].join("\n");
    const delivery = parseChatDelivery(text);
    expect(delivery?.conclusion).toBe("当前可调用 skill 共 12 项。");
    expect(delivery?.detail).toContain("清单不等于已安装");
    expect(delivery?.detail).toContain("要指定深度请用 @");
    expect(delivery?.detail).toContain("wechat-personal-kb");
    expect(shouldUseChatDeliveryComponent(text)).toBe(true);
  });

  it("resolveChatDelivery wires supplement gate for conclusion-only", () => {
    const message = { role: "assistant", contributionRole: "supplement" };
    const delivery = resolveChatDelivery(message, SUPPLEMENT);
    expect(delivery?.conclusion).toBe(SUPPLEMENT);
    expect(delivery?.choices).toBeUndefined();
  });
});

describe("interactive choice submit mapping", () => {
  it("formats choice composer text as key · label", () => {
    expect(formatChoiceComposerText({ key: "A", label: "按步骤导出（我带你）" })).toBe(
      "A · 按步骤导出（我带你）",
    );
    expect(formatChoiceComposerText({ key: "", label: "仅标签" })).toBe("仅标签");
  });

  it("builds a readable submit message from selected choice labels", () => {
    const text = buildInteractiveChoiceSubmitMessage({
      taskGoal: "导出本机微信聊天记录",
      questions: [
        {
          name: "你选",
          choice: { key: "A", label: "按步骤导出（我带你）" },
        },
      ],
    });
    expect(text).toContain("请基于以下选择继续完成任务：");
    expect(text).toContain("任务目标：导出本机微信聊天记录");
    expect(text).toContain("你选：A · 按步骤导出（我带你）");
    expect(text).toContain("不要重复询问已回答的问题");
    expect(text).not.toMatch(/option_a|选项序号/);
  });

  it("skips unanswered optional questions and supports multi-question scaffold", () => {
    const text = buildInteractiveChoiceSubmitMessage({
      questions: [
        { name: "合作模式", choice: { key: "A", label: "OEM 贴牌" } },
        { name: "计费方式" },
        { name: "维护服务", choice: { key: "B", label: "按年订阅" } },
      ],
      followUpInstruction: "请生成商业方案草案。",
    });
    expect(text).toContain("合作模式：A · OEM 贴牌");
    expect(text).toContain("维护服务：B · 按年订阅");
    expect(text).not.toContain("计费方式");
    expect(text).toContain("请生成商业方案草案。");
  });

  it("panel id is stable for the same choices", () => {
    const choices = [
      { key: "A", label: "甲" },
      { key: "B", label: "乙" },
    ];
    expect(interactiveChoicePanelId(choices)).toBe(interactiveChoicePanelId(choices));
    expect(interactiveChoicePanelId(choices)).not.toBe(
      interactiveChoicePanelId([{ key: "A", label: "丙" }]),
    );
  });
});

describe("interactive choice confirm wiring", () => {
  it("confirm invokes onSubmitChoice with mapped submit text after select", () => {
    clearInteractiveChoiceSelectionState();
    const choices = [
      { key: "A", label: "继续本机验收清单" },
      { key: "B", label: "先写协议引擎接入说明" },
    ];
    const submitted: string[] = [];
    const filled: string[] = [];

    // First render: select A via click handler stored on the template.
    const first = renderChatDeliveryView(
      {
        conclusion: "先做本地 sidecar 验收，再谈 LIVE 切流。",
        choices,
      },
      {
        onFillComposer: (text) => filled.push(text),
        onSubmitChoice: (text) => submitted.push(text),
      },
    );
    // Walk nested template values to find the click handler for choice A.
    function findChoiceClick(tpl: unknown, key: string): (() => void) | null {
      if (!tpl || typeof tpl !== "object") {
        return null;
      }
      if (Array.isArray(tpl)) {
        for (const item of tpl) {
          const found = findChoiceClick(item, key);
          if (found) {
            return found;
          }
        }
        return null;
      }
      const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
      if (!t.strings || !t.values) {
        return null;
      }
      const joined = t.strings.join("");
      if (joined.includes("data-choice-key=") && t.values.includes(key)) {
        for (const v of t.values) {
          if (typeof v === "function") {
            return v as () => void;
          }
        }
      }
      for (const v of t.values) {
        const found = findChoiceClick(v, key);
        if (found) {
          return found;
        }
      }
      return null;
    }

    function findConfirmClick(tpl: unknown): (() => void) | null {
      if (!tpl || typeof tpl !== "object") {
        return null;
      }
      if (Array.isArray(tpl)) {
        for (const item of tpl) {
          const found = findConfirmClick(item);
          if (found) {
            return found;
          }
        }
        return null;
      }
      const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
      if (!t.strings || !t.values) {
        return null;
      }
      const joined = t.strings.join("");
      if (joined.includes("chat-delivery-confirm") || joined.includes("确认并继续")) {
        for (const v of t.values) {
          if (typeof v === "function") {
            return v as () => void;
          }
        }
      }
      for (const v of t.values) {
        const found = findConfirmClick(v);
        if (found) {
          return found;
        }
      }
      return null;
    }

    const clickA = findChoiceClick(first, "A");
    expect(clickA).toBeTypeOf("function");
    clickA!();
    expect(filled).toEqual(["A · 继续本机验收清单"]);
    expect(getSelectedChoiceKey(choices)).toBe("A");

    // Re-render after selection so confirm is enabled and wired.
    const second = renderChatDeliveryView(
      {
        conclusion: "先做本地 sidecar 验收，再谈 LIVE 切流。",
        choices,
      },
      {
        onFillComposer: (text) => filled.push(text),
        onSubmitChoice: (text) => submitted.push(text),
      },
    );
    const confirm = findConfirmClick(second);
    expect(confirm).toBeTypeOf("function");
    confirm!();
    expect(submitted).toHaveLength(1);
    expect(submitted[0]).toContain("你选：A · 继续本机验收清单");
    expect(submitted[0]).toContain("请基于以下选择继续完成任务：");
    // Residue clear: selection Map and composer draft must not linger after confirm.
    expect(getSelectedChoiceKey(choices)).toBeNull();
    expect(filled.at(-1)).toBe("");
  });

  it("confirm clears selection highlight state even without onFillComposer", () => {
    clearInteractiveChoiceSelectionState();
    const choices = [
      { key: "A", label: "方案甲" },
      { key: "B", label: "方案乙" },
    ];
    const submitted: string[] = [];
    const first = renderChatDeliveryView(
      { conclusion: "请选择", choices },
      { onSubmitChoice: (text) => submitted.push(text) },
    );
    function findChoiceClick(tpl: unknown, key: string): (() => void) | null {
      if (!tpl || typeof tpl !== "object") {
        return null;
      }
      if (Array.isArray(tpl)) {
        for (const item of tpl) {
          const found = findChoiceClick(item, key);
          if (found) {
            return found;
          }
        }
        return null;
      }
      const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
      if (!t.strings || !t.values) {
        return null;
      }
      const joined = t.strings.join("");
      if (joined.includes("data-choice-key=") && t.values.includes(key)) {
        for (const v of t.values) {
          if (typeof v === "function") {
            return v as () => void;
          }
        }
      }
      for (const v of t.values) {
        const found = findChoiceClick(v, key);
        if (found) {
          return found;
        }
      }
      return null;
    }
    function findConfirmClick(tpl: unknown): (() => void) | null {
      if (!tpl || typeof tpl !== "object") {
        return null;
      }
      if (Array.isArray(tpl)) {
        for (const item of tpl) {
          const found = findConfirmClick(item);
          if (found) {
            return found;
          }
        }
        return null;
      }
      const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
      if (!t.strings || !t.values) {
        return null;
      }
      const joined = t.strings.join("");
      if (joined.includes("chat-delivery-confirm") || joined.includes("确认并继续")) {
        for (const v of t.values) {
          if (typeof v === "function") {
            return v as () => void;
          }
        }
      }
      for (const v of t.values) {
        const found = findConfirmClick(v);
        if (found) {
          return found;
        }
      }
      return null;
    }
    findChoiceClick(first, "A")!();
    expect(getSelectedChoiceKey(choices)).toBe("A");
    const second = renderChatDeliveryView(
      { conclusion: "请选择", choices },
      { onSubmitChoice: (text) => submitted.push(text) },
    );
    findConfirmClick(second)!();
    expect(submitted).toHaveLength(1);
    expect(getSelectedChoiceKey(choices)).toBeNull();
  });

  it("omits confirm button when onSubmitChoice is not wired", () => {
    clearInteractiveChoiceSelectionState();
    const tpl = renderChatDeliveryView(
      {
        conclusion: "结论",
        choices: [{ key: "A", label: "甲" }],
      },
      { onFillComposer: () => undefined },
    );
    function flatten(tpl: unknown): string {
      if (Array.isArray(tpl)) {
        return tpl.map(flatten).join("");
      }
      const t = tpl as { strings?: TemplateStringsArray; values?: unknown[] };
      if (!t.strings) {
        return typeof tpl === "string" || typeof tpl === "number" || typeof tpl === "boolean"
          ? String(tpl)
          : "";
      }
      let out = "";
      for (let i = 0; i < t.strings.length; i += 1) {
        out += t.strings[i] ?? "";
        if (i < (t.values?.length ?? 0)) {
          out += flatten(t.values?.[i]);
        }
      }
      return out;
    }
    expect(flatten(tpl)).not.toContain("确认并继续");
  });
});
