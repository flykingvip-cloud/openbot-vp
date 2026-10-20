import { describe, expect, it } from "vitest";
import {
  CRON_TASK_FOCUS_FLAG_ENV,
  assessTaskOutputAlignment,
  buildCronTaskFocusPrompt,
  buildTaskFocusPromptSection,
  isCronTaskFocusEnabled,
  parseCompiledTaskPromptSections,
  resolveCronTaskFocus,
} from "./task-focus.js";

describe("task-focus alignment", () => {
  it("parses compiled cron payload sections", () => {
    const message = [
      "## 任务目标",
      "抓取 361 飞然 4.5 在京东与淘宝的价格并生成比价表",
      "## 执行指令",
      "打开京东和淘宝搜索 SKU，记录价格。",
      "## 验收标准",
      "1. 含京东价",
      "2. 含淘宝价",
    ].join("\n");
    const parsed = parseCompiledTaskPromptSections(message);
    expect(parsed.goal).toContain("361");
    expect(parsed.instruction).toContain("京东");
    expect(parsed.acceptanceRules).toEqual(["含京东价", "含淘宝价"]);
  });

  it("builds schedule-copy prompt for unbound cron (not ConversationTask identity)", () => {
    const section = buildTaskFocusPromptSection({
      goal: "竞品价格监控",
      acceptanceRules: ["含京东价", "含淘宝价"],
      anchorText: "竞品价格监控",
    });
    expect(section).toContain("本次定时执行说明");
    expect(section).toContain("不是对话任务身份");
    expect(section).not.toContain("当前任务契约");
  });

  it("keeps ConversationTask identity language when bound", () => {
    const section = buildTaskFocusPromptSection({
      goal: "竞品价格监控",
      acceptanceRules: ["含京东价", "含淘宝价"],
      anchorText: "竞品价格监控",
      source: "conversation_task",
    });
    expect(section).toContain("当前任务契约");
    expect(section).toContain("任务目标：竞品价格监控");
  });

  it("parses both legacy 任务目标 and 定时说明 headings", () => {
    const scheduled = parseCompiledTaskPromptSections(
      ["## 定时说明", "每日巡检价格", "## 执行指令", "打开京东"].join("\n"),
    );
    expect(scheduled.goal).toBe("每日巡检价格");
    expect(
      resolveCronTaskFocus({ message: scheduled.goal, meta: { goal: scheduled.goal } }).source,
    ).toBe("cron_schedule");
    expect(
      resolveCronTaskFocus({
        message: "每日巡检价格",
        meta: { goal: "每日巡检价格" },
        conversationTaskId: "ct-market-1",
        conversationTaskGoal: "监控 361 价格",
      }),
    ).toMatchObject({
      source: "conversation_task",
      goal: "监控 361 价格",
    });
  });

  it("flags TCM drift on 361 price-monitoring task (regression)", () => {
    const message = [
      "## 任务目标",
      "抓取 361 飞然 4.5 在京东与淘宝的价格并生成比价表",
      "## 执行指令",
      "请使用 browser 或 web_fetch 访问京东、淘宝，搜索「361 飞然 4.5」，记录当前售价。",
      "## 验收标准",
      "1. 输出含京东价格",
      "2. 输出含淘宝价格",
    ].join("\n");
    const focus = resolveCronTaskFocus({ message, meta: {} });
    const tcmSummary =
      "我检索了知识库中关于中医诊断学的笔记，没有找到完整的望闻问切章节摘要。" +
      "建议补充教材来源后再试。";
    const alignment = assessTaskOutputAlignment({
      anchorText: focus.anchorText,
      outputText: tcmSummary,
    });
    expect(alignment.aligned).toBe(false);
    expect(alignment.reason).toMatch(/task_goal_mismatch/);
  });

  it("passes aligned commerce summary", () => {
    const message = "监控 361 飞然 4.5 京东淘宝价格";
    const focus = resolveCronTaskFocus({ message, meta: {} });
    const summary = "已在京东找到 361 飞然 4.5 售价 299 元，淘宝同款 289 元，已生成比价表。";
    const alignment = assessTaskOutputAlignment({
      anchorText: focus.anchorText,
      outputText: summary,
    });
    expect(alignment.aligned).toBe(true);
  });

  it("does not flag short incomplete outputs", () => {
    const focus = resolveCronTaskFocus({
      message: "抓取京东淘宝 361 飞然 4.5 价格",
      meta: {},
    });
    const alignment = assessTaskOutputAlignment({
      anchorText: focus.anchorText,
      outputText: "正在打开京东…",
      minOutputLength: 40,
    });
    expect(alignment.aligned).toBe(true);
  });
});

