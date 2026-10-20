import { describe, expect, it } from "vitest";
import {
  buildPersonalCronDeliveryFields,
  categoryLabel,
  parsePersonalCronTaskMeta,
  serializePersonalCronTaskMeta,
  type PersonalCronTaskMeta,
} from "./personal-cron-task-meta.ts";

const sampleMeta: PersonalCronTaskMeta = {
  category: "ops",
  priority: "high",
  intentText: "汇总昨日运营数据",
  goal: "生成运营日报",
  acceptanceRules: ["必须生成 PDF", "字数 > 1000"],
  executionMode: "single",
  selectedAgents: ["运营机器人"],
  selectedGroups: [],
  dataBindings: [],
  notify: {
    inApp: true,
    wecom: true,
    email: false,
    dingtalk: false,
    webhook: false,
    failImmediate: true,
  },
  schedulePreset: "daily",
  dailyTime: "09:00",
  weeklyDay: "1",
  monthlyDay: "1",
  creatorLabel: "张三",
};

describe("personal-cron-task-meta", () => {
  it("round-trips meta embedded in description", () => {
    const serialized = serializePersonalCronTaskMeta("生成昨日运营日报", sampleMeta);
    const parsed = parsePersonalCronTaskMeta(serialized);
    expect(parsed.visibleDescription).toBe("生成昨日运营日报");
    expect(parsed.meta.goal).toBe("生成运营日报");
    expect(parsed.meta.acceptanceRules).toEqual(["必须生成 PDF", "字数 > 1000"]);
    expect(categoryLabel(parsed.meta.category)).toBe("运营");
  });

  it("maps inApp notify to workbench surfaces without external announce", () => {
    const fields = buildPersonalCronDeliveryFields({
      ...sampleMeta,
      notify: { ...sampleMeta.notify, inApp: true, wecom: false },
    });
    expect(fields.deliveryMode).toBe("none");
    expect(fields.deliverySurfaces).toEqual(["workbench-agent-main"]);
  });

  it("maps wecom notify to announce plus workbench surfaces", () => {
    const fields = buildPersonalCronDeliveryFields(sampleMeta);
    expect(fields.deliveryMode).toBe("announce");
    expect(fields.deliveryChannel).toBe("wecom");
    expect(fields.deliverySurfaces).toEqual(["workbench-agent-main"]);
  });
});
