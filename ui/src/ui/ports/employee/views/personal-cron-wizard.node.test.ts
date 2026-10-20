import { describe, expect, it } from "vitest";
import { DEFAULT_CRON_FORM } from "../../../app-defaults.ts";
import {
  createWizardStateFromForm,
  resolveWizardStepBlockers,
  resolveWizardTaskName,
  syncWizardToForm,
} from "./personal-cron-wizard.ts";

describe("resolveWizardTaskName", () => {
  it("prefers wizard.taskName when parent form.name is stale empty", () => {
    const wizard = createWizardStateFromForm({ ...DEFAULT_CRON_FORM, name: "" });
    wizard.taskName = "每日销售日报";
    expect(resolveWizardTaskName(wizard, { ...DEFAULT_CRON_FORM, name: "" })).toBe("每日销售日报");
  });

  it("falls back to form.name when wizard.taskName is empty", () => {
    const wizard = createWizardStateFromForm({ ...DEFAULT_CRON_FORM, name: "周报" });
    expect(resolveWizardTaskName(wizard, { ...DEFAULT_CRON_FORM, name: "周报" })).toBe("周报");
  });
});

describe("syncWizardToForm", () => {
  it("writes wizard task name into form patch even when form.name is empty", () => {
    const wizard = createWizardStateFromForm({ ...DEFAULT_CRON_FORM, name: "" });
    wizard.taskName = "竞品巡检";
    wizard.userIntent = "每天抓取竞品价格并输出对比表";
    wizard.meta = {
      ...wizard.meta,
      selectedAgents: ["agent-1"],
      schedulePreset: "daily",
      dailyTime: "09:00",
    };
    const patch = syncWizardToForm(wizard, { ...DEFAULT_CRON_FORM, name: "" });
    expect(patch.name).toBe("竞品巡检");
  });
});

describe("resolveWizardStepBlockers", () => {
  it("blocks step 1 when task name is empty", () => {
    const wizard = createWizardStateFromForm({ ...DEFAULT_CRON_FORM, name: "" });
    wizard.step = 1;
    const blockers = resolveWizardStepBlockers(1, { ...DEFAULT_CRON_FORM, name: "" }, wizard);
    expect(blockers.some((item) => item.message.includes("任务名称"))).toBe(true);
  });

  it("passes step 1 when wizard.taskName is set but form.name is stale empty", () => {
    const wizard = createWizardStateFromForm({ ...DEFAULT_CRON_FORM, name: "" });
    wizard.taskName = "日报任务";
    wizard.step = 1;
    const blockers = resolveWizardStepBlockers(1, { ...DEFAULT_CRON_FORM, name: "" }, wizard);
    expect(blockers.some((item) => item.message.includes("任务名称"))).toBe(false);
  });

  it("blocks step 2 when once schedule is missing", () => {
    const wizard = createWizardStateFromForm(DEFAULT_CRON_FORM);
    wizard.step = 2;
    wizard.meta = { ...wizard.meta, schedulePreset: "once" };
    const blockers = resolveWizardStepBlockers(
      2,
      { ...DEFAULT_CRON_FORM, scheduleKind: "at", scheduleAt: "" },
      wizard,
    );
    expect(blockers.some((item) => item.message.includes("执行时间"))).toBe(true);
  });

  it("blocks step 3 when intent is empty", () => {
    const wizard = createWizardStateFromForm(DEFAULT_CRON_FORM);
    wizard.step = 3;
    wizard.userIntent = "";
    const blockers = resolveWizardStepBlockers(3, DEFAULT_CRON_FORM, wizard);
    expect(blockers.some((item) => item.message.includes("任务意图"))).toBe(true);
  });
});
