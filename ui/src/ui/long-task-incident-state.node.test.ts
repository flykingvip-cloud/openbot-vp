import { describe, expect, it } from "vitest";
import {
  formatLongTaskBoardProgressLine,
  summarizeLongTaskBoardProgress,
} from "./long-task-board-progress.ts";
import {
  formatLongTaskIncidentLabel,
  resolveLongTaskIncidentState,
} from "./long-task-incident-state.ts";

describe("resolveLongTaskIncidentState", () => {
  it("surfaces binding fail as auto-recovering with next-step continue", () => {
    const state = resolveLongTaskIncidentState({
      deliverableRejectCode: "execution_binding_required",
      gatewayConnected: true,
      gatewayConnectionPhase: "connected",
    });
    expect(state?.kind).toBe("binding_fail");
    expect(state?.autoRecovering).toBe(true);
    expect(state?.nextStep.toLowerCase()).toContain("board");
    expect(formatLongTaskIncidentLabel(state!)).toContain("binding_fail");
  });

  it("classifies gateway reconnect vs offline", () => {
    const reconnecting = resolveLongTaskIncidentState({
      gatewayConnected: false,
      gatewayConnectionPhase: "reconnecting",
    });
    expect(reconnecting?.kind).toBe("gateway_reconnect");
    expect(reconnecting?.autoRecovering).toBe(true);

    const offline = resolveLongTaskIncidentState({
      gatewayConnected: false,
      gatewayConnectionPhase: "unreachable",
    });
    expect(offline?.kind).toBe("gateway_offline");
  });

  it("prefers computer occupied / sandbox stuck when detectors already fired", () => {
    const occupied = resolveLongTaskIncidentState({
      computerOccupied: true,
      computerOccupiedDetail: "seat-ceo holds desktop",
      deliverableRejectCode: "execution_binding_required",
      gatewayConnected: false,
      gatewayConnectionPhase: "reconnecting",
    });
    expect(occupied?.kind).toBe("computer_occupied");
    expect(occupied?.autoRecovering).toBe(false);

    const stuck = resolveLongTaskIncidentState({
      sandboxStuck: true,
      computerOccupied: true,
    });
    expect(stuck?.kind).toBe("sandbox_stuck");
  });

  it("returns null when healthy", () => {
    expect(
      resolveLongTaskIncidentState({
        gatewayConnected: true,
        gatewayConnectionPhase: "connected",
      }),
    ).toBeNull();
  });
});

describe("summarizeLongTaskBoardProgress", () => {
  it("summarizes group board done / blocker / last persist", () => {
    const progress = summarizeLongTaskBoardProgress({
      groupBoardItems: [
        {
          itemId: "m1",
          title: "大纲",
          status: "accepted",
          acceptedAt: 100,
        },
        {
          itemId: "m2",
          title: "第一章",
          status: "in_progress",
          inProgressAt: 200,
        },
      ],
    });
    expect(progress.doneCount).toBe(1);
    expect(progress.doneTitles).toEqual(["大纲"]);
    expect(progress.activeCount).toBe(1);
    expect(progress.currentBlocker).toContain("第一章");
    expect(progress.lastPersistAtMs).toBe(200);
    expect(formatLongTaskBoardProgressLine(progress)).toContain("done 1");
  });

  it("falls back to SessionTaskBoard SoT", () => {
    const progress = summarizeLongTaskBoardProgress({
      sessionBoard: {
        current: {
          taskId: "task-1",
          title: "写第二章",
          unfinished: true,
          createdAtMs: 50,
        },
        parked: [
          {
            taskId: "task-0",
            title: "调研",
            unfinished: false,
            deliverableChecked: true,
            parkedAtMs: 40,
          },
        ],
      },
    });
    expect(progress.doneCount).toBe(1);
    expect(progress.currentBlocker).toBe("current: 写第二章");
    expect(progress.lastPersistAtMs).toBe(50);
  });
});
