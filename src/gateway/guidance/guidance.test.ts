import { describe, expect, it } from "vitest";
import { resolveNextGrowthAction, type GrowthFunnelFlags } from "../agent-growth/next-action.js";
import {
  buildDegradedGuidanceSnapshot,
  buildGuidanceSnapshot,
  buildRobotGuidanceSnapshot,
  buildRobotGuidanceSnapshotFromGrowth,
  buildTeamGuidanceSnapshot,
  buildUserGuidanceSnapshotFromDaibai,
  isValidGuidanceSnapshot,
  mapGrowthGapsToBlockers,
  resolvePrimaryGuidance,
  validateGuidanceSnapshot,
} from "./index.js";

const birthFunnel: GrowthFunnelFlags = {
  hasSessionOpened: true,
  hasIdentityCompleted: false,
  hasFirstSkillInstalled: false,
  hasFirstMissionSent: false,
  hasFirstMissionSuccess: false,
  preludeDismissed: false,
};

describe("guidance orchestrator P0.1 contract", () => {
  it("accepts well-formed snapshots for all three scopes", () => {
    const robot = buildRobotGuidanceSnapshot({
      agentId: "bot-skill",
      lifecycleState: "birth",
      funnel: birthFunnel,
      capabilityGaps: [],
      tenantId: "001",
      userId: "u1",
      nowMs: 1,
    });
    const user = buildUserGuidanceSnapshotFromDaibai({
      userId: "u1",
      tenantId: "001",
      signal: { needsOnboardingGuide: true },
      nowMs: 2,
    });
    const team = buildTeamGuidanceSnapshot({
      spaceId: "space:alpha",
      tenantId: "001",
      userId: "u1",
      signal: { missionStale: true },
      nowMs: 3,
    });

    expect(robot.scope).toBe("robot");
    expect(user.scope).toBe("user");
    expect(team.scope).toBe("team");
    expect(isValidGuidanceSnapshot(robot)).toBe(true);
    expect(isValidGuidanceSnapshot(user)).toBe(true);
    expect(isValidGuidanceSnapshot(team)).toBe(true);
    expect(robot).toEqual(
      expect.objectContaining({
        tenantId: "001",
        userId: "u1",
        entityId: "bot-skill",
        generatedAt: 1,
        nextAction: expect.objectContaining({ risk: expect.any(String) }),
      }),
    );
  });

  it("rejects negative shapes (missing isolation keys, bad scope, missing nextAction fields)", () => {
    const base = buildDegradedGuidanceSnapshot({
      scope: "user",
      entityId: "u1",
      reason: "no_data",
      nowMs: 1,
    });
    expect(validateGuidanceSnapshot(base)).toEqual([]);

    const missingEntity = { ...base, entityId: "" };
    expect(validateGuidanceSnapshot(missingEntity).some((i) => i.path === "entityId")).toBe(true);

    const badScope = { ...base, scope: "fleet" };
    expect(validateGuidanceSnapshot(badScope).some((i) => i.path === "scope")).toBe(true);

    const { tenantId: _omit, ...withoutTenant } = base;
    expect(validateGuidanceSnapshot(withoutTenant).some((i) => i.path === "tenantId")).toBe(true);

    const badAction = {
      ...base,
      nextAction: { kind: "x", label: "y", reason: "z", canSkip: true },
    };
    expect(validateGuidanceSnapshot(badAction).some((i) => i.path === "nextAction.risk")).toBe(
      true,
    );

    expect(isValidGuidanceSnapshot(null)).toBe(false);
    expect(isValidGuidanceSnapshot({})).toBe(false);
  });
});

