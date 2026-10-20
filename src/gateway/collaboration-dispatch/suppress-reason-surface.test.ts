import { afterEach, describe, expect, it } from "vitest";
import {
  COLLABORATION_SUPPRESS_KIND_LABEL_ZH,
  collaborationSuppressKindFromFaultOutcome,
  collaborationSuppressKindFromSkipReason,
  formatCollaborationSuppressAbortNotice,
  formatCollaborationSuppressNotice,
  isCollaborationSurfaceSilentSuppressReasonsEnabled,
} from "./suppress-reason-surface.js";

describe("suppress reason surface", () => {
  afterEach(() => {
    delete process.env.OPENBOT_COLLAB_SURFACE_SILENT_SUPPRESS;
  });

  it("defaults off", () => {
    expect(isCollaborationSurfaceSilentSuppressReasonsEnabled()).toBe(false);
  });

  it("enables via config or env", () => {
    expect(
      isCollaborationSurfaceSilentSuppressReasonsEnabled({
        collaboration: { surfaceSilentSuppressReasons: true },
      }),
    ).toBe(true);
    process.env.OPENBOT_COLLAB_SURFACE_SILENT_SUPPRESS = "1";
    expect(isCollaborationSurfaceSilentSuppressReasonsEnabled()).toBe(true);
  });

  it("maps skipReason / fault outcome to the four expert categories", () => {
    expect(collaborationSuppressKindFromSkipReason("duplicate")).toBe("ran_duplicate_skipped");
    expect(collaborationSuppressKindFromSkipReason("silent")).toBe("ran_duplicate_skipped");
    expect(collaborationSuppressKindFromSkipReason("empty")).toBe("context_insufficient");
    expect(collaborationSuppressKindFromSkipReason("not_dispatched")).toBe("not_dispatched");
    expect(collaborationSuppressKindFromSkipReason("waiting_member")).toBe(
      "waiting_member_or_approval",
    );
    expect(collaborationSuppressKindFromFaultOutcome("silent_suppress")).toBe(
      "ran_duplicate_skipped",
    );
    expect(collaborationSuppressKindFromFaultOutcome("empty")).toBe("context_insufficient");
  });

  it("formats notices with expert labels", () => {
    expect(
      formatCollaborationSuppressNotice({ kind: "ran_duplicate_skipped", agentName: "市场助手" }),
    ).toBe("市场助手：已运行，重复内容略过");
    expect(formatCollaborationSuppressAbortNotice({ kind: "not_dispatched" })).toContain(
      "未获调度",
    );
    expect(formatCollaborationSuppressAbortNotice({ kind: "context_insufficient" })).toContain(
      "上下文不足",
    );
    expect(COLLABORATION_SUPPRESS_KIND_LABEL_ZH.waiting_member_or_approval).toBe("等待成员／审批");
  });
});
