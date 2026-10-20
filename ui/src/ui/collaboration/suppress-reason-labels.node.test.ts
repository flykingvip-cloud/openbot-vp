import { describe, expect, it } from "vitest";
import {
  collaborationSuppressKindLabelZh,
  isCollaborationSuppressNoticeMessage,
  readCollaborationSuppressKind,
} from "./suppress-reason-labels.ts";

describe("suppress-reason-labels", () => {
  it("reads and labels suppress kinds", () => {
    expect(
      readCollaborationSuppressKind({ collaborationSuppressKind: "ran_duplicate_skipped" }),
    ).toBe("ran_duplicate_skipped");
    expect(collaborationSuppressKindLabelZh("not_dispatched")).toBe("未获调度");
    expect(collaborationSuppressKindLabelZh("waiting_member_or_approval")).toBe("等待成员／审批");
    expect(collaborationSuppressKindLabelZh("context_insufficient")).toBe("上下文不足");
  });

  it("detects suppress notice messages", () => {
    expect(isCollaborationSuppressNoticeMessage({ collaborationAbort: true })).toBe(true);
    expect(
      isCollaborationSuppressNoticeMessage({
        collaborationMemberSkip: true,
        collaborationSuppressKind: "ran_duplicate_skipped",
      }),
    ).toBe(true);
    expect(isCollaborationSuppressNoticeMessage({ role: "assistant" })).toBe(false);
  });
});
