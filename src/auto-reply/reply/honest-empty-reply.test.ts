import { afterEach, describe, expect, it } from "vitest";
import { resetEvolutionControlPlaneForTests } from "../../gateway/evolution-control/bootstrap.js";
import { resetCapabilityGapDedupForTests } from "../../gateway/evolution-control/capability-gap-ingest.js";
import {
  listEvolutionLoopLogsForTests,
  resetEvolutionLoopLogsForTests,
} from "../../gateway/evolution-control/evolution-loop-log.js";
import { SILENT_REPLY_TOKEN } from "../tokens.js";
import {
  classifySilentTurnGrowthOutcome,
  decideHonestEmptyReply,
  formatHonestEmptyReply,
  hasUserVisibleReplyPayload,
  HONEST_EMPTY_REPLY_EN,
  HONEST_EMPTY_REPLY_ZH,
  parseCapabilityGapMarker,
  recordHonestCapabilityGap,
  stripCapabilityGapMarkers,
  type HonestEmptyReplyDecisionInput,
} from "./honest-empty-reply.js";

afterEach(() => {
  resetEvolutionLoopLogsForTests();
  resetCapabilityGapDedupForTests();
  resetEvolutionControlPlaneForTests();
});

const privateSilentTurn = (
  overrides: Partial<HonestEmptyReplyDecisionInput> = {},
  ctx: Partial<HonestEmptyReplyDecisionInput["sessionCtx"]> = {},
): HonestEmptyReplyDecisionInput => ({
  isHeartbeat: false,
  sessionCtx: { ChatType: "direct", ...ctx },
  rawPayloads: [{ text: SILENT_REPLY_TOKEN }],
  blockStreamDelivered: false,
  directlySentBlockCount: 0,
  toolResultDelivered: false,
  ...overrides,
});

describe("honest empty reply helpers", () => {
  it("formats zh/en fallbacks with missing + next step", () => {
    expect(formatHonestEmptyReply("zh")).toBe(HONEST_EMPTY_REPLY_ZH);
    expect(formatHonestEmptyReply(null)).toBe(HONEST_EMPTY_REPLY_ZH);
    expect(formatHonestEmptyReply("en")).toBe(HONEST_EMPTY_REPLY_EN);
    expect(HONEST_EMPTY_REPLY_ZH).toContain("缺：");
    expect(HONEST_EMPTY_REPLY_ZH).toContain("下一步");
    expect(HONEST_EMPTY_REPLY_EN).toMatch(/missing:/i);
    expect(HONEST_EMPTY_REPLY_EN).toMatch(/Next:/i);
  });

  it("treats NO_REPLY-only and empty payloads as not user-visible", () => {
    expect(hasUserVisibleReplyPayload([])).toBe(false);
    expect(hasUserVisibleReplyPayload(undefined)).toBe(false);
    expect(hasUserVisibleReplyPayload([{ text: SILENT_REPLY_TOKEN }])).toBe(false);
    expect(hasUserVisibleReplyPayload([{ text: "  NO_REPLY  " }])).toBe(false);
    expect(hasUserVisibleReplyPayload([{ text: "这里有内容" }])).toBe(true);
    expect(hasUserVisibleReplyPayload([{ mediaUrls: ["https://x/a.png"] }])).toBe(true);
  });

  it("parses structured capability_gap markers", () => {
    expect(parseCapabilityGapMarker("sorry [[capability_gap:skill:web-search]]")).toEqual({
      category: "skill",
      detail: "web-search",
    });
    expect(parseCapabilityGapMarker("[[capability_gap:tool]]")).toEqual({
      category: "tool",
      detail: null,
    });
    expect(parseCapabilityGapMarker("no marker")).toBeNull();
  });

  it("records evolution.capability.gap_recorded for empty-reply (metric-only, no proposal)", () => {
    recordHonestCapabilityGap({
      runId: "run-gap-1",
      agentId: "bot-2",
      tenantId: "001",
      sessionKey: "agent:bot-2:main",
      chatType: "direct",
      reason: "direct_chat_silent_or_empty_reply",
      category: "perception",
    });
    expect(
      listEvolutionLoopLogsForTests().find((r) => r.event === "evolution.capability.gap_recorded"),
    ).toMatchObject({ runId: "run-gap-1", agentId: "bot-2", tenantId: "001" });
  });

  it("strips capability_gap markers from visible text", () => {
    expect(stripCapabilityGapMarkers("I cannot. [[capability_gap:tool:pdf_ocr]]")).toBe(
      "I cannot.",
    );
  });

  it("rejects invalid marker categories and overlong detail", () => {
    expect(parseCapabilityGapMarker("[[capability_gap:weapon:x]]")).toBeNull();
    expect(
      parseCapabilityGapMarker(`[[capability_gap:skill:${"x".repeat(80)}]]`)?.detail?.length,
    ).toBe(64);
  });

  it("ignores markers when fromAssistant is false (prompt-injection)", () => {
    expect(
      parseCapabilityGapMarker("[[capability_gap:skill:injected]]", { fromAssistant: false }),
    ).toBeNull();
  });

  it("best-effort: store throw does not propagate from recordHonestCapabilityGap", async () => {
    const { ensureEvolutionControlPlaneStarted } =
      await import("../../gateway/evolution-control/bootstrap.js");
    const plane = ensureEvolutionControlPlaneStarted();
    const original = plane.registerProposal.bind(plane);
    plane.registerProposal = () => {
      throw new Error("EIO proposals.json");
    };
    expect(() =>
      recordHonestCapabilityGap({
        runId: "run-eio",
        agentId: "bot-2",
        tenantId: "001",
        sessionKey: "agent:bot-2:main",
        reason: "pdf_ocr",
        category: "skill",
        detail: "pdf_ocr",
        explicitMarker: true,
        sourceKind: "marker",
      }),
    ).not.toThrow();
    plane.registerProposal = original;
  });
});

