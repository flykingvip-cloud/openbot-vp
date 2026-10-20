import { describe, expect, it } from "vitest";
import type { CronJob } from "../../../types.ts";
import {
  formatPersonalCronScheduleLabel,
  formatPersonalCronExecutionLabel,
  isCronDeliveryOnlyFailure,
  resolvePersonalCronDisplayStatus,
  resolvePersonalCronExecutionTarget,
  resolvePersonalCronResultChatTargets,
  resolvePersonalCronDeliverySurfaces,
  placeAnchoredMenuPanel,
  PERSONAL_CRON_STALE_RUNNING_MS,
} from "./personal-cron-center.helpers.ts";
import { DEFAULT_PERSONAL_CRON_TASK_META } from "./personal-cron-task-meta.ts";

function job(partial: Partial<CronJob> & Pick<CronJob, "id" | "name">): CronJob {
  return {
    enabled: true,
    createdAtMs: Date.now(),
    updatedAtMs: Date.now(),
    schedule: { kind: "every", everyMs: 86_400_000 },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "生成日报" },
    ...partial,
  } as CronJob;
}

describe("personal-cron-center.helpers", () => {
  it("maps running and paused states", () => {
    expect(
      resolvePersonalCronDisplayStatus(
        job({ id: "a", name: "A", state: { runningAtMs: Date.now() } }),
      ),
    ).toBe("running");
    expect(resolvePersonalCronDisplayStatus(job({ id: "b", name: "B", enabled: false }))).toBe(
      "paused",
    );
  });

  it("maps stale running marker to interrupted", () => {
    const staleAt = Date.now() - PERSONAL_CRON_STALE_RUNNING_MS - 1;
    expect(
      resolvePersonalCronDisplayStatus(
        job({ id: "stale", name: "Stale", state: { runningAtMs: staleAt } }),
      ),
    ).toBe("interrupted");
  });

  it("resolves chat targets from delivery surfaces", () => {
    const entry = job({
      id: "g1",
      name: "G1",
      agentId: "market-bot",
      delivery: { mode: "none", surfaces: ["workbench-agent-main", "workbench-collab-group"] },
      sessionKey: "space:market",
    });
    expect(resolvePersonalCronDeliverySurfaces(entry)).toEqual([
      "workbench-agent-main",
      "workbench-collab-group",
    ]);
    expect(
      resolvePersonalCronResultChatTargets({
        job: entry,
        agents: [{ id: "market-bot", label: "市场助手" }],
        groups: [{ sessionKey: "space:market", label: "市场组" }],
      }),
    ).toEqual([
      {
        sessionKey: "agent:market-bot:main",
        label: "市场助手",
        surface: "workbench-agent-main",
      },
      {
        sessionKey: "space:market",
        label: "市场组",
        surface: "workbench-collab-group",
      },
    ]);
  });

  it("formats common cron schedules in Chinese", () => {
    expect(
      formatPersonalCronScheduleLabel(
        job({
          id: "c",
          name: "C",
          schedule: { kind: "cron", expr: "0 9 * * *", tz: "" },
        }),
      ),
    ).toBe("每天 09:00");
  });

  it("resolves agent execution target", () => {
    expect(
      resolvePersonalCronExecutionTarget(job({ id: "d", name: "D", agentId: "sales-bot" })),
    ).toEqual({ kind: "agent", label: "sales-bot" });
  });

  it("maps execution ids to friendly labels", () => {
    const entry = job({
      id: "e",
      name: "E",
      agentId: "agent-ops",
      sessionKey: "",
    });
    expect(
      formatPersonalCronExecutionLabel({
        job: entry,
        meta: {
          ...DEFAULT_PERSONAL_CRON_TASK_META,
          selectedAgents: ["agent-ops"],
          executionMode: "single",
        },
        agents: [{ id: "agent-ops", label: "运营机器人" }],
      }),
    ).toBe("运营机器人");
    expect(
      formatPersonalCronExecutionLabel({
        job: job({ id: "f", name: "F", sessionKey: "space:g1" }),
        meta: {
          ...DEFAULT_PERSONAL_CRON_TASK_META,
          selectedGroups: ["space:g1"],
        },
        groups: [{ sessionKey: "space:g1", label: "市场组" }],
      }),
    ).toBe("市场组");
  });

  it("flips an overflow menu above the trigger when there is no room below", () => {
    expect(
      placeAnchoredMenuPanel({
        trigger: { top: 520, right: 900, bottom: 552 },
        panel: { width: 168, height: 280 },
        viewport: { width: 960, height: 600 },
      }),
    ).toEqual({ top: 234, left: 732 });
    expect(
      placeAnchoredMenuPanel({
        trigger: { top: 80, right: 900, bottom: 112 },
        panel: { width: 168, height: 160 },
        viewport: { width: 960, height: 600 },
      }),
    ).toEqual({ top: 118, left: 732 });
    expect(
      placeAnchoredMenuPanel({
        trigger: { top: 80, right: 40, bottom: 112 },
        panel: { width: 168, height: 160 },
        viewport: { width: 960, height: 600 },
      }),
    ).toEqual({ top: 118, left: 8 });
  });

  it("treats message-failed as delivery-only when a summary exists", () => {
    expect(
      isCronDeliveryOnlyFailure({
        status: "error",
        error: "⚠️ ✉️ Message failed",
        summary: "A".repeat(50),
      }),
    ).toBe(true);
  });
});
