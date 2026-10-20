/**
 * P0.1 runtime brand / signature smoke (Floor Runtime v2.1 §5.3).
 */
import { describe, expect, it } from "vitest";
import { decideParticipants } from "./decision-engine.js";
import type { DecideInput } from "./runtime-authority.js";
import {
  buildGroupRuntimeAuthority,
  isRuntimeAuthority,
  isRuntimeFacts,
  scopeViewFromRuntimeFacts,
} from "./runtime-authority.js";
import type { CollaborationDispatchScope } from "./types.js";

describe("runtime-authority type brand (P0.1)", () => {
  it("createRuntimeAuthority / projectRuntimeFacts produce branded values", () => {
    const scope = {
      groupId: "g1",
      rawSessionKey: "agent:main:space:g1",
      title: "t",
      bots: [],
      tenantId: null,
    } satisfies CollaborationDispatchScope;
    const { authority, facts } = buildGroupRuntimeAuthority({
      scope,
      episodeId: "ep_test",
    });
    expect(isRuntimeAuthority(authority)).toBe(true);
    expect(isRuntimeFacts(facts)).toBe(true);
    const input: DecideInput = {
      message: "hi",
      roundId: "r1",
      operatingState: null,
    };
    const decision = decideParticipants(authority, facts, input);
    expect(decision.roundId).toBe("r1");
    // Signature is positional (authority, facts, input) — not a scope params object.
    expect(decideParticipants.length).toBe(3);
  });
});

describe("scopeViewFromRuntimeFacts.collaborationMode contract (P1-A5 ③ acceptance)", () => {
  it("mirrors authority.policy.effective.strategy.id (including discussion_driven default)", () => {
    const scope = {
      groupId: "g1",
      rawSessionKey: "agent:main:space:g1",
      title: "t",
      bots: [],
      tenantId: null,
      coordinatorBotId: null,
    } satisfies import("./types.js").CollaborationDispatchScope;
    const { authority, facts } = buildGroupRuntimeAuthority({
      scope,
      episodeId: "ep_cm",
    });
    const view = scopeViewFromRuntimeFacts(authority, facts);
    // Default OS-less compile → L1 discussion_driven.
    expect(view.operatingState?.groupProfile.collaborationMode).toBe(
      authority.policy.effective.strategy.id,
    );
    expect(view.operatingState?.groupProfile.collaborationMode).toBe("discussion_driven");
    expect(view.groupProfile?.collaborationMode).toBe(authority.policy.effective.strategy.id);
  });

  it("never yields null/undefined/unknown — always a ModeTemplate id string", () => {
    const scope = {
      groupId: "g2",
      rawSessionKey: "agent:main:space:g2",
      title: "t2",
      bots: [],
      tenantId: null,
    } satisfies import("./types.js").CollaborationDispatchScope;
    const { authority, facts } = buildGroupRuntimeAuthority({
      scope,
      episodeId: "ep_cm2",
    });
    const view = scopeViewFromRuntimeFacts(authority, facts);
    const mode = view.operatingState?.groupProfile.collaborationMode;
    expect(typeof mode).toBe("string");
    expect(["discussion_driven", "task_driven", "review_driven"]).toContain(mode);
    expect(mode).not.toBeNull();
    expect(mode).not.toBeUndefined();
    expect(mode).not.toBe("unknown");
  });
});
