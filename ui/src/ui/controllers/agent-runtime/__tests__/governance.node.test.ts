// @vitest-environment node
// Feature: platform-agent-runtime-center, Task 24/25: Governance controller
import { describe, expect, it, vi } from "vitest";
import type {
  AgentRuntimeGateway,
  AcknowledgeIssueResponse,
  GetGovernanceConfigResponse,
  ListGovernanceIssuesResponse,
  UpdateGovernanceConfigResponse,
} from "../../../capability/agent-runtime/index.ts";
import type {
  GovernanceDetectorConfig,
  RuntimeGovernanceIssue,
} from "../../../capability/runtime-canonical/index.ts";
import {
  acknowledge,
  createInitialGovernanceState,
  loadGovernanceConfig,
  loadIssues,
  resetGovernanceFilters,
  saveGovernanceConfig,
  updateGovernanceFilter,
} from "../governance.ts";

// Reference a mocked gateway method as a plain spy to avoid unbound-method lint.
function spy(gw: AgentRuntimeGateway, key: keyof AgentRuntimeGateway) {
  return (gw as unknown as Record<string, ReturnType<typeof vi.fn>>)[key as string];
}

function makeIssue(overrides: Partial<RuntimeGovernanceIssue> = {}): RuntimeGovernanceIssue {
  return {
    id: "zombie-binding::b-1",
    category: "zombie-binding",
    severity: "low",
    runtimeAgentId: "agent-1",
    bindingId: "b-1",
    description: "binding 长期无调用",
    impact: "占用装载位",
    evidence: { calls7d: 0 },
    suggestedAction: "考虑禁用",
    detectedAt: 1000,
    acknowledgedBy: null,
    acknowledgedAt: null,
    ...overrides,
  };
}

describe("loadIssues", () => {
  it("populates issues from gateway", async () => {
    const gateway = {
      listGovernanceIssues: vi.fn(
        async (): Promise<ListGovernanceIssuesResponse> => ({
          issues: [makeIssue()],
        }),
      ),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialGovernanceState();
    s.gateway = gateway;
    await loadIssues(s);
    expect(s.issues).toHaveLength(1);
    expect(s.error).toBeNull();
  });

  it("preserves issues when gateway throws", async () => {
    const s = createInitialGovernanceState();
    s.gateway = {
      listGovernanceIssues: vi.fn(async () => {
        throw new Error("network");
      }),
    } as unknown as AgentRuntimeGateway;
    s.issues = [makeIssue()];
    await loadIssues(s);
    expect(s.issues.length).toBe(1);
    expect(s.error).toContain("network");
  });
});

describe("filter mutations", () => {
  it("update + reset filters", () => {
    const s = createInitialGovernanceState();
    updateGovernanceFilter(s, "severity", "high");
    expect(s.filters.severity).toBe("high");
    resetGovernanceFilters(s);
    expect(s.filters.severity).toBeNull();
    expect(s.filters.includeAcknowledged).toBe(false);
  });
});

describe("acknowledge", () => {
  it("replaces issue with acknowledged version", async () => {
    const original = makeIssue();
    const acknowledged: RuntimeGovernanceIssue = {
      ...original,
      acknowledgedBy: "ops:peter",
      acknowledgedAt: 99,
    };
    const gateway = {
      acknowledgeIssue: vi.fn(
        async (): Promise<AcknowledgeIssueResponse> => ({ issue: acknowledged }),
      ),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialGovernanceState();
    s.gateway = gateway;
    s.issues = [original];
    await acknowledge(s, original.id, "ops:peter", "noted");
    expect(s.issues[0]?.acknowledgedBy).toBe("ops:peter");
  });
});

describe("loadGovernanceConfig + saveGovernanceConfig", () => {
  it("loads then partially updates config; defaults preserved on partial save", async () => {
    const stored: GovernanceDetectorConfig = {
      zombieBindingDays: 30,
      orphanedAgentDays: 30,
      resourceOvercommitThreshold: 0.9,
    };
    const gateway = {
      getGovernanceConfig: vi.fn(
        async (): Promise<GetGovernanceConfigResponse> => ({ config: stored }),
      ),
      updateGovernanceConfig: vi.fn(
        async ({ config }): Promise<UpdateGovernanceConfigResponse> => ({
          config: { ...stored, ...config },
        }),
      ),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialGovernanceState();
    s.gateway = gateway;
    await loadGovernanceConfig(s);
    expect(s.config?.zombieBindingDays).toBe(30);

    await saveGovernanceConfig(s, { zombieBindingDays: 14 });
    expect(s.config?.zombieBindingDays).toBe(14);
    expect(s.config?.orphanedAgentDays).toBe(30); // 未指定字段保持
    expect(s.configError).toBeNull();
  });

  it("rejects negative thresholds without RPC", async () => {
    const gateway = {
      updateGovernanceConfig: vi.fn(),
    } as unknown as AgentRuntimeGateway;
    const s = createInitialGovernanceState();
    s.gateway = gateway;
    await saveGovernanceConfig(s, { zombieBindingDays: -1 });
    expect(s.configError).toContain("非负");
    expect(spy(gateway, "updateGovernanceConfig")).not.toHaveBeenCalled();
  });
});
