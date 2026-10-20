import { describe, expect, it } from "vitest";
import {
  hasPersonalCronExternalNotify,
  normalizeCronDeliverySurfaces,
  reconcileWorkbenchOnlyCronDelivery,
  resolveCronDeliverySurfaces,
} from "./delivery-surfaces.js";
import type { CronJob } from "./types.js";

function makeJob(overrides: Partial<CronJob> = {}): CronJob {
  return {
    id: "job-1",
    name: "测试任务",
    enabled: true,
    createdAtMs: 1,
    updatedAtMs: 1,
    state: {},
    schedule: { kind: "cron", expr: "0 9 * * *" },
    sessionTarget: "isolated",
    wakeMode: "now",
    payload: { kind: "agentTurn", message: "hello" },
    agentId: "bot-2",
    ...overrides,
  };
}

describe("normalizeCronDeliverySurfaces", () => {
  it("dedupes valid surfaces", () => {
    expect(
      normalizeCronDeliverySurfaces([
        "workbench-agent-main",
        "workbench-agent-main",
        "workbench-collab-group",
      ]),
    ).toEqual(["workbench-agent-main", "workbench-collab-group"]);
  });

  it("ignores unknown values", () => {
    expect(normalizeCronDeliverySurfaces(["invalid", "workbench-agent-main"])).toEqual([
      "workbench-agent-main",
    ]);
  });
});

describe("resolveCronDeliverySurfaces", () => {
  it("prefers explicit delivery.surfaces", () => {
    expect(
      resolveCronDeliverySurfaces(
        makeJob({
          delivery: {
            mode: "none",
            surfaces: ["workbench-collab-group"],
          },
        }),
      ),
    ).toEqual(["workbench-collab-group"]);
  });

  it("infers agent main from embedded meta notify.inApp", () => {
    const description = `分析任务\n<!--openbot-task-meta:${encodeURIComponent(
      JSON.stringify({ notify: { inApp: true }, selectedAgents: ["bot-2"] }),
    )}-->`;
    expect(resolveCronDeliverySurfaces(makeJob({ description }))).toEqual(["workbench-agent-main"]);
  });

  it("defaults isolated agent jobs to agent main", () => {
    expect(resolveCronDeliverySurfaces(makeJob())).toEqual(["workbench-agent-main"]);
  });
});

describe("hasPersonalCronExternalNotify", () => {
  it("returns false when only inApp is enabled", () => {
    const description = `任务\n<!--openbot-task-meta:${encodeURIComponent(
      JSON.stringify({ notify: { inApp: true, wecom: false } }),
    )}-->`;
    expect(hasPersonalCronExternalNotify(makeJob({ description }))).toBe(false);
  });

  it("returns true when wecom notify is enabled", () => {
    const description = `任务\n<!--openbot-task-meta:${encodeURIComponent(
      JSON.stringify({ notify: { inApp: true, wecom: true } }),
    )}-->`;
    expect(hasPersonalCronExternalNotify(makeJob({ description }))).toBe(true);
  });
});

describe("reconcileWorkbenchOnlyCronDelivery", () => {
  it("downgrades legacy announce+last to mode none with surfaces", () => {
    const description = `任务\n<!--openbot-task-meta:${encodeURIComponent(
      JSON.stringify({ notify: { inApp: true, wecom: false } }),
    )}-->`;
    const job = makeJob({
      description,
      delivery: { mode: "announce", channel: "last", bestEffort: false },
    });
    expect(reconcileWorkbenchOnlyCronDelivery(job)).toBe(true);
    expect(job.delivery).toEqual({
      mode: "none",
      channel: undefined,
      bestEffort: false,
      surfaces: ["workbench-agent-main"],
    });
  });

  it("preserves explicit external delivery targets", () => {
    const job = makeJob({
      delivery: {
        mode: "announce",
        channel: "telegram",
        to: "https://t.me/obviyus",
      },
    });
    expect(reconcileWorkbenchOnlyCronDelivery(job)).toBe(false);
    expect(job.delivery).toEqual({
      mode: "announce",
      channel: "telegram",
      to: "https://t.me/obviyus",
    });
  });
});
