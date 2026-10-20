import { nothing } from "lit";
import { describe, expect, it, vi } from "vitest";
import type { GrowthStatusView } from "../../controllers/agent-growth.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  dismissGrowthPrelude,
  openGroupProfileView,
  renderWorkbenchGrowthThreadPrelude,
  shouldShowGrowthPrelude,
  withPreludeDismissed,
  type GrowthPreludeWireHost,
} from "./growth-prelude-wire.ts";

function growingView(partial: Partial<GrowthStatusView> = {}): GrowthStatusView {
  return {
    lifecycleState: "growing",
    dimensions: { identity: 50, capability: 50, knowledge: 0, habits: 0 },
    activationScore: 25,
    operationalScore: null,
    capabilityReadiness: false,
    isActivated: false,
    templateId: null,
    ...partial,
  };
}

function growthPreludeHost(
  partial: Partial<GrowthPreludeWireHost> & Pick<GrowthPreludeWireHost, "client">,
): GrowthPreludeWireHost {
  return {
    connected: true,
    sessionKey: "agent:helper:main",
    agentsList: null,
    collaborationSpacesResult: null,
    workbenchTeamSelectedKey: "agent:helper:main",
    workbenchActiveGrowthStatus: growingView(),
    chatMessage: "",
    workbenchPrimaryModule: "assistant",
    workbenchRobotWorkbenchTab: "overview",
    workbenchGroupProfileView: "chat",
    requestUpdate: vi.fn(),
    ...partial,
  };
}

describe("shouldShowGrowthPrelude", () => {
  it("shows for birth/growing when not dismissed", () => {
    expect(shouldShowGrowthPrelude(growingView({ lifecycleState: "birth" }))).toBe(true);
    expect(shouldShowGrowthPrelude(growingView())).toBe(true);
  });

  it("hides when dismissed, activated, or missing", () => {
    expect(shouldShowGrowthPrelude(null)).toBe(false);
    expect(shouldShowGrowthPrelude(growingView({ preludeDismissedAtMs: 1 }))).toBe(false);
    expect(shouldShowGrowthPrelude(growingView({ lifecycleState: "activated" }))).toBe(false);
    expect(shouldShowGrowthPrelude(growingView({ lifecycleState: "mission_ready" }))).toBe(false);
    expect(shouldShowGrowthPrelude(growingView({ lifecycleState: "evolution" }))).toBe(false);
  });
});

describe("renderWorkbenchGrowthThreadPrelude", () => {
  it("does not mount evolution growth report card in the conversation thread", () => {
    const host = growthPreludeHost({
      client: { request: vi.fn() } as unknown as GatewayBrowserClient,
      workbenchActiveGrowthStatus: growingView({
        lifecycleState: "evolution",
        growthReport: {
          periodDays: 7,
          generatedAtMs: 1,
          tasksCompleted: 1,
          hoursSavedEstimate: null,
          learningMaterialsCount: 0,
          toolInvocations: 2,
          collaborationMemberCount: null,
          taskSuccessRate: null,
          toolSuccessRate: null,
          humanTakeoverRate: null,
          businessImpact: [],
          topInsights: [],
          suggestedWorkflows: [],
        },
      }),
    });
    expect(renderWorkbenchGrowthThreadPrelude(host)).toBe(nothing);
  });
});

describe("openGroupProfileView", () => {
  it("routes assign roles through onGroupProfileViewChange when wired", () => {
    const onGroupProfileViewChange = vi.fn();
    const host = growthPreludeHost({
      client: { request: vi.fn() } as unknown as GatewayBrowserClient,
      sessionKey: "space:grp-marketing",
      workbenchTeamSelectedKey: "space:grp-marketing",
      onGroupProfileViewChange,
    });
    openGroupProfileView(host, "members");
    expect(onGroupProfileViewChange).toHaveBeenCalledWith("members");
    expect(host.workbenchPrimaryModule).toBe("collaboration");
  });
});

describe("dismissGrowthPrelude", () => {
  it("optimistically sets preludeDismissedAtMs on host", async () => {
    const request = vi.fn(async () => ({ growthStatus: { lifecycleState: "growing" } }));
    const host = growthPreludeHost({
      client: { request } as unknown as GatewayBrowserClient,
    });
    await dismissGrowthPrelude(host);
    expect(host.workbenchActiveGrowthStatus?.preludeDismissedAtMs).toBeTypeOf("number");
    expect(request).toHaveBeenCalledWith(
      "agents.record-growth-milestone",
      expect.objectContaining({ key: "preludeDismissedAtMs" }),
    );
  });
});

describe("withPreludeDismissed", () => {
  it("returns a copy with dismiss timestamp", () => {
    const next = withPreludeDismissed(growingView(), 99);
    expect(next.preludeDismissedAtMs).toBe(99);
    expect(growingView().preludeDismissedAtMs).toBeUndefined();
  });
});
