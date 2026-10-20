import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { foldEvents } from "./fold.js";
import { projectProgress } from "./project.js";
import { completeStep, ev, seedPlan, toolEvidence } from "./test-helpers.js";
import type { ExecutionEvent, TurnContractSnapshot } from "./types.js";

const deliver: TurnContractSnapshot = { mode: "deliver" };

describe("projectProgress", () => {
  it("does not import a writer or store (I6)", () => {
    const source = readFileSync(fileURLToPath(new URL("./project.ts", import.meta.url)), "utf8");
    expect(source).not.toMatch(/writer|store/);
  });

  it("does not mutate the ledger (I6)", () => {
    const ledger = foldEvents([...seedPlan(), ...completeStep("E1", "A1", 10_000)]);
    const before = JSON.stringify(ledger);
    projectProgress(ledger, deliver, 11_000);
    expect(JSON.stringify(ledger)).toBe(before);
  });

  it("exposes acceptance and execution progress separately", () => {
    const ledger = foldEvents([...seedPlan(), ...completeStep("E1", "A1", 10_000)]);
    const view = projectProgress(ledger, deliver, 11_000);
    expect(view.acceptanceProgress).toEqual({ met: 1, total: 4 });
    expect(view.executionProgress.completed).toBe(1);
    expect(view.executionProgress.total).toBe(4);
    expect(view.headline).toContain("1/4 项验收已满足");
    expect(view.headline).not.toMatch(/^1\/4 ·/);
  });

  it("emits nothing to chat or notifications while quiet (I7 still folds)", () => {
    const events: ExecutionEvent[] = [...seedPlan(), ...completeStep("E1", "A1", 10_000)];
    const ledger = foldEvents(events);
    const view = projectProgress(ledger, { mode: "quiet" }, 11_000);
    expect(view.emitToChat).toBe(false);
    expect(view.emitNotification).toBe(false);
    expect(view.acceptanceProgress.met).toBe(1);
  });

  it("marks stale from lastMeaningfulChangeAt, not heartbeat noise", () => {
    const ledger = foldEvents([...seedPlan(), ev("STEP_STARTED", { stepId: "E1", atMs: 1_000 })]);
    ledger.lastUpdatedAtMs = 1_000 + 80 * 60 * 60 * 1000;
    const view = projectProgress(ledger, deliver, 1_000 + 80 * 60 * 60 * 1000);
    expect(view.stale).toBe(true);
    expect(view.lastMeaningfulChangeAtMs).toBe(1_000);
  });

  it("adds collapsedSummary when more than 7 active steps", () => {
    const many = ev("PLAN_SEEDED", {
      atMs: 1,
      payload: {
        goal: "long plan",
        acceptance: [{ id: "A1", text: "done" }],
        steps: Array.from({ length: 9 }, (_, index) => ({
          id: `S${index + 1}`,
          title: `Step ${index + 1}`,
        })),
      },
    });
    const view = projectProgress(foldEvents([many]), deliver, 2);
    expect(view.nodes).toHaveLength(9);
    expect(view.collapsedSummary).toEqual({ done: 0, current: 0, remaining: 9 });
  });

  it("projects Progress + Mode + BlockingGate together", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E3", atMs: 20_000 }),
      ev("STEP_BLOCKED", {
        stepId: "E3",
        atMs: 20_100,
        payload: { reason: "blocked_user", question: "价差按含税价还是活动价？" },
      }),
    ]);
    const view = projectProgress(
      ledger,
      {
        mode: "ask",
        blockingGate: ledger.currentBlocking,
      },
      20_200,
    );
    expect(view.mode).toBe("ask");
    expect(view.blockingGate).toMatchObject({
      type: "user_confirmation",
      reason: "blocked_user",
      question: "价差按含税价还是活动价？",
    });
    expect(view.headline).toContain("等你确认");
    expect(view.focus).toBe("价差按含税价还是活动价？");
    expect(view.nodes.find((node) => node.id === "E3")?.tone).toBe("blocked");
  });

  it("never implies a stronger state than a blocked ledger (I8)", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
      ev("STEP_BLOCKED", {
        stepId: "E1",
        atMs: 10_200,
        payload: { reason: "blocked_system", question: "CRM 超时" },
      }),
    ]);
    const view = projectProgress(ledger, { mode: "deliver" }, 10_300);
    expect(view.headline).not.toMatch(/即将完成|马上完成/);
    expect(view.taskCompleted).toBe(false);
    expect(view.nodes.find((node) => node.id === "E1")?.tone).toBe("blocked");
    expect(view.headline).toContain("已中断");
  });

  it("exposes replan history without dropping retired steps from the ledger", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ...completeStep("E1", "A1", 10_000),
      ev("REPLAN_APPENDED", {
        atMs: Date.parse("2026-08-22T01:32:00.000Z"),
        planVersion: 1,
        payload: {
          fromVersion: 1,
          toVersion: 2,
          replanReason: "missing_data",
          retiredStepIds: ["E4"],
          addedSteps: [{ id: "E4b", title: "补齐本周价表" }],
        },
      }),
    ]);
    const before = JSON.stringify(ledger);
    const view = projectProgress(ledger, deliver, Date.parse("2026-08-22T01:33:00.000Z"));
    expect(JSON.stringify(ledger)).toBe(before);
    expect(view.planVersion).toBe(2);
    expect(view.replans).toEqual([
      {
        atMs: Date.parse("2026-08-22T01:32:00.000Z"),
        fromVersion: 1,
        toVersion: 2,
        reason: "missing_data",
        triggeredBy: "runtime",
      },
    ]);
    expect(view.nodes.map((node) => node.id)).not.toContain("E4");
    expect(view.nodes.map((node) => node.id)).toContain("E4b");
    expect(ledger.steps.find((item) => item.id === "E4")?.retired).toBe(true);
  });

  it("does not treat executed as done", () => {
    const ledger = foldEvents([
      ...seedPlan(),
      ev("STEP_STARTED", { stepId: "E1", atMs: 10_000 }),
      ev("TOOL_SUCCEEDED", {
        stepId: "E1",
        atMs: 10_100,
        payload: { evidence: toolEvidence(10_100) },
      }),
    ]);
    const view = projectProgress(ledger, deliver, 10_200);
    expect(view.nodes.find((node) => node.id === "E1")?.tone).toBe("current");
    expect(view.executionProgress.completed).toBe(0);
  });
});
