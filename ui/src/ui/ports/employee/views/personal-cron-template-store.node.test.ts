import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_PERSONAL_CRON_TASK_META } from "./personal-cron-task-meta.ts";
import {
  buildTemplateFromWizard,
  deletePersonalCronTemplate,
  loadPersonalCronTemplates,
  savePersonalCronTemplate,
} from "./personal-cron-template-store.ts";

describe("personal-cron-template-store", () => {
  beforeEach(() => {
    const storage = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    });
  });

  it("saves and loads personal templates", () => {
    const template = buildTemplateFromWizard({
      form: { name: "我的日报" } as never,
      meta: { ...DEFAULT_PERSONAL_CRON_TASK_META, goal: "目标", acceptanceRules: ["规则1"] },
      userIntent: "做日报",
      visibleDescription: "摘要",
    });
    savePersonalCronTemplate(template);
    const loaded = loadPersonalCronTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]?.name).toBe("我的日报");
    expect(loaded[0]?.intentText).toBe("做日报");
  });

  it("deletes personal template by id", () => {
    const template = buildTemplateFromWizard({
      form: { name: "待删模板" } as never,
      meta: DEFAULT_PERSONAL_CRON_TASK_META,
      userIntent: "测试",
      visibleDescription: "",
    });
    savePersonalCronTemplate(template);
    deletePersonalCronTemplate(template.id);
    expect(loadPersonalCronTemplates()).toHaveLength(0);
  });

  it("dedupes personal templates with same name and intent", () => {
    const first = buildTemplateFromWizard({
      form: { name: "未命名任务" } as never,
      meta: DEFAULT_PERSONAL_CRON_TASK_META,
      userIntent: "相同意图",
      visibleDescription: "",
    });
    const second = buildTemplateFromWizard({
      form: { name: "未命名任务" } as never,
      meta: DEFAULT_PERSONAL_CRON_TASK_META,
      userIntent: "相同意图",
      visibleDescription: "",
    });
    savePersonalCronTemplate(first);
    savePersonalCronTemplate(second);
    expect(loadPersonalCronTemplates()).toHaveLength(1);
  });
});
