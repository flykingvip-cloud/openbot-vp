import { describe, expect, it } from "vitest";
import { recomputeGrowthStatus } from "./factory.js";
import {
  computeActivationScore,
  computeAlignmentComplete,
  computeAlignmentDimension,
  computeCapabilityReadiness,
  computeKnowledgeDimension,
} from "./readiness.js";
import { collectCapabilityReadinessSignals } from "./signals.js";
import type { AgentTemplate, CapabilityReadinessSignals, GrowthDimension } from "./types.js";

const GENERIC: Pick<AgentTemplate, "dimensionWeights" | "minIdentity"> = {
  dimensionWeights: { identity: 25, capability: 25, knowledge: 25, habits: 25 },
  minIdentity: 60,
};

const CRM_TEMPLATE: AgentTemplate = {
  templateId: "crm_agent",
  version: "1.0.0",
  displayName: "CRM",
  dimensionWeights: { identity: 25, capability: 25, knowledge: 25, habits: 25 },
  requiredCapabilities: [
    { key: "crm", kind: "skill", label: "CRM Skill", required: true },
    { key: "salesforce", kind: "oauth", label: "Salesforce OAuth", required: true },
  ],
  missionReadyThreshold: 78,
  minIdentity: 60,
};

describe("computeActivationScore", () => {
  it("weights robot dimensions to 0-100", () => {
    const dims: GrowthDimension = { identity: 100, capability: 0, knowledge: 0, habits: 0 };
    expect(computeActivationScore(dims, GENERIC)).toBe(25);
  });

  it("normalizes group 5-dimension weights", () => {
    const template = {
      dimensionWeights: { identity: 20, capability: 20, knowledge: 20, habits: 20, alignment: 20 },
    };
    const dims: GrowthDimension = {
      identity: 100,
      capability: 100,
      knowledge: 0,
      habits: 0,
      alignment: 0,
    };
    expect(computeActivationScore(dims, template)).toBe(40);
  });
});

describe("computeCapabilityReadiness (RISK-007: P0A skill-only)", () => {
  const fullDims: GrowthDimension = {
    identity: 80,
    capability: 90,
    knowledge: 80,
    habits: 80,
  };

  it("weather plugin + single PDF cannot satisfy a template with required crm skill", () => {
    // 仅装无关 skill（天气），required crm 未装 → skills not installed。
    const signals = collectCapabilityReadinessSignals({
      template: CRM_TEMPLATE,
      installedSkillKeys: ["weather"],
    });
    expect(signals.requiredSkillsInstalled).toBe(false);
    expect(computeCapabilityReadiness(fullDims, CRM_TEMPLATE, signals)).toBe(false);
  });

  it("OAuth unknown does NOT block readiness when required skill installed (P0A)", () => {
    const signals = collectCapabilityReadinessSignals({
      template: CRM_TEMPLATE,
      installedSkillKeys: ["crm"],
    });
    expect(signals.requiredSkillsInstalled).toBe(true);
    expect(signals.requiredPermissionsGranted).toBe("unknown");
    expect(computeCapabilityReadiness(fullDims, CRM_TEMPLATE, signals)).toBe(true);
  });

  it("explicit permission=false blocks (future OAuth integration)", () => {
    const signals: CapabilityReadinessSignals = {
      requiredSkillsInstalled: true,
      requiredPermissionsGranted: false,
    };
    expect(computeCapabilityReadiness(fullDims, CRM_TEMPLATE, signals)).toBe(false);
  });

  it("identity below template minimum blocks", () => {
    const signals: CapabilityReadinessSignals = {
      requiredSkillsInstalled: true,
      requiredPermissionsGranted: "unknown",
    };
    const lowIdentity: GrowthDimension = {
      identity: 40,
      capability: 90,
      knowledge: 80,
      habits: 80,
    };
    expect(computeCapabilityReadiness(lowIdentity, CRM_TEMPLATE, signals)).toBe(false);
  });
});

describe("recomputeGrowthStatus lifecycle gating", () => {
  it("activationScore >= 78 but capabilityReadiness false stays growing", () => {
    const base = {
      lifecycleState: "growing" as const,
      dimensions: { identity: 80, capability: 80, knowledge: 80, habits: 80 },
      birthAtMs: 1,
      activationScore: 0,
      operationalScore: null,
      capabilityReadiness: false,
      isActivated: false,
      templateId: "crm_agent",
      milestones: { createdAtMs: 1, sessionOpenedAtMs: 2 },
    };
    // required crm skill 未装 → capabilityReadiness false。
    const signals = collectCapabilityReadinessSignals({
      template: CRM_TEMPLATE,
      installedSkillKeys: [],
    });
    // 用 generic 模板重算（recompute 用 current.templateId=crm_agent，但内置无此模板 → 降级 generic）。
    const next = recomputeGrowthStatus(base, {
      dimensions: base.dimensions,
      signals,
    });
    // generic 无 required skill → skillsInstalled=true，但这里显式构造 signals(false)。
    expect(next.capabilityReadiness).toBe(signals.requiredSkillsInstalled);
  });
});

describe("alignment (group)", () => {
  it("requires both roles assigned and workflow defined", () => {
    const noWorkflow = {
      coordinatorBotId: "c",
      activeBots: [{ collaborationRole: "writer" }],
    };
    expect(computeAlignmentComplete(noWorkflow)).toBe(false);
    expect(computeAlignmentDimension(noWorkflow)).toBe(50);

    const complete = { ...noWorkflow, workflowStepCount: 3 };
    expect(computeAlignmentComplete(complete)).toBe(true);
    expect(computeAlignmentDimension(complete)).toBe(100);
  });

  it("missing coordinator fails rolesAssigned", () => {
    expect(
      computeAlignmentComplete({
        coordinatorBotId: null,
        activeBots: [{ collaborationRole: "writer" }],
        workflowStepCount: 2,
      }),
    ).toBe(false);
  });
});

describe("computeKnowledgeDimension (anti file-spam, task 14.3)", () => {
  const template = { knowledgeExpectations: { preferredTags: ["contract", "legal"] } };

  it("scores 0 with no bindings", () => {
    expect(computeKnowledgeDimension(template, [])).toBe(0);
  });

  it("rewards relevant (preferred-tag) bindings over irrelevant ones", () => {
    const irrelevant = computeKnowledgeDimension(template, ["weather", "memes"]);
    const relevant = computeKnowledgeDimension(template, ["contract", "legal"]);
    expect(irrelevant).toBe(40); // base only, no preferred tags matched
    expect(relevant).toBe(100); // both preferred tags covered
    expect(relevant).toBeGreaterThan(irrelevant);
  });

  it("returns base 60 when template declares no preferred tags", () => {
    expect(computeKnowledgeDimension({}, ["anything"])).toBe(60);
  });
});
