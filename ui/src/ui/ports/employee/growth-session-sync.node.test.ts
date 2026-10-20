import { describe, expect, it, vi } from "vitest";
import type { GrowthStatusView } from "../../controllers/agent-growth.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import {
  resolveGrowthEntityFromSessionKey,
  shouldAutoPreferIdentityOnboarding,
  syncGrowthOnWorkbenchSessionOpen,
  type GrowthSessionSyncHost,
} from "./growth-session-sync.ts";

type GrowthRpcPayload = {
  growthStatus: {
    lifecycleState: string;
    dimensions: { identity: number; capability: number; knowledge: number; habits: number };
    activationScore: number;
    operationalScore: null;
    capabilityReadiness: boolean;
    isActivated: boolean;
    templateId: string;
  };
};

describe("growth-session-sync", () => {
  it("resolves robot main sessions", () => {
    expect(resolveGrowthEntityFromSessionKey("agent:market-helper:main")).toEqual({
      kind: "robot",
      entityId: "market-helper",
    });
  });

  it("resolves space sessions as groups", () => {
    expect(resolveGrowthEntityFromSessionKey("space:grp-alpha")).toEqual({
      kind: "group",
      entityId: "grp-alpha",
    });
  });

  it("resolves agent-scoped space sessions as groups", () => {
    expect(resolveGrowthEntityFromSessionKey("agent:helper:space:grp-alpha")).toEqual({
      kind: "group",
      entityId: "grp-alpha",
    });
  });

  it("skips builtin steward sessions", () => {
    expect(resolveGrowthEntityFromSessionKey("agent:main:main")).toBeNull();
  });

  it("records milestone and recomputes growth on session open", async () => {
    const request = vi.fn(async (method: string): Promise<GrowthRpcPayload | null> => {
      if (method === "agents.record-growth-milestone") {
        return {
          growthStatus: {
            lifecycleState: "growing",
            dimensions: { identity: 10, capability: 0, knowledge: 0, habits: 0 },
            activationScore: 12,
            operationalScore: null,
            capabilityReadiness: false,
            isActivated: false,
            templateId: "generic_worker",
          },
        };
      }
      if (method === "agents.recompute-growth") {
        return {
          growthStatus: {
            lifecycleState: "growing",
            dimensions: { identity: 20, capability: 0, knowledge: 0, habits: 0 },
            activationScore: 24,
            operationalScore: null,
            capabilityReadiness: false,
            isActivated: false,
            templateId: "generic_worker",
          },
        };
      }
      return null;
    });
    const state: GrowthSessionSyncHost = {
      sessionKey: "agent:market-helper:main",
      client: { request } as unknown as GatewayBrowserClient,
      connected: true,
      workbenchActiveGrowthStatus: null,
      requestUpdate: vi.fn(),
    };
    await syncGrowthOnWorkbenchSessionOpen(state, "agent:market-helper:main");
    expect(request).toHaveBeenCalledWith(
      "agents.record-growth-milestone",
      expect.objectContaining({ agentId: "market-helper", key: "sessionOpenedAtMs" }),
    );
    expect(request).toHaveBeenCalledWith(
      "agents.recompute-growth",
      expect.objectContaining({ agentId: "market-helper" }),
    );
    expect(state.workbenchActiveGrowthStatus?.activationScore).toBe(24);
    expect(state.workbenchGrowthPreferCultivate).toBe(true);
    expect(request).toHaveBeenCalledWith(
      "agents.recompute-growth",
      expect.objectContaining({ agentId: "market-helper", preferCultivate: true }),
    );
    expect(state.requestUpdate).toHaveBeenCalled();
  });

  it("keeps task-first once identity is done or a mission was sent", () => {
    const base = {
      lifecycleState: "growing",
      dimensions: { identity: 0, capability: 0, knowledge: 0, habits: 0 },
      activationScore: 0,
      operationalScore: null,
      capabilityReadiness: false,
      isActivated: false,
      templateId: "generic_worker",
    } satisfies Partial<GrowthStatusView>;
    expect(
      shouldAutoPreferIdentityOnboarding({
        ...base,
        funnel: {
          hasSessionOpened: true,
          hasIdentityCompleted: false,
          hasFirstSkillInstalled: false,
          hasFirstMissionSent: false,
          hasFirstMissionSuccess: false,
          preludeDismissed: false,
        },
      } as GrowthStatusView),
    ).toBe(true);
    expect(
      shouldAutoPreferIdentityOnboarding({
        ...base,
        funnel: {
          hasSessionOpened: true,
          hasIdentityCompleted: true,
          hasFirstSkillInstalled: false,
          hasFirstMissionSent: false,
          hasFirstMissionSuccess: false,
          preludeDismissed: false,
        },
      } as GrowthStatusView),
    ).toBe(false);
    expect(
      shouldAutoPreferIdentityOnboarding({
        ...base,
        lifecycleState: "activated",
      } as GrowthStatusView),
    ).toBe(false);
  });
});