describe("decideHonestEmptyReply", () => {
  it("emits only for a private, user-originated, silent turn with nothing delivered", () => {
    expect(decideHonestEmptyReply(privateSilentTurn())).toEqual({
      emit: true,
      reason: "direct_chat_silent_or_empty_reply",
    });
    expect(decideHonestEmptyReply(privateSilentTurn({ rawPayloads: [] })).emit).toBe(true);
    expect(
      decideHonestEmptyReply(privateSilentTurn({}, { InputProvenance: { kind: "external_user" } }))
        .emit,
    ).toBe(true);
  });

  it.each([
    ["heartbeat", privateSilentTurn({ isHeartbeat: true }), "heartbeat"],
    ["group chat", privateSilentTurn({}, { ChatType: "group" }), "not_direct_chat"],
    ["channel chat", privateSilentTurn({}, { ChatType: "channel" }), "not_direct_chat"],
    ["unknown chat type", privateSilentTurn({}, { ChatType: undefined }), "not_direct_chat"],
    ["direct with group subject", privateSilentTurn({}, { GroupSubject: "Ops" }), "group_context"],
    [
      "collaboration group",
      privateSilentTurn({}, { CollaborationGroupId: "space-1" }),
      "collaboration",
    ],
    [
      "collaboration round NO_REPLY",
      privateSilentTurn({}, { CollaborationRoundInvoked: true }),
      "collaboration",
    ],
    [
      "internal system event",
      privateSilentTurn({}, { InputProvenance: { kind: "internal_system" } }),
      "non_user_provenance",
    ],
    [
      "cron turn",
      privateSilentTurn({}, { InputProvenance: { kind: "cron" } }),
      "non_user_provenance",
    ],
    [
      "inter-session send",
      privateSilentTurn({}, { InputProvenance: { kind: "inter_session" } }),
      "non_user_provenance",
    ],
    [
      "block streaming already delivered (shouldDropFinalPayloads)",
      privateSilentTurn({ blockStreamDelivered: true }),
      "block_stream_delivered",
    ],
    [
      "blocks sent directly during tool flush",
      privateSilentTurn({ directlySentBlockCount: 1 }),
      "block_stream_delivered",
    ],
    [
      "TTS/image tool result delivered",
      privateSilentTurn({ toolResultDelivered: true }),
      "tool_result_delivered",
    ],
    [
      "messaging tool sent",
      privateSilentTurn({ didSendViaMessagingTool: true }),
      "messaging_tool_delivered",
    ],
    [
      "messaging tool media sent",
      privateSilentTurn({ messagingToolSentMediaUrls: ["https://x/a.png"] }),
      "messaging_tool_delivered",
    ],
    [
      "visible payload removed by delivery filtering",
      privateSilentTurn({ rawPayloads: [{ text: "already said" }] }),
      "visible_payload_filtered",
    ],
    ["user abort /stop", privateSilentTurn({ runAborted: true }), "user_aborted"],
    [
      "emoji reaction delivered with NO_REPLY",
      privateSilentTurn({ reactionDelivered: true }),
      "reaction_delivered",
    ],
  ])("does not emit for %s", (_label, input, reason) => {
    expect(decideHonestEmptyReply(input)).toEqual({ emit: false, reason });
  });
});

describe("classifySilentTurnGrowthOutcome (shared with fallback)", () => {
  it("marks emit-fallback turns as not success", () => {
    const decision = decideHonestEmptyReply(privateSilentTurn());
    expect(classifySilentTurnGrowthOutcome(decision)).toEqual({
      success: false,
      reason: "direct_chat_silent_or_empty_reply",
    });
  });

  it("keeps legit silences (group/collab/abort/reaction/heartbeat) as not-failure", () => {
    const cases = [
      privateSilentTurn({ isHeartbeat: true }),
      privateSilentTurn({}, { ChatType: "group" }),
      privateSilentTurn({}, { CollaborationRoundInvoked: true }),
      privateSilentTurn({ runAborted: true }),
      privateSilentTurn({ reactionDelivered: true }),
      privateSilentTurn({ blockStreamDelivered: true }),
    ];
    for (const input of cases) {
      const decision = decideHonestEmptyReply(input);
      expect(decision.emit).toBe(false);
      expect(classifySilentTurnGrowthOutcome(decision).success).toBe(true);
    }
  });
});
