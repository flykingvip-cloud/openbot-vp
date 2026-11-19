import { expect, it } from "vitest";
import { parseLongHorizonCronMeta } from "../progress-ledger/cron-binding.js";
const job = {
  id: "test",
  name: "diagnosis-evolution:test",
  description: "diagnosis-evolution-purpose:learn_capability",
  payload: {
    message: "用空闲时间练习已安装但本窗未观察到使用的技能。只记录技能名与结果，不安装新技能。",
  },
};
it("recognizes a legacy skill prescription with its exact stored contract", () => {
  expect(parseLongHorizonCronMeta(job)?.acceptanceRules).toHaveLength(2);
});
it("does not enable tools for ordinary reminders or a marker alone", () => {
  expect(parseLongHorizonCronMeta({ ...job, payload: { message: "提醒我喝水" } })).toBeNull();
  expect(parseLongHorizonCronMeta({ ...job, description: "" })).toBeNull();
});
