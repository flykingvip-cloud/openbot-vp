import { describe, expect, it } from "vitest";
import {
  calculateOverallScore,
  canAgentPublishProposal,
  canActorPublishFinal,
  canMemberActAsFinalDecider,
  compareGroupTemplates,
  DecisionStateMachine,
  DeliverableStateMachine,
  generateRecommendations,
  InvalidDecisionTransitionError,
  InvalidDeliverableTransitionError,
  InvalidReviewTransitionError,
  InvalidTransitionError,
  resolveFinalDecisionMode,
  requiresHumanFinalDecision,
  ReviewStateMachine,
  TaskStateMachine,
  validateGroupTemplate,
} from "./index.js";

describe("collaboration-core domain behavior", () => {
  it("enforces valid task transitions", () => {
    const machine = new TaskStateMachine();

    expect(machine.transition("draft", "ready")).toBe("ready");
    expect(machine.isTerminalState("completed")).toBe(true);
    expect(() => machine.transition("ready", "completed", "owner-1")).toThrow(
      InvalidTransitionError,
    );
  });

  it("enforces deliverable and review transition rules", () => {
    const deliverableMachine = new DeliverableStateMachine();
    const reviewMachine = new ReviewStateMachine();

    expect(deliverableMachine.transition("approved", "published")).toBe("published");
    expect(() => deliverableMachine.transition("draft", "published")).toThrow(
      InvalidDeliverableTransitionError,
    );

    expect(reviewMachine.transition("submitted", "acknowledged")).toBe("acknowledged");
    expect(() => reviewMachine.transition("requested", "resolved")).toThrow(
      InvalidReviewTransitionError,
    );
  });

  it("enforces decision terminal rules", () => {
    const machine = new DecisionStateMachine();

    expect(machine.transition("draft", "finalized")).toBe("finalized");
    expect(machine.isTerminalState("superseded")).toBe(true);
    expect(() => machine.transition("finalized", "draft")).toThrow(InvalidDecisionTransitionError);
  });

  it("applies final decision authority rules", () => {
    expect(
      canActorPublishFinal({
        actor: { subjectKind: "runtime_node", memberId: "bot-1" },
        policy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
      }),
    ).toBe(true);

    expect(
      canActorPublishFinal({
        actor: { subjectKind: "runtime_node", memberId: "bot-1" },
        policy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: false,
        },
      }),
    ).toBe(false);

    expect(
      requiresHumanFinalDecision({
        decision: {
          decisionId: "dec-1",
          groupId: "group-1",
          title: "Go live",
          options: [],
          status: "draft",
          createdAt: 1,
          updatedAt: 1,
        },
        policy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
      }),
    ).toBe(true);
  });

  it("validates templates and produces health signals", () => {
    const invalidTemplate = validateGroupTemplate({
      templateId: "",
      name: "",
      sourceGroupId: "",
      groupType: "",
      memberRoles: [{ memberType: "human" }],
      createdAt: Date.now(),
    });
    expect(invalidTemplate.valid).toBe(false);
    expect(invalidTemplate.errors).toContain("templateId is required");

    const score = calculateOverallScore({
      collaborationEfficiency: 80,
      deliveryStability: 90,
      botNoiseRatio: 20,
      memoryCompleteness: 70,
    });
    expect(score).toBe(81);

    const recommendations = generateRecommendations({
      groupId: "group-1",
      metrics: {
        collaborationEfficiency: 30,
        deliveryStability: 40,
        botNoiseRatio: 80,
        memoryCompleteness: 20,
      },
    });
    expect(recommendations.map((item) => item.category)).toEqual(
      expect.arrayContaining(["collaboration", "delivery", "noise", "memory"]),
    );
  });

  it("resolves final decision policy and member authority edges", () => {
    expect(
      resolveFinalDecisionMode({
        groupId: "group-1",
        groupCode: "G-1",
        displayName: "Group 1",
        createdAtMs: 1,
        updatedAtMs: 1,
      }),
    ).toEqual({
      mode: "human_required",
      defaultFinalDeciderRole: "owner",
      allowAgentPublishProposal: false,
    });

    expect(
      canMemberActAsFinalDecider({
        member: {
          memberId: "member-1",
          memberKind: "human",
          governanceRole: "admin",
          status: "active",
          updatedAtMs: 1,
        },
        policy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "admin",
          allowAgentPublishProposal: true,
        },
      }),
    ).toBe(true);

    expect(
      canAgentPublishProposal({
        member: {
          memberId: "member-2",
          memberKind: "bot",
          governanceRole: "member",
          status: "active",
          updatedAtMs: 1,
        },
        policy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: true,
        },
      }),
    ).toBe(true);
  });

  it("compares templates and emits stable low-risk health guidance", () => {
    const comparison = compareGroupTemplates({
      template1: {
        templateId: "tpl-1",
        name: "A",
        sourceGroupId: "group-1",
        groupType: "project_delivery",
        collaborationMode: "task_driven",
        finalDecisionPolicy: {
          mode: "human_required",
          defaultFinalDeciderRole: "owner",
          allowAgentPublishProposal: false,
        },
        memberRoles: [{ memberType: "human" }],
        createdAt: 1,
      },
      template2: {
        templateId: "tpl-2",
        name: "B",
        sourceGroupId: "group-2",
        groupType: "research_analysis",
        collaborationMode: "discussion_driven",
        finalDecisionPolicy: {
          mode: "delegated_low_risk",
          defaultFinalDeciderRole: "admin",
          allowAgentPublishProposal: true,
        },
        memberRoles: [{ memberType: "human" }, { memberType: "bot" }],
        createdAt: 2,
      },
    });
    expect(comparison.same).toBe(false);
    expect(comparison.differences).toEqual(
      expect.arrayContaining([
        "groupType: project_delivery vs research_analysis",
        "collaborationMode: task_driven vs discussion_driven",
        "finalDecisionPolicy: different",
        "memberRoles count: 1 vs 2",
      ]),
    );

    const recommendations = generateRecommendations({
      groupId: "group-healthy",
      metrics: {
        collaborationEfficiency: 95,
        deliveryStability: 92,
        botNoiseRatio: 10,
        memoryCompleteness: 88,
      },
    });
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0]?.actionable).toBe(false);
  });
});
