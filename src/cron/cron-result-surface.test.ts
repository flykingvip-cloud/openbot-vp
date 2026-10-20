import { describe, expect, it } from "vitest";
import { isCronResultSurfaceMessage, omitCronResultSurfaces } from "./cron-result-surface.js";

const CRON_CARD = [
  "[定时任务 · Progress Ledger 前端测试]",
  "",
  "**定时任务结果** · Progress Ledger 前端测试",
  "",
  "## 任务摘要",
  "生成今日竞品价格检查结果",
  "",
  "## 任务成果",
  "blocked",
  "",
  "任务 ID：`2b9de6b0-f2b8-4531-aa73-69fb5fa87246`",
].join("\n");

describe("cron result surface (P1 acceptance)", () => {
  it("EA-I2: detects embedded cron result metadata", () => {
    expect(
      isCronResultSurfaceMessage({
        role: "assistant",
        content: [{ type: "text", text: "ignore" }],
        openclawCronResult: { jobId: "job-1" },
      }),
    ).toBe(true);
  });

  it("EA-I2: detects injected markdown cards", () => {
    expect(
      isCronResultSurfaceMessage({
        role: "assistant",
        content: [{ type: "text", text: CRON_CARD }],
      }),
    ).toBe(true);
  });

  it("EA-I2: detects occurrence cards labeled 定时执行结果", () => {
    expect(
      isCronResultSurfaceMessage({
        role: "assistant",
        content: [
          {
            type: "text",
            text: "**定时执行结果** · 竞品价格\n\n定时任务 ID：`job-1`",
          },
        ],
      }),
    ).toBe(true);
  });

  it("does not drop ordinary assistant replies", () => {
    expect(
      isCronResultSurfaceMessage({
        role: "assistant",
        content: [{ type: "text", text: "调研完成，report.md 已写入。" }],
      }),
    ).toBe(false);
  });

  it("omits cron cards from agent history while keeping user turns", () => {
    const kept = omitCronResultSurfaces([
      { role: "user", content: [{ type: "text", text: "请做网页调研" }] },
      {
        role: "assistant",
        content: [{ type: "text", text: CRON_CARD }],
        openclawCronResult: { jobId: "job-1" },
      },
      { role: "assistant", content: [{ type: "text", text: "先拆子问题。" }] },
    ]);
    expect(kept).toHaveLength(2);
    expect(kept[0]).toMatchObject({ role: "user" });
    expect(kept[1]).toMatchObject({ role: "assistant" });
  });

  it("omits parked-wake notices from agent history", () => {
    const kept = omitCronResultSurfaces([
      { role: "user", content: [{ type: "text", text: "请做网页调研" }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "**定时任务结果** · 竞品价格\n\n[CRON_PARKED_NOTICE]\n\n定时任务已完成。\n\n任务 ID：`job-1`",
          },
        ],
        openclawCronResult: { jobId: "job-1", kind: "parked_notice" },
      },
    ]);
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ role: "user" });
  });
});
