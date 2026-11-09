import { describe, expect, it, vi } from "vitest";
import type { ReplyPayload } from "../../../auto-reply/types.js";
import type { GrowthOutcomeCommitOpts } from "../../../task-outcome/runtime-from-runner.js";
import { HONEST_EMPTY_REPLY_EN, type HonestEmptyReplyDecisionInput } from "../index.js";
import { completeReplyDelivery } from "./complete-reply.js";

function fixture() {
  return {
    runId: "run-a",
    language: "en" as const,
    readContract: vi.fn(() => ({
      id: "code-v1",
      version: "1",
      kind: "code" as const,
      requiredValidators: ["tests"],
      acceptanceVerified: false,
    })),
    commitOutcome: vi.fn<(success: boolean, opts: GrowthOutcomeCommitOpts) => unknown>(),
    recordEmptyGap: vi.fn(),
    considerContinuation: vi.fn(),
    finalize: vi.fn((payload: ReplyPayload | ReplyPayload[] | undefined) => payload),
  };
}
function probe(
  overrides: Partial<HonestEmptyReplyDecisionInput> = {},
): HonestEmptyReplyDecisionInput {
  return {
    isHeartbeat: false,
    sessionCtx: { ChatType: "direct" },
    rawPayloads: [],
    blockStreamDelivered: false,
    directlySentBlockCount: 0,
    toolResultDelivered: false,
    ...overrides,
  };
}

