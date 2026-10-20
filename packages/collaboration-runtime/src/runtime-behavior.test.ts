import type { GroupMemoryCapsule } from "@openbot/collaboration-core";
import { describe, expect, it, vi } from "vitest";
import {
  DefaultCapabilityComposer,
  DefaultLearningEligibilityChecker,
  DefaultLearningPromotionService,
  DefaultParticipationOverlayResolver,
  buildCapabilityContext,
  buildObjectSummary,
  buildMemorySummary,
  canPublishDeliverable,
  canPublishFinalDecision,
  canRuntimeNodePublishProposal,
  createRuntimeProjection,
  injectTaskMemory,
  isProjectionStale,
  resolveMessageRoute,
  validateProjectionPriority,
} from "./index.js";
import type { ProjectionInput } from "./projection/projection-rules.js";

describe("collaboration-runtime behavior", () => {
  it("routes messages by review, deliverable, task, then group", () => {
    const ctx = {
      groupId: "group-1",
      message: "请评审当前交付",
      actor: { id: "human-1", type: "human" as const },
      timestamp: Date.now(),
    };

    const route = resolveMessageRoute(ctx, {
      reviews: [
        {
          reviewId: "review-1",
          groupId: "group-1",
          deliverableId: "del-1",
          reviewerMemberId: "member-1",
          status: "requested",
          requestedAtMs: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });

    expect(route).toEqual({
      target: "review",
      targetId: "review-1",
      priority: 4,
      reason: "Active review found",
    });
  });

  it("projects runtime from object truth ahead of session hints", () => {
    const input: ProjectionInput = {
      groupId: "group-1",
      sessionId: "session-1",
      actorId: "owner-1",
      message: "继续推进",
      wasMentioned: true,
      timestamp: Date.now(),
      sessionMetadata: {
        collaborationPhase: "draft",
        collaborationOwnerAgentId: "owner-1",
      },
      storageSnapshots: {
        tasks: [
          {
            taskId: "task-1",
            groupId: "group-1",
            title: "Primary task",
            status: "in_progress",
            ownerMemberId: "owner-1",
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
        deliverables: [
          {
            deliverableId: "del-1",
            groupId: "group-1",
            title: "Draft delivery",
            status: "approved",
            version: 1,
            createdAtMs: 1,
            updatedAtMs: 1,
          },
        ],
      },
    };

    const projection = createRuntimeProjection(input);

    expect(projection.role).toBe("owner");
    expect(projection.phase).toBe("final");
    expect(projection.canPublishFinal).toBe(true);
    expect(projection.metadata?.collaborationDeliverableId).toBe("del-1");
  });

  it("builds memory summaries in recency order", () => {
    const summaries = buildMemorySummary([
      {
        memoryId: "memory-1",
        groupId: "group-1",
        type: "consensus",
        title: "Older",
        content: "Older memory",
        source: "discussion",
        importance: "medium",
        createdAt: Date.now() - 2_000,
        updatedAt: Date.now() - 2_000,
      },
      {
        memoryId: "memory-2",
        groupId: "group-1",
        type: "constraint",
        title: "Newer",
        content: "Newer memory",
        source: "task",
        sourceId: "task-1",
        importance: "high",
        createdAt: Date.now() - 100,
        updatedAt: Date.now() - 100,
      },
    ]);

    expect(summaries[0]?.id).toBe("memory-2");
  });

  it("blocks publish when there are pending reviews", () => {
    const result = canPublishDeliverable({
      deliverableId: "del-1",
      reviews: [
        {
          reviewId: "review-1",
          groupId: "group-1",
          deliverableId: "del-1",
          reviewerMemberId: "member-1",
          status: "submitted",
          requestedAtMs: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("pending_reviews");
  });

  it("applies final gate authority and proposal rules", () => {
    const finalResult = canPublishFinalDecision({
      decisionId: "dec-1",
      actor: { id: "bot-1", type: "bot" },
      decision: {
        decisionId: "dec-1",
        groupId: "group-1",
        title: "Decision",
        options: [],
        status: "draft",
        createdAt: 1,
        updatedAt: 1,
      },
      groupProfile: {
        groupId: "group-1",
        groupCode: "G-1",
        displayName: "Group 1",
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: false,
        },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(finalResult.allowed).toBe(false);
    expect(finalResult.reason).toBe("human_override_required");

    const proposalResult = canRuntimeNodePublishProposal({
      actor: { id: "bot-1", type: "bot" },
      decision: {
        decisionId: "dec-2",
        groupId: "group-1",
        title: "Proposal",
        options: [],
        status: "draft",
        type: "proposal",
        createdAt: 1,
        updatedAt: 1,
      },
      groupProfile: {
        groupId: "group-1",
        groupCode: "G-1",
        displayName: "Group 1",
        finalDecisionPolicy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(proposalResult.allowed).toBe(true);
  });

  it("validates projection priority and staleness explicitly", () => {
    const projection = createRuntimeProjection({
      groupId: "group-1",
      sessionId: "session-1",
      actorId: "member-1",
      timestamp: Date.now() - 120_000,
      sessionMetadata: {},
      storageSnapshots: {},
    });

    expect(
      validateProjectionPriority(projection, {
        phase: projection.phase,
        currentTask: projection.currentTask,
        currentDeliverable: projection.currentDeliverable,
        currentReview: projection.currentReview,
        needsReview: projection.needsReview,
        reviewDispositioned: projection.reviewDispositioned,
      }),
    ).toBe(true);
    expect(isProjectionStale(projection, 1_000)).toBe(true);
  });

  it("builds object summaries and injects task-scoped memories", () => {
    const objectSummaries = buildObjectSummary({
      tasks: [
        {
          taskId: "task-1",
          groupId: "group-1",
          title: "Important task",
          status: "in_progress",
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
      decisions: [
        {
          decisionId: "dec-1",
          groupId: "group-1",
          title: "Archived decision",
          options: [],
          status: "superseded",
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    expect(objectSummaries[0]?.type).toBe("task");

    const taskMemories = injectTaskMemory("task-1", [
      {
        memoryId: "memory-1",
        groupId: "group-1",
        type: "consensus",
        title: "Task memory",
        content: "Bound to task",
        source: "task",
        sourceId: "task-1",
        importance: "high",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      {
        memoryId: "memory-2",
        groupId: "group-1",
        type: "constraint",
        title: "Other memory",
        content: "Not bound to task",
        source: "discussion",
        importance: "medium",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]);
    expect(taskMemories).toHaveLength(1);
    expect(taskMemories[0]?.id).toBe("memory-1");
  });

  it("allows completed review chains and rejects invalid runtime proposal contexts", () => {
    const deliverableResult = canPublishDeliverable({
      deliverableId: "del-1",
      reviews: [
        {
          reviewId: "review-1",
          groupId: "group-1",
          deliverableId: "del-1",
          reviewerMemberId: "member-1",
          status: "resolved",
          requestedAtMs: 1,
          createdAtMs: 1,
          updatedAtMs: 1,
        },
      ],
    });
    expect(deliverableResult.allowed).toBe(true);

    const proposalResult = canRuntimeNodePublishProposal({
      actor: { id: "human-1", type: "human" },
      decision: {
        decisionId: "dec-3",
        groupId: "group-1",
        title: "Proposal",
        options: [],
        status: "draft",
        type: "proposal",
        createdAt: 1,
        updatedAt: 1,
      },
      groupProfile: {
        groupId: "group-1",
        groupCode: "G-1",
        displayName: "Group 1",
        finalDecisionPolicy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    });
    expect(proposalResult.allowed).toBe(false);
    expect(proposalResult.reason).toBe("not_runtime_node");
  });

  it("composes personal, group, and participation capabilities through policy filters", async () => {
    const composer = new DefaultCapabilityComposer();

    const capabilitySet = await composer.composeCapabilities({
      botId: "bot-1",
      groupId: "group-1",
      personalCapabilities: ["draft", "review"],
      groupCapabilities: ["review", "summarize"],
      participationOverlay: ["delegate"],
      policyFilters: ["allow:review", "allow:delegate", "!draft"],
    });

    expect(capabilitySet.personal).toEqual(["draft", "review"]);
    expect(capabilitySet.group).toEqual(["review", "summarize"]);
    expect(capabilitySet.participation).toEqual(["delegate"]);
    expect(capabilitySet.final).toEqual(["review", "delegate"]);
    expect(composer.isCapabilityAllowed("review", capabilitySet)).toBe(true);
    expect(composer.isCapabilityAllowed("draft", capabilitySet)).toBe(false);
  });

  it("checks learning eligibility from capsule state and policy", async () => {
    const checker = new DefaultLearningEligibilityChecker({
      loadCapsule: vi.fn(
        async (capsuleId: string): Promise<GroupMemoryCapsule | null> =>
          capsuleId === "capsule-1"
            ? {
                capsuleId,
                groupId: "group-1",
                status: "approved",
                sensitivity: "internal",
                reusability: "reusable",
              }
            : {
                capsuleId,
                groupId: "group-1",
                status: "candidate",
              },
      ),
    });

    await expect(checker.isCapsuleApproved("capsule-1")).resolves.toBe(true);
    await expect(checker.isCapsuleApproved("capsule-2")).resolves.toBe(false);

    await expect(
      checker.checkEligibility({
        botId: "bot-1",
        groupId: "group-1",
        capsuleId: "capsule-1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        eligible: true,
        reason: "eligible",
      }),
    );
  });

  it("derives participation overlays from stored profiles and active learning assets", async () => {
    const resolver = new DefaultParticipationOverlayResolver({
      resolveParticipation: vi.fn().mockResolvedValue({
        participationId: "group-1::bot-1",
        groupId: "group-1",
        botId: "bot-1",
        governanceRole: "member",
        status: "active",
        joinedAtMs: 1,
        updatedAtMs: 1,
      }),
      loadOverlayProfile: vi.fn().mockResolvedValue({
        participationId: "group-1::bot-1",
        groupId: "group-1",
        botId: "bot-1",
        enabledSkills: ["review"],
        blockedSkills: ["search"],
        systemInstructions: ["Act as a release reviewer."],
        confidentialityTier: "restricted",
        expiresAtMs: Date.now() + 60_000,
        updatedAtMs: 1,
      }),
      listLearningAssets: vi.fn().mockResolvedValue([
        {
          assetId: "asset-1",
          botId: "bot-1",
          sourceGroupId: "group-1",
          sourceCapsuleId: "capsule-1",
          status: "active",
          abstractedContent: { capabilities: ["summarize", "review"] },
          metadata: { skills: ["coach"] },
        },
        {
          assetId: "asset-2",
          botId: "bot-1",
          sourceGroupId: "group-1",
          sourceCapsuleId: "capsule-2",
          status: "revoked",
          abstractedContent: { capabilities: ["ignore-me"] },
        },
      ]),
    });

    const overlay = await resolver.resolveOverlay("bot-1", "group-1");
    expect(overlay).toEqual(
      expect.objectContaining({
        participationId: "group-1::bot-1",
        overlayCapabilities: ["review", "summarize", "coach"],
        policyFilters: ["!search"],
        systemInstructions: ["Act as a release reviewer."],
        confidentialityTier: "restricted",
      }),
    );
    expect(overlay && resolver.isOverlayActive(overlay)).toBe(true);
  });

  it("builds effective capability context from personal, group, and participation overlays", async () => {
    const context = await buildCapabilityContext({
      botId: "bot-1",
      groupId: "group-1",
      personalCapabilities: ["draft", "review", "search"],
      groupProfile: {
        groupId: "group-1",
        enabledSkills: ["summarize", "review"],
        blockedSkills: ["search"],
        systemInstructions: ["Follow the group review rubric."],
        confidentialityTier: "restricted",
        updatedAtMs: 1,
      },
      overlay: {
        participationId: "group-1::bot-1",
        botId: "bot-1",
        groupId: "group-1",
        overlayCapabilities: ["diff-analysis"],
        policyFilters: ["allow:draft", "allow:review", "allow:summarize", "allow:diff-analysis"],
        systemInstructions: ["Act as the release reviewer for this group."],
        confidentialityTier: "restricted",
      },
    });

    expect(context.capabilitySet.personal).toEqual(["draft", "review", "search"]);
    expect(context.capabilitySet.group).toEqual(["summarize", "review"]);
    expect(context.capabilitySet.participation).toEqual(["diff-analysis"]);
    expect(context.capabilitySet.final).toEqual(["draft", "review", "summarize", "diff-analysis"]);
    expect(context.policyFilters).toEqual(
      expect.arrayContaining(["!search", "allow:draft", "allow:review"]),
    );
    expect(context.systemInstructions).toEqual([
      "Follow the group review rubric.",
      "Act as the release reviewer for this group.",
    ]);
    expect(context.confidentialityTier).toBe("restricted");
  });

  it("projects capsules into promotable learning assets with approval-aware gating", async () => {
    const savedProjections: unknown[] = [];
    const savedAssets: unknown[] = [];
    const service = new DefaultLearningPromotionService({
      createProjectionId: () => "projection-1",
      createAssetId: () => "asset-1",
      saveProjection: async (projection) => {
        savedProjections.push(projection);
      },
      saveLearningAsset: async (asset) => {
        savedAssets.push(asset);
      },
    });

    const restrictedProjection = await service.projectCapsule({
      groupId: "group-1",
      capsule: {
        capsuleId: "capsule-1",
        groupId: "group-1",
        capsuleType: "pattern",
        status: "approved",
        sensitivity: "restricted",
        reusability: "reusable",
      },
      targetBotId: "bot-1",
      actor: { actorId: "owner-1", actorKind: "human" },
      sourceParticipationId: "group-1::bot-1",
    });

    expect(restrictedProjection).toEqual({
      allowed: true,
      reason: "pending",
      projection: expect.objectContaining({
        projectionId: "projection-1",
        approvalStatus: "pending",
        requiresApproval: true,
        projectionType: "personal_abstracted",
        transformationRule: "anonymized",
      }),
    });
    expect(savedProjections).toHaveLength(1);

    const exportableProjection = await service.projectCapsule({
      groupId: "group-1",
      capsule: {
        capsuleId: "capsule-2",
        groupId: "group-1",
        capsuleType: "decision_rule",
        summary: "Always require human approval for production rollouts.",
        status: "approved",
        sensitivity: "internal",
        reusability: "exportable",
      },
      targetBotId: "bot-1",
      actor: { actorId: "owner-1", actorKind: "human" },
      sourceParticipationId: "group-1::bot-1",
    });

    const promotion = await service.promoteProjection({
      projection: exportableProjection.projection!,
      capsule: {
        capsuleId: "capsule-2",
        groupId: "group-1",
        capsuleType: "decision_rule",
        summary: "Always require human approval for production rollouts.",
        status: "approved",
        sensitivity: "internal",
        reusability: "exportable",
      },
      actor: { actorId: "owner-1", actorKind: "human" },
    });

    expect(exportableProjection.projection?.approvalStatus).toBe("auto_approved");
    expect(promotion).toEqual({
      promoted: true,
      reason: "promoted",
      asset: expect.objectContaining({
        assetId: "asset-1",
        botId: "bot-1",
        applicabilityScope: "tenant",
        assetType: "decision_rule",
        transformationRule: "policy_only",
      }),
    });
    expect(savedAssets).toHaveLength(1);
  });
});
