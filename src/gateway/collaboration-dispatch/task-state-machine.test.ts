import { describe, expect, it } from "vitest";
import {
  applyGovernanceAfterLiveTransition,
  canTransitionGovernanceTask,
  InvalidGovernanceTaskTransitionError,
  mapGovernanceToLiveStatus,
  mapLiveStatusToGovernance,
  syncGovernanceAfterLiveTransition,
  transitionGovernanceTask,
} from "./task-state-machine.js";

describe("governance task state machine", () => {
  it("allows the v1.1 happy path", () => {
    expect(transitionGovernanceTask("OPEN", "TRIAGED")).toBe("TRIAGED");
    expect(transitionGovernanceTask("TRIAGED", "ASSIGNED")).toBe("ASSIGNED");
    expect(transitionGovernanceTask("ASSIGNED", "IN_PROGRESS")).toBe("IN_PROGRESS");
    expect(transitionGovernanceTask("IN_PROGRESS", "REVIEW")).toBe("REVIEW");
    expect(transitionGovernanceTask("REVIEW", "READY")).toBe("READY");
    expect(transitionGovernanceTask("READY", "HUMAN_DECISION")).toBe("HUMAN_DECISION");
    expect(transitionGovernanceTask("HUMAN_DECISION", "DELIVERED")).toBe("DELIVERED");
    expect(transitionGovernanceTask("DELIVERED", "CLOSED")).toBe("CLOSED");
  });

  it("rejects skipping review", () => {
    expect(canTransitionGovernanceTask("IN_PROGRESS", "DELIVERED")).toBe(false);
    expect(() => transitionGovernanceTask("IN_PROGRESS", "DELIVERED")).toThrow(
      InvalidGovernanceTaskTransitionError,
    );
  });

  it("maps live status onto the overlay without replacing it", () => {
    expect(mapLiveStatusToGovernance("ready")).toBe("ASSIGNED");
    expect(mapLiveStatusToGovernance("in_progress")).toBe("IN_PROGRESS");
    expect(mapLiveStatusToGovernance("review")).toBe("REVIEW");
    expect(mapLiveStatusToGovernance("completed")).toBe("DELIVERED");
    expect(mapGovernanceToLiveStatus("HUMAN_DECISION")).toBe("review");
    expect(mapGovernanceToLiveStatus("REVISION")).toBe("in_progress");
  });

  it("keeps revision and human-decision when live status is reused", () => {
    expect(
      syncGovernanceAfterLiveTransition({ previous: "REVIEW", liveStatus: "in_progress" }),
    ).toBe("REVISION");
    expect(syncGovernanceAfterLiveTransition({ previous: "READY", liveStatus: "review" })).toBe(
      "HUMAN_DECISION",
    );
  });

  it("walks live completed through v1.1 hops instead of skipping review", () => {
    expect(canTransitionGovernanceTask("IN_PROGRESS", "DELIVERED")).toBe(false);
    expect(
      applyGovernanceAfterLiveTransition({ previous: "IN_PROGRESS", liveStatus: "completed" }),
    ).toBe("DELIVERED");
    expect(
      applyGovernanceAfterLiveTransition({ previous: "REVIEW", liveStatus: "in_progress" }),
    ).toBe("REVISION");
  });
});
