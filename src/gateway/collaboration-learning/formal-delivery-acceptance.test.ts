import { describe, expect, it } from "vitest";
import { acceptBoardItemSubmission } from "../collaboration-dispatch/claim-contract.js";
import type { RuntimeAuthority } from "../collaboration-dispatch/runtime-authority.js";
import {
  applyFormalAcceptanceForm,
  chatCompletionLeavesAcceptanceUnchanged,
  ingestMemberAcceptanceSignal,
  isBareChatCompletionPhrase,
  type FormalAcceptanceState,
} from "./formal-delivery-acceptance.js";

const currentTaskId = "d2t-1a878cb6fbef8cd92109834f";

function emptyState(): FormalAcceptanceState {
  return {
    phase: "none",
    taskId: null,
    artifactTaskId: null,
    openSubmissionId: null,
  };
}

describe("formal delivery acceptance", () => {
  it("binds the member artifact to the current task and walks submit → return → revise → accept", () => {
    const submitted = applyFormalAcceptanceForm({
      state: emptyState(),
      action: "submit",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-1",
    });
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) {
      return;
    }
    expect(submitted.receipt.phase).toBe("submitted");
    expect(submitted.state.artifactTaskId).toBe(currentTaskId);

    const returned = applyFormalAcceptanceForm({
      state: submitted.state,
      action: "return",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-1",
    });
    expect(returned.ok).toBe(true);
    if (!returned.ok) {
      return;
    }
    expect(returned.state.phase).toBe("returned");

    const late = applyFormalAcceptanceForm({
      state: returned.state,
      action: "accept",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-1",
      expectedSubmissionId: "sub-1",
    });
    expect(late.ok).toBe(false);

    const revised = applyFormalAcceptanceForm({
      state: returned.state,
      action: "revise",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-2",
    });
    expect(revised.ok).toBe(true);
    if (!revised.ok) {
      return;
    }
    expect(revised.receipt.submissionId).toBe("sub-2");

    const accepted = applyFormalAcceptanceForm({
      state: revised.state,
      action: "accept",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-2",
      expectedSubmissionId: "sub-2",
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      return;
    }
    expect(accepted.state.phase).toBe("accepted");
    expect(accepted.receipt.taskId).toBe(currentTaskId);
  });

  it("refuses a historical artifact and a chat 完成 message", () => {
    const mismatch = applyFormalAcceptanceForm({
      state: emptyState(),
      action: "submit",
      currentTaskId,
      artifactTaskId: "F4-20261029-uxp0",
      submissionId: "sub-1",
    });
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.reason).toBe("artifact_task_mismatch");
      expect(mismatch.state.phase).toBe("none");
    }

    const held = chatCompletionLeavesAcceptanceUnchanged({
      chatText: "闭环完成",
      state: {
        phase: "submitted",
        taskId: currentTaskId,
        artifactTaskId: currentTaskId,
        openSubmissionId: "sub-1",
      },
    });
    expect(held.changed).toBe(false);
    expect(held.state.phase).toBe("submitted");

    const viaChat = ingestMemberAcceptanceSignal({
      channel: "chat",
      chatText: "完成",
      state: emptyState(),
      action: "accept",
      currentTaskId,
      artifactTaskId: currentTaskId,
      submissionId: "sub-1",
    });
    expect(viaChat.ok).toBe(false);
    expect(viaChat.changed).toBe(false);
    expect(viaChat.state.phase).toBe("none");
  });

  it("acceptBoardItemSubmission refuses bare chat completion before any write", async () => {
    expect(isBareChatCompletionPhrase("完成")).toBe(true);
    expect(isBareChatCompletionPhrase("闭环完成")).toBe(true);
    expect(isBareChatCompletionPhrase("meets acceptance")).toBe(false);
    const result = await acceptBoardItemSubmission({} as RuntimeAuthority, {
      taskId: currentTaskId,
      itemId: "item-1",
      actorId: "human-ceo",
      reason: "闭环完成",
      expectedSubmissionId: "sub-1",
      checkedAcceptanceCriteria: ["有标题"],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("chat_completion_is_not_acceptance");
    }
  });
});
