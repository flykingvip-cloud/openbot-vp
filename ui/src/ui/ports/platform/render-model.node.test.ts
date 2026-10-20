import { afterEach, describe, expect, it } from "vitest";
import { approveProposal } from "../../capability/capability-governance/facade.ts";
import type { CapabilityGovernanceSnapshot } from "../../capability/capability-governance/types.ts";
import {
  __resetCapabilityGovernanceViewStateForTest,
  getOrCreateCapabilityGovernanceViewState,
} from "./capability-governance-state.ts";
import { buildPlatformPortRenderModel } from "./render-model.ts";

function createPersistedSnapshot(): CapabilityGovernanceSnapshot {
  return {
    proposals: [
      {
        proposalId: "proposal:github-url:anthropics/skills:skills/skill-creator@0.0.0",
        submittedAt: "2026-05-21T10:00:00.000Z",
        submittedBy: "github-url",
        status: "proposed",
        manifest: {
          id: "urn:openclaw:skill:skill-creator@0.0.0",
          kind: "skill",
          version: "0.0.0",
          skillKey: "skill-creator",
          name: "Skill Creator",
          description: "Imported from anthropics/skills",
          source: {
            kind: "github",
            origin: "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
            trustTier: "external",
          },
          interface: { inputs: [], outputs: [] },
          contracts: {
            sideEffects: ["read_only"],
            idempotent: true,
            requiresConfirmation: false,
          },
          behavior: { costModel: "free" },
          requirements: { bins: [], env: [], configPaths: [], operatingSystems: [] },
          install: [],
          risk: {
            level: "medium",
            network: true,
            filesystem: false,
            subprocess: false,
            secrets: false,
          },
        },
        findings: [],
      },
    ],
    registry: [],
    metrics: [],
  };
}

describe("platform render model governance snapshot", () => {
  afterEach(() => {
    __resetCapabilityGovernanceViewStateForTest();
  });

  it("shows persisted discovery proposals in the capability discovery pool", () => {
    const model = buildPlatformPortRenderModel({
      state: {
        tab: "platformCapabilities",
        basePath: "/platform",
        connected: true,
        settings: {},
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        channelsSnapshot: null,
        presenceEntries: [],
        agentsList: null,
        sessionsResult: null,
        usageResult: null,
        updateAvailable: null,
        cronStatus: null,
        skillsLoading: false,
        skillsReport: null,
        capabilityGovernanceSnapshot: createPersistedSnapshot(),
        skillsError: null,
        skillsFilter: "",
        skillEdits: {},
        skillMessages: {},
        skillsBusyKey: null,
        runtimeAgents: [],
        runtimeBindings: [],
        runtimeTelemetry: [],
        runtimeGovernanceIssues: [],
        runtimeKpi: null,
      } as never,
      actions: {
        dashboard: {},
        tenants: {},
        capabilities: {},
        models: {},
        platformAgents: {},
        advanced: {},
        systemSettings: {},
        skills: {},
        instances: {},
      } as never,
      configValue: {},
    });

    expect(model.pageViewModels.capabilities.discoveredItems).toHaveLength(1);
    expect(model.pageViewModels.capabilities.discoveredItems[0]?.title).toBe("Skill Creator");
    expect(model.pageViewModels.capabilities.discoveredCounts.proposed).toBe(1);
  });

  it("drops a proposal from pending review after an optimistic approve", () => {
    const snapshot = createPersistedSnapshot();
    approveProposal(
      getOrCreateCapabilityGovernanceViewState(),
      snapshot.proposals[0].proposalId,
      "platform-ui",
    );

    const model = buildPlatformPortRenderModel({
      state: {
        tab: "platformCapabilities",
        basePath: "/platform",
        connected: true,
        settings: {},
        hello: null,
        platformAuthState: null,
        bootstrapAuthSession: null,
        channelsSnapshot: null,
        presenceEntries: [],
        agentsList: null,
        sessionsResult: null,
        usageResult: null,
        updateAvailable: null,
        cronStatus: null,
        skillsLoading: false,
        skillsReport: null,
        capabilityGovernanceSnapshot: snapshot,
        skillsError: null,
        skillsFilter: "",
        skillEdits: {},
        skillMessages: {},
        skillsBusyKey: null,
        runtimeAgents: [],
        runtimeBindings: [],
        runtimeTelemetry: [],
        runtimeGovernanceIssues: [],
        runtimeKpi: null,
      } as never,
      actions: {
        dashboard: {},
        tenants: {},
        capabilities: {},
        models: {},
        platformAgents: {},
        advanced: {},
        systemSettings: {},
        skills: {},
        instances: {},
      } as never,
      configValue: {},
    });

    expect(snapshot.proposals[0]?.status).toBe("proposed");
    expect(model.pageViewModels.capabilities.discoveredItems).toHaveLength(0);
    expect(model.pageViewModels.capabilities.discoveredCounts.proposed).toBe(0);
  });
});
