import { describe, expect, it } from "vitest";
import { resolvePatternTaskId } from "./task-id.js";

describe("resolvePatternTaskId", () => {
  it("returns null when only session/run available", () => {
    expect(
      resolvePatternTaskId({
        runId: "run-1",
        sessionKey: "agent:bot:main",
      }),
    ).toBeNull();
  });

  it("never uses sessionKey as task id even if passed as collab", () => {
    expect(
      resolvePatternTaskId({
        runId: "run-1",
        sessionKey: "agent:bot:main",
        collaborationTaskId: "agent:bot:main",
      }),
    ).toBeNull();
  });

  it("prefers collaboration task id", () => {
    expect(
      resolvePatternTaskId({
        runId: "run-1",
        sessionKey: "agent:bot:main",
        collaborationTaskId: "task_abc",
        inputProvenance: { kind: "cron", cronJobId: "job-1" },
      }),
    ).toBe("collab:task_abc");
  });

  it("uses cron job + run as task id", () => {
    expect(
      resolvePatternTaskId({
        runId: "run-turn",
        inputProvenance: {
          kind: "cron",
          cronJobId: "job-weekly",
          cronRunId: "cron-run-9",
        },
      }),
    ).toBe("cron:job-weekly:cron-run-9");
  });

  it("uses deliverable / lineage when present", () => {
    expect(
      resolvePatternTaskId({
        runId: "r",
        deliverableId: "deliv_1",
      }),
    ).toBe("deliverable:deliv_1");
    expect(
      resolvePatternTaskId({
        runId: "r",
        lineageId: "lin_2",
      }),
    ).toBe("lineage:lin_2");
  });
});
