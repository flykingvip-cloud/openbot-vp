import { describe, expect, test } from "vitest";
import {
  DEFAULT_COLLABORATION_POLICY,
  freezeCollaborationPolicy,
  hashCollaborationPolicy,
  resolveCollaborationPolicyV1,
} from "./policy.js";
import type { CollaborationDispatchScope } from "./types.js";

describe("collaboration policy v1", () => {
  test("snapshots a stable hash for the same policy", () => {
    const a = hashCollaborationPolicy(DEFAULT_COLLABORATION_POLICY);
    const b = hashCollaborationPolicy(DEFAULT_COLLABORATION_POLICY);
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  test("direct sessions disable supplement and coordinator", () => {
    const policy = resolveCollaborationPolicyV1({ forDirectSession: true });
    expect(policy.supplement.enabled).toBe(false);
    expect(policy.coordinator.enabled).toBe(false);
    expect(policy.assignment.primaryAssignmentAtomic).toBe(true);
    expect(policy.contextPolicy.mandatoryGroupContext).toBe(false);
    expect(policy.contextPolicy.defaultMode).toBe("auto");
  });

  test("P1-A3: operating state projects through EffectivePolicy (BP-06 whitelist)", () => {
    const scope = {
      operatingState: {
        collaborationPolicy: {
          mentionBotMustRespond: false,
          openDiscussionWithoutMention: false,
          maxVisibleBotRepliesPerRound: 4,
          coordinatorSummarizeAfterRound: true,
        },
      },
    } as unknown as CollaborationDispatchScope;
    const policy = resolveCollaborationPolicyV1({ operatingState: scope.operatingState });
    expect(policy.mention.mentionBotMustRespond).toBe(false);
    // supplement.enabled follows allowSupplementAfterPrimary (default true), not openDiscussion.
    expect(policy.supplement.enabled).toBe(true);
    expect(policy.supplement.maxSupplementBots).toBe(3);
    expect(policy.coordinator.enabled).toBe(true);
    expect(policy.fallback.timeoutPolicy.byTaskType.research).toBe(60_000);
  });

  test("legacy allowSupplementAfterPrimary false disables supplement without openDiscussion", () => {
    const scope = {
      operatingState: {
        collaborationPolicy: {
          mentionBotMustRespond: true,
          openDiscussionWithoutMention: true,
          allowSupplementAfterPrimary: false,
          maxVisibleBotRepliesPerRound: 4,
        },
      },
    } as unknown as CollaborationDispatchScope;
    const policy = resolveCollaborationPolicyV1({ operatingState: scope.operatingState });
    expect(policy.supplement.enabled).toBe(false);
  });

  test("P1-A3 empty OS follows EffectivePolicy L1 (not PolicyV1 DEFAULT) for overlay fields", () => {
    const policy = resolveCollaborationPolicyV1({});
    expect(policy.mention.mentionBotMustRespond).toBe(false);
    expect(policy.coordinator.enabled).toBe(false);
    expect(policy.supplement.enabled).toBe(true);
    expect(policy.supplement.maxSupplementBots).toBe(3);
  });

  test("frozen snapshot does not follow later live mutation", () => {
    const live = {
      ...DEFAULT_COLLABORATION_POLICY,
      coordinator: { ...DEFAULT_COLLABORATION_POLICY.coordinator, enabled: false },
    };
    const frozen = freezeCollaborationPolicy(live);
    live.coordinator.enabled = true;
    expect(frozen.coordinator.enabled).toBe(false);
    expect(hashCollaborationPolicy(frozen)).not.toBe(hashCollaborationPolicy(live));
  });
});
