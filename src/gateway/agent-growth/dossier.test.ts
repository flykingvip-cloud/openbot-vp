import { describe, expect, it } from "vitest";
import { buildGrowthDossierProjection, computeDossierCompleteness } from "./dossier.js";
import { createInitialGrowthStatus } from "./factory.js";
import type { NextGrowthAction } from "./next-action.js";
import { attachGrowthReportFromMetrics } from "./operational-growth.js";
import type { OperationalMetrics } from "./operational-metrics-store.js";

const noneRec: NextGrowthAction = {
  kind: "none",
  reason: "growth.recommend.none",
  priority: 100,
  gaps: [],
  canSkip: true,
  target: {},
};

const installRec: NextGrowthAction = {
  kind: "install_capabilities",
  reason: "growth.recommend.install_capabilities",
  priority: 20,
  gaps: [
    {
      key: "market_research",
      label: "市场调研",
      kind: "skill",
      status: "missing",
    },
  ],
  canSkip: true,
  target: { module: "assistant", tab: "skills", recommendedSkillKeys: ["market_research"] },
};

function metrics(tasksTotal: number, tasksSucceeded: number): OperationalMetrics {
  return {
    tasksTotal,
    tasksSucceeded,
    toolsTotal: 4,
    toolsSucceeded: 3,
    humanTakeovers: 0,
    takeoverObservations: 0,
    satisfactionPositive: 0,
    satisfactionNegative: 0,
    updatedAtMs: 1,
  };
}

describe("dossier completeness", () => {
  it("keeps performance at 0 when there is no operational score or report", () => {
    const completeness = computeDossierCompleteness({
      dimensions: { identity: 20, capability: 10, knowledge: 0, habits: 0 },
      funnel: {
        hasSessionOpened: true,
        hasIdentityCompleted: false,
        hasFirstSkillInstalled: false,
        hasFirstMissionSent: false,
        hasFirstMissionSuccess: false,
        preludeDismissed: false,
      },
      capabilityGaps: [],
      operationalScore: null,
      recommendation: noneRec,
      growthReport: null,
    });
    expect(completeness.performance).toBe(0);
    expect(completeness.identity).toBe(20);
  });

  it("surfaces operationalScore in performance zone", () => {
    const completeness = computeDossierCompleteness({
      dimensions: { identity: 80, capability: 70, knowledge: 0, habits: 40 },
      funnel: {
        hasSessionOpened: true,
        hasIdentityCompleted: true,
        hasFirstSkillInstalled: true,
        hasFirstMissionSent: true,
        hasFirstMissionSuccess: true,
        preludeDismissed: false,
      },
      capabilityGaps: [],
      operationalScore: 72,
      recommendation: noneRec,
      growthReport: null,
    });
    expect(completeness.performance).toBe(72);
    expect(completeness.identity).toBeGreaterThanOrEqual(80);
  });
});

describe("attachGrowthReportFromMetrics", () => {
  it("does not invent a report without task metrics", () => {
    const status = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    const next = attachGrowthReportFromMetrics(status, metrics(0, 0), 2);
    expect(next.growthReport).toBeUndefined();
    expect(next.operationalScore).toBeNull();
  });

  it("persists growthReport when tasks exist", () => {
    const status = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    status.isActivated = true;
    status.activatedAtMs = 1;
    const next = attachGrowthReportFromMetrics(status, metrics(10, 8), 3);
    expect(next.growthReport?.tasksCompleted).toBe(8);
    expect(next.growthReport?.toolInvocations).toBe(4);
    expect(next.lifecycleState).toBe("evolution");
  });
});

describe("buildGrowthDossierProjection", () => {
  it("includes recommendation and gaps for the suggestion zone", () => {
    const status = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    status.dimensions.identity = 40;
    status.dimensions.capability = 20;
    const dossier = buildGrowthDossierProjection({
      growthStatus: status,
      capabilityGaps: installRec.gaps,
      recommendation: installRec,
    });
    expect(dossier.recommendation.kind).toBe("install_capabilities");
    expect(dossier.capabilityGaps).toHaveLength(1);
    expect(dossier.completeness.suggestion).toBe(50);
    expect(dossier.operationalScore).toBeNull();
  });
});