const GOAL = "监控 361 京东淘宝价格";
const INTENT = "写巡检日报";
const ACCEPTANCE = "发出摘要";
const VISIBLE = "巡检";

function envOn(): NodeJS.ProcessEnv {
  return { [CRON_TASK_FOCUS_FLAG_ENV]: "1" };
}

describe("cron task-focus Phase 1b", () => {
  it("defaults OFF for unset, empty, 0, and false", () => {
    expect(isCronTaskFocusEnabled({})).toBe(false);
    expect(isCronTaskFocusEnabled({ [CRON_TASK_FOCUS_FLAG_ENV]: "" })).toBe(false);
    expect(isCronTaskFocusEnabled({ [CRON_TASK_FOCUS_FLAG_ENV]: "0" })).toBe(false);
    expect(isCronTaskFocusEnabled({ [CRON_TASK_FOCUS_FLAG_ENV]: "false" })).toBe(false);
  });

  it("turns on only for 1 or true", () => {
    expect(isCronTaskFocusEnabled({ [CRON_TASK_FOCUS_FLAG_ENV]: "1" })).toBe(true);
    expect(isCronTaskFocusEnabled({ [CRON_TASK_FOCUS_FLAG_ENV]: "true" })).toBe(true);
  });

  it("returns empty when the flag is OFF even if a goal exists", () => {
    expect(
      buildCronTaskFocusPrompt(
        { goal: GOAL, intentText: INTENT },
        { [CRON_TASK_FOCUS_FLAG_ENV]: "0" },
      ),
    ).toBe("");
  });

  it("ON includes goal, intent, and acceptance anchors", () => {
    const prompt = buildCronTaskFocusPrompt(
      {
        goal: GOAL,
        intentText: INTENT,
        acceptanceRules: [ACCEPTANCE, "已拉取竞品价格"],
        visibleDescription: VISIBLE,
      },
      envOn(),
    );
    expect(prompt).toContain("## 权威任务焦点");
    expect(prompt).toContain(`目标：${GOAL}`);
    expect(prompt).toContain(`意图：${INTENT}`);
    expect(prompt).toContain(`- ${ACCEPTANCE}`);
    expect(prompt).toContain("- 已拉取竞品价格");
    expect(prompt).toContain(`可见说明：${VISIBLE}`);
    expect(prompt).toContain("不得改做其他主题");
  });

  it("ON does not mention alignment, lease, or Ledger", () => {
    const prompt = buildCronTaskFocusPrompt(
      { goal: GOAL, intentText: INTENT, acceptanceRules: [ACCEPTANCE] },
      envOn(),
    );
    expect(prompt.toLowerCase()).not.toMatch(/align|alignment|lease|ledger|assessTaskOutput/i);
  });

  it("ON stays empty when the job has no contract fields", () => {
    expect(buildCronTaskFocusPrompt({}, envOn())).toBe("");
    expect(
      buildCronTaskFocusPrompt(
        { goal: "  ", intentText: "", acceptanceRules: ["", "  "], visibleDescription: " " },
        envOn(),
      ),
    ).toBe("");
  });

  it("does not turn on because the objective-shadow flag is set", () => {
    expect(
      buildCronTaskFocusPrompt({ goal: GOAL }, { OPENBOT_TASK_FOCUS_OBJECTIVE_SHADOW: "1" }),
    ).toBe("");
  });
});