describe("terminal reply delivery", () => {
  it.each(["passed", "pending", "failed"] as const)(
    "uses prepared host acceptance %s for continuation",
    (acceptanceStatus) => {
      const ports = fixture();
      ports.readContract.mockReturnValue({
        id: "code-v1",
        version: "1",
        kind: "code",
        requiredValidators: ["tests"],
        acceptanceVerified: true,
      });
      completeReplyDelivery(
        { kind: "visible", payloads: [{ text: "result" }], acceptanceStatus },
        ports,
      );
      expect(ports.considerContinuation).toHaveBeenCalledTimes(
        acceptanceStatus === "passed" ? 0 : 1,
      );
    },
  );

  it("waits for delivery instead of rerunning already verified work", () => {
    const ports = fixture();
    ports.readContract.mockReturnValue({
      id: "code-v1",
      version: "1",
      kind: "code",
      requiredValidators: ["tests"],
      acceptanceVerified: true,
    });
    expect(
      completeReplyDelivery({ kind: "visible", payloads: [{ text: "verified result" }] }, ports),
    ).toEqual({ text: "verified result" });
    expect(ports.considerContinuation).not.toHaveBeenCalled();
    expect(ports.commitOutcome).not.toHaveBeenCalled();
  });
  it("keeps an empty private turn a failure even while emitting an honest fallback", () => {
    const ports = fixture();
    expect(completeReplyDelivery({ kind: "empty", probe: probe() }, ports)).toEqual({
      text: HONEST_EMPTY_REPLY_EN,
    });
    expect(ports.commitOutcome).toHaveBeenCalledWith(false, {
      failureReason: "run_failed",
      failureDetail: "direct_chat_silent_or_empty_reply",
    });
    expect(ports.recordEmptyGap).toHaveBeenCalledWith("direct_chat_silent_or_empty_reply");
    expect(ports.readContract).not.toHaveBeenCalled();
    expect(ports.considerContinuation).not.toHaveBeenCalled();
    expect(ports.commitOutcome.mock.invocationCallOrder[0]).toBeLessThan(
      ports.recordEmptyGap.mock.invocationCallOrder[0],
    );
    expect(ports.recordEmptyGap.mock.invocationCallOrder[0]).toBeLessThan(
      ports.finalize.mock.invocationCallOrder[0],
    );
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it("gives user cancellation precedence over all silent delivery evidence", () => {
    const ports = fixture();
    expect(
      completeReplyDelivery(
        {
          kind: "empty",
          probe: probe({
            runAborted: true,
            isHeartbeat: true,
            reactionDelivered: true,
            blockStreamDelivered: true,
          }),
        },
        ports,
      ),
    ).toBeUndefined();
    expect(ports.commitOutcome).toHaveBeenCalledWith(false, {
      failureReason: "user_cancelled",
      failureDetail: "user_aborted",
    });
    expect(ports.readContract).not.toHaveBeenCalled();
    expect(ports.recordEmptyGap).not.toHaveBeenCalled();
    expect(ports.considerContinuation).not.toHaveBeenCalled();
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it.each([
    [{ blockStreamDelivered: true }, "block_stream_delivered"],
    [{ directlySentBlockCount: 1 }, "block_stream_delivered"],
    [{ toolResultDelivered: true }, "tool_result_delivered"],
    [{ reactionDelivered: true }, "reaction_delivered"],
    [{ messagingToolSentTexts: ["sent"] }, "messaging_tool_delivered"],
  ] as const)("avoids duplicate final messages for in-run delivery %j", (evidence, reason) => {
    const ports = fixture();
    expect(completeReplyDelivery({ kind: "empty", probe: probe(evidence) }, ports)).toBeUndefined();
    expect(ports.commitOutcome).toHaveBeenCalledWith(true, {
      acceptance: { status: "pending" },
      delivery: {
        status:
          reason === "messaging_tool_delivered" || reason === "reaction_delivered"
            ? "delivered"
            : "pending",
      },
      deliveryId: `delivery:run-a:${reason}`,
    });
    expect(ports.recordEmptyGap).not.toHaveBeenCalled();
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it.each([
    { isHeartbeat: true },
    { sessionCtx: { ChatType: "group", GroupSubject: "market" } },
    { sessionCtx: { ChatType: "direct", CollaborationGroupId: "group-a" } },
    { sessionCtx: { ChatType: "direct", InputProvenance: { kind: "internal_system" } } },
    { rawPayloads: [{ text: "already filtered" }] },
  ] satisfies Partial<HonestEmptyReplyDecisionInput>[])(
    "preserves legitimate silence without fallback or gap %j",
    (evidence) => {
      const ports = fixture();
      expect(
        completeReplyDelivery({ kind: "empty", probe: probe(evidence) }, ports),
      ).toBeUndefined();
      expect(ports.commitOutcome).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          acceptance: { status: "pending" },
          delivery: { status: "pending" },
        }),
      );
      expect(ports.recordEmptyGap).not.toHaveBeenCalled();
      expect(ports.considerContinuation).not.toHaveBeenCalled();
      expect(ports.finalize).toHaveBeenCalledOnce();
    },
  );

  it("preserves confirmed messaging-tool delivery even when the group allows silence", () => {
    const ports = fixture();
    completeReplyDelivery(
      {
        kind: "empty",
        probe: probe({ sessionCtx: { ChatType: "group" }, didSendViaMessagingTool: true }),
      },
      ports,
    );
    expect(ports.commitOutcome).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        acceptance: { status: "pending" },
        delivery: { status: "delivered" },
      }),
    );
  });

  it("does not turn a language-filtered reply without tools into success or a capability gap", () => {
    const ports = fixture();
    expect(
      completeReplyDelivery({ kind: "language_filtered", didUseTools: false }, ports),
    ).toBeUndefined();
    expect(ports.commitOutcome).toHaveBeenCalledWith(false, {
      failureReason: "user_filtered",
      failureDetail: "language_gate_empty",
    });
    expect(ports.readContract).not.toHaveBeenCalled();
    expect(ports.recordEmptyGap).not.toHaveBeenCalled();
    expect(ports.considerContinuation).not.toHaveBeenCalled();
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it("emits only an unfinished process sentence after tools and consults existing continuation before finalizing", () => {
    const ports = fixture();
    const payload = completeReplyDelivery({ kind: "language_filtered", didUseTools: true }, ports);
    expect(payload).toEqual({ text: "Looking this up." });
    expect(ports.commitOutcome).toHaveBeenCalledWith(true, { processPlaceholder: true });
    expect(ports.readContract).not.toHaveBeenCalled();
    expect(ports.recordEmptyGap).not.toHaveBeenCalled();
    expect(ports.considerContinuation).toHaveBeenCalledWith([payload]);
    expect(ports.commitOutcome.mock.invocationCallOrder[0]).toBeLessThan(
      ports.considerContinuation.mock.invocationCallOrder[0],
    );
    expect(ports.considerContinuation.mock.invocationCallOrder[0]).toBeLessThan(
      ports.finalize.mock.invocationCallOrder[0],
    );
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it("preserves non-visible outcome fire-and-forget timing", () => {
    const ports = fixture();
    ports.commitOutcome.mockReturnValue(new Promise<void>(() => {}));
    expect(completeReplyDelivery({ kind: "language_filtered", didUseTools: true }, ports)).toEqual({
      text: "Looking this up.",
    });
    expect(ports.finalize).toHaveBeenCalledOnce();
  });

  it.each([
    { payloads: [] },
    { payloads: [{ text: "answer" }] },
    { payloads: [{ text: "answer" }, { mediaUrl: "/tmp/result.png" }] },
  ])(
    "uses the same final outlet for visible payloads %j without committing twice",
    ({ payloads }) => {
      const ports = fixture();
      const result = completeReplyDelivery({ kind: "visible", payloads }, ports);
      expect(result).toEqual(payloads.length === 1 ? payloads[0] : payloads);
      expect(ports.commitOutcome).not.toHaveBeenCalled();
      expect(ports.readContract).toHaveBeenCalledOnce();
      expect(ports.considerContinuation).toHaveBeenCalledWith(payloads);
      expect(ports.finalize).toHaveBeenCalledOnce();
    },
  );
});
