import { describe, expect, it } from "vitest";
import { isWeakNewWorkCueOnly } from "./qualification.js";
import {
  classifyTurnRelation,
  isBareContinueCue,
  isOwnerConstraintFullReplace,
  isOwnerConstraintRevision,
  shouldPersistOwnerConstraint,
  isLanguageAsideMessage,
  isPriorUtteranceCorrection,
  shouldTaskParkAbortInFlight,
} from "./turn-relation.js";

const CURRENT = "生成今日竞品价格检查结果，并验收至少一个竞品价格";

describe("turn relation", () => {
  it("classifies language, correction, and continuation as non-cutting", () => {
    expect(classifyTurnRelation("请用中文回复", CURRENT)).toBe("aside");
    expect(classifyTurnRelation("不对，我说的是国内", CURRENT)).toBe("amend");
    expect(classifyTurnRelation("补充一节", CURRENT)).toBe("amend");
    expect(classifyTurnRelation("把标题改成市场稿", CURRENT)).toBe("amend");
    for (const phrase of ["请用中文回复", "不对，我说的是国内", "补充一节", "把标题改成市场稿"]) {
      expect(shouldTaskParkAbortInFlight(false)).toBe(false);
      expect(classifyTurnRelation(phrase, CURRENT)).not.toBe("new_work");
    }
    expect(shouldTaskParkAbortInFlight(false, true)).toBe(true);
    expect(shouldTaskParkAbortInFlight(true, false)).toBe(true);
  });

  it("classifies explicit new work that does not overlap the current goal", () => {
    expect(classifyTurnRelation("现在改做供应商合同审查", CURRENT)).toBe("new_work");
    expect(classifyTurnRelation("新任务：整理本周董事会会议纪要", CURRENT)).toBe("new_work");
    expect(
      classifyTurnRelation(
        "请使用 web-research 做一次标准深度联网调研。调研问题：2026 年开源智能体平台的产品形态。",
        CURRENT,
      ),
    ).toBe("new_work");
  });

  it("does not treat 输出 / 阅读 / 请先 / 调研 alone as new work", () => {
    expect(isWeakNewWorkCueOnly("请输出中文版")).toBe(true);
    expect(isWeakNewWorkCueOnly("请先阅读一下")).toBe(true);
    expect(isWeakNewWorkCueOnly("调研")).toBe(true);
    expect(isWeakNewWorkCueOnly("请先把口径改一下")).toBe(true);
    expect(classifyTurnRelation("请输出中文版", CURRENT)).toBe("aside");
    expect(classifyTurnRelation("请先阅读一下", CURRENT)).toBe("aside");
    expect(classifyTurnRelation("调研", CURRENT)).toBe("aside");
    expect(classifyTurnRelation("请先把口径改一下", CURRENT)).toBe("amend");
    expect(isWeakNewWorkCueOnly("请使用 web-research 做一次调研")).toBe(false);
  });

  it("shares the prior-utterance correction judgment and keeps 另外 / 新任务 out", () => {
    expect(isLanguageAsideMessage("请用中文回复")).toBe(true);
    expect(isLanguageAsideMessage("请输出中文")).toBe(true);
    expect(isPriorUtteranceCorrection("不对，我说的是国内")).toBe(true);
    expect(isPriorUtteranceCorrection("我并没有将任务派发给大白管家，大白管家也不在这个群里")).toBe(
      true,
    );
    expect(isPriorUtteranceCorrection("请分析一下AI办公软件的定价策略")).toBe(false);
    expect(isPriorUtteranceCorrection("那我们开始新任务：做竞品分析")).toBe(false);
    expect(isPriorUtteranceCorrection("另外帮我做一份竞品表")).toBe(false);
    expect(isPriorUtteranceCorrection(`不对，${"很长的补充说明".repeat(20)}`)).toBe(false);
    expect(classifyTurnRelation("那我们开始新任务：做竞品分析", CURRENT)).toBe("new_work");
    expect(classifyTurnRelation("另外帮我做一份竞品表", CURRENT)).toBe("new_work");
  });

  it("binds distinct new work even when the message contains 继续 (board-latest)", () => {
    const snake = "你帮我制作一个贪吃蛇的小游戏";
    expect(classifyTurnRelation("请继续", snake)).toBe("amend");
    expect(classifyTurnRelation("请继续写审查记录、完成绑定", snake)).toBe("new_work");
    expect(classifyTurnRelation("请继续写《调律》小说第七章，六时启闸", snake)).toBe("new_work");
    expect(classifyTurnRelation("新任务：创作调律长篇小说并验收第一章", snake)).toBe("new_work");
  });

  it("keeps same-goal appendix / next chapter / charts as amend (v2 wording)", () => {
    const novel = "创作《调律》长篇小说并验收各章交付";
    expect(classifyTurnRelation("请继续", novel)).toBe("amend");
    expect(classifyTurnRelation("写下一章", novel)).toBe("amend");
    expect(classifyTurnRelation("请继续写下一章", novel)).toBe("amend");
    expect(classifyTurnRelation("补充附录", novel)).toBe("amend");
    expect(classifyTurnRelation("加上图表", novel)).toBe("amend");
    expect(classifyTurnRelation("补图表说明", novel)).toBe("amend");
    // Explicit pause-and-do-B / sure distinct goal still inserts
    expect(classifyTurnRelation("现在改做供应商合同审查", novel)).toBe("new_work");
    expect(classifyTurnRelation("请继续写审查记录、完成绑定", "你帮我制作一个贪吃蛇的小游戏")).toBe(
      "new_work",
    );
  });
});

describe("slice3 constraint persist gates", () => {
  it("bare continue is amend but not persistable", () => {
    expect(classifyTurnRelation("请继续", CURRENT)).toBe("amend");
    expect(isBareContinueCue("请继续")).toBe(true);
    expect(isBareContinueCue("继续")).toBe(true);
    expect(shouldPersistOwnerConstraint("请继续")).toBe(false);
    expect(shouldPersistOwnerConstraint("继续")).toBe(false);
  });

  it("queries are not persistable", () => {
    expect(shouldPersistOwnerConstraint("当前任务目标是什么")).toBe(false);
    expect(shouldPersistOwnerConstraint("有效约束有哪些")).toBe(false);
  });

  it("revision openers are detected without deleting by keyword alone", () => {
    expect(isOwnerConstraintRevision("不对，改为只要 iOS 机型")).toBe(true);
    expect(isOwnerConstraintRevision("补充：只要国内安卓机型")).toBe(false);
    expect(shouldPersistOwnerConstraint("不对，改为只要 iOS 机型")).toBe(true);
    expect(shouldPersistOwnerConstraint("补充：只要国内安卓机型")).toBe(true);
  });

  it("full replace is distinct from local revision", () => {
    expect(isOwnerConstraintFullReplace("改为覆盖亚洲市场")).toBe(false);
    expect(isOwnerConstraintFullReplace("不对，改为只要 iOS 机型")).toBe(false);
    expect(isOwnerConstraintFullReplace("以本条为准：只要 iOS 机型，不要安卓")).toBe(true);
    expect(isOwnerConstraintFullReplace("整体替换为：只用公开资料")).toBe(true);
    expect(isOwnerConstraintRevision("以本条为准：只要 iOS 机型")).toBe(true);
  });

  it("classifyTurnRelation accepts context without scanning constraint history", () => {
    const poisoned = "继续|暂停|取消|新任务";
    expect(classifyTurnRelation("请用中文回复", CURRENT, { activeConstraints: [poisoned] })).toBe(
      "aside",
    );
  });
});