describe("guidance orchestrator P0.2 growth adapter", () => {
  it("uses resolveNextGrowthAction as the only robot decision source", () => {
    const gaps = [
      {
        key: "web_search",
        label: "Web Search",
        kind: "skill" as const,
        status: "missing" as const,
      },
      {
        key: "approval_oauth",
        label: "Approval OAuth",
        kind: "oauth" as const,
        status: "pending_integration" as const,
      },
    ];
    const expected = resolveNextGrowthAction({
      lifecycleState: "birth",
      funnel: birthFunnel,
      gaps,
    });
    const snapshot = buildRobotGuidanceSnapshot({
      agentId: "bot-skill",
      lifecycleState: "birth",
      funnel: birthFunnel,
      capabilityGaps: gaps,
      tenantId: "001",
      userId: "user-1",
      nowMs: 1000,
    });

    expect(snapshot.scope).toBe("robot");
    expect(snapshot.source).toBe("growth");
    expect(snapshot.nextAction.kind).toBe(expected.kind);
    expect(snapshot.nextAction.reason).toBe(expected.reason);
    expect(snapshot.nextAction.kind).toBe("start_work");
    expect(snapshot.blockers.find((b) => b.code === "web_search")?.actionable).toBe(true);
    expect(snapshot.blockers.find((b) => b.code === "approval_oauth")?.actionable).toBe(false);
  });

  it("maps install_capabilities when first mission already sent and skills missing", () => {
    const funnel: GrowthFunnelFlags = {
      ...birthFunnel,
      hasFirstMissionSent: true,
    };
    const gaps = [
      {
        key: "contract_review",
        label: "Contract Review",
        kind: "skill" as const,
        status: "missing" as const,
      },
    ];
    const expected = resolveNextGrowthAction({
      lifecycleState: "growing",
      funnel,
      gaps,
    });
    const snapshot = buildRobotGuidanceSnapshot({
      agentId: "legal-bot",
      lifecycleState: "growing",
      funnel,
      capabilityGaps: gaps,
      nowMs: 5,
    });
    expect(expected.kind).toBe("install_capabilities");
    expect(snapshot.nextAction.kind).toBe("install_capabilities");
    expect(snapshot.nextAction.target?.recommendedSkillKeys).toEqual(["contract_review"]);
  });

  it("marks oauth/knowledge gaps non-actionable so they cannot hard-block tasks", () => {
    const blockers = mapGrowthGapsToBlockers([
      {
        key: "kb",
        label: "KB",
        kind: "knowledge_binding",
        status: "missing",
      },
    ]);
    expect(blockers[0]?.actionable).toBe(false);
  });
});

describe("guidance orchestrator P0.3 daibai + resolver", () => {
  it("maps daibai onboarding signal into a user-scope snapshot", () => {
    const snapshot = buildUserGuidanceSnapshotFromDaibai({
      userId: "alice",
      tenantId: "001",
      signal: { needsOnboardingGuide: true },
      nowMs: 3,
    });
    expect(snapshot.scope).toBe("user");
    expect(snapshot.source).toBe("daibai");
    expect(snapshot.nextAction.kind).toBe("start_steward_guide");
    expect(isValidGuidanceSnapshot(snapshot)).toBe(true);
  });

  it("resolvePrimaryGuidance returns one active CTA and prefers robot over user over team", () => {
    const robot = buildRobotGuidanceSnapshot({
      agentId: "bot-skill",
      lifecycleState: "birth",
      funnel: birthFunnel,
      capabilityGaps: [],
      nowMs: 10,
    });
    const user = buildUserGuidanceSnapshotFromDaibai({
      userId: "alice",
      signal: { needsOnboardingGuide: true },
      nowMs: 20,
    });
    const team = buildTeamGuidanceSnapshot({
      spaceId: "space:alpha",
      signal: { missionStale: true },
      nowMs: 30,
    });
    const primary = resolvePrimaryGuidance([team, user, robot]);
    expect(primary.entityId).toBe("bot-skill");
    expect(primary.nextAction.kind).toBe("start_work");
    expect(buildGuidanceSnapshot({ candidates: [team, user, robot] }).entityId).toBe(
      primary.entityId,
    );
  });

  it("falls back to no_data when candidates are empty and keeps degraded when nothing is actionable", () => {
    expect(resolvePrimaryGuidance([]).degrade).toBe("no_data");
    const degraded = buildDegradedGuidanceSnapshot({
      scope: "user",
      entityId: "alice",
      reason: "analysis_failed",
      nowMs: 1,
    });
    const idleUser = buildUserGuidanceSnapshotFromDaibai({
      userId: "alice",
      signal: {},
      nowMs: 2,
    });
    expect(idleUser.nextAction.kind).toBe("none");
    const primary = resolvePrimaryGuidance([degraded, idleUser]);
    expect(primary.degrade === "analysis_failed" || primary.nextAction.kind === "none").toBe(true);
  });

  it("buildRobotGuidanceSnapshotFromGrowth still maps precomputed recommendations", () => {
    const recommendation = resolveNextGrowthAction({
      lifecycleState: "birth",
      funnel: birthFunnel,
      gaps: [],
    });
    const snapshot = buildRobotGuidanceSnapshotFromGrowth({
      agentId: "bot-a",
      lifecycleState: "birth",
      recommendation,
      nowMs: 9,
    });
    expect(snapshot.nextAction.kind).toBe(recommendation.kind);
  });
});
