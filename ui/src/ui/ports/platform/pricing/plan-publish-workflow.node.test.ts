// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolvePublishStepStatuses } from "./plan-publish-workflow.ts";

describe("resolvePublishStepStatuses", () => {
  it("highlights configure when draft exists but models are missing", () => {
    const statuses = resolvePublishStepStatuses({
      hasDraft: true,
      hasActiveVersion: true,
      configureDone: false,
      diffCount: 2,
      activationReady: false,
      lockedSubscriptions: 3,
    });
    expect(statuses.draft).toBe("done");
    expect(statuses.configure).toBe("current");
    expect(statuses.preview).toBe("pending");
  });

  it("highlights activate when draft is ready", () => {
    const statuses = resolvePublishStepStatuses({
      hasDraft: true,
      hasActiveVersion: true,
      configureDone: true,
      diffCount: 0,
      activationReady: true,
      lockedSubscriptions: 1,
    });
    expect(statuses.draft).toBe("done");
    expect(statuses.configure).toBe("done");
    expect(statuses.preview).toBe("done");
    expect(statuses.activate).toBe("current");
    expect(statuses.refresh).toBe("pending");
  });

  it("marks refresh done when no enterprises are locked", () => {
    const statuses = resolvePublishStepStatuses({
      hasDraft: false,
      hasActiveVersion: true,
      configureDone: true,
      diffCount: 0,
      activationReady: false,
      lockedSubscriptions: 0,
    });
    expect(statuses.refresh).toBe("done");
  });
});
