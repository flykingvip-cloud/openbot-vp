// @vitest-environment node
import { describe, expect, it } from "vitest";
import { COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION } from "./collab-dispatch-confirmation.js";
import {
  listConfirmActions,
  lookupConfirmAction,
  resolveConfirmIrreversible,
} from "./confirm-action-descriptor.js";
import { MEETING_APPROVE_CONFIRM_ACTION } from "./meeting-confirmation.js";

describe("ConfirmActionDescriptor registry", () => {
  it("registers meeting.approve and collab.dispatch.approve descriptors", () => {
    expect(lookupConfirmAction("meeting.approve:m1")).toBe(MEETING_APPROVE_CONFIRM_ACTION);
    expect(lookupConfirmAction("collab.dispatch.approve:d1")).toBe(
      COLLAB_DISPATCH_APPROVE_CONFIRM_ACTION,
    );
    const patterns = listConfirmActions().map((d) => d.actionIdPattern);
    expect(patterns).toContain("meeting.approve:");
    expect(patterns).toContain("collab.dispatch.approve:");
    expect(MEETING_APPROVE_CONFIRM_ACTION.uiChrome).toBe("inline_card");
    expect(MEETING_APPROVE_CONFIRM_ACTION.irreversible).toBe(false);
    expect(resolveConfirmIrreversible(MEETING_APPROVE_CONFIRM_ACTION, {} as never)).toBe(false);
  });

  it("meeting descriptor exposes preflight + consequenceHint without tokens", () => {
    expect(typeof MEETING_APPROVE_CONFIRM_ACTION.preflight).toBe("function");
    expect(typeof MEETING_APPROVE_CONFIRM_ACTION.consequenceHint).toBe("function");
    expect(typeof MEETING_APPROVE_CONFIRM_ACTION.onCancel).toBe("function");
    expect(typeof MEETING_APPROVE_CONFIRM_ACTION.onConfirm).toBe("function");
    expect(JSON.stringify(MEETING_APPROVE_CONFIRM_ACTION.actionIdPattern)).not.toMatch(
      /confirmationToken/,
    );
  });
});
