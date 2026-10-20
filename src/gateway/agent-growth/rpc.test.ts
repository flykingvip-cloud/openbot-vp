import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInitialGrowthStatus } from "./factory.ts";

const tmpRoot = mkdtempSync(path.join(tmpdir(), "agent-growth-rpc-"));

vi.mock("../../config/config.js", () => ({
  loadConfig: () => ({}),
}));

vi.mock("../../agents/agent-scope.js", () => ({
  listAgentIds: () => ["main", "highcfg"],
  resolveAgentDir: (_cfg: unknown, agentId: string) => path.join(tmpRoot, agentId),
}));

const listRobotSkillAssets = vi.fn((_agentId: string) => [] as Array<{ id: string }>);
const listSkillRecommendations = vi.fn(
  (_agentId: string) =>
    [] as Array<{
      skillId: string;
      name: string;
      summary: string;
    }>,
);
vi.mock("../skill-lifecycle-store.js", () => ({
  listRobotSkillAssets: (agentId: string) => listRobotSkillAssets(agentId),
  listSkillRecommendations: (agentId: string) => listSkillRecommendations(agentId),
}));

vi.mock("../knowledge/agent-knowledge-generator.js", () => ({
  createAgentKnowledgeLlmCaller: () => null,
}));

const groupStatuses = new Map<string, unknown>();
vi.mock("../collaboration-learning/shared.js", () => ({
  readGroupGrowthStatusById: async (groupId: string) => groupStatuses.get(groupId) ?? null,
  updateGroupGrowthStatusById: async (groupId: string, updater: (c: unknown) => unknown) => {
    if (!groupStatuses.has(groupId)) {
      return null;
    }
    const next = updater(groupStatuses.get(groupId));
    groupStatuses.set(groupId, next);
    return next;
  },
}));

vi.mock("../collaboration-learning.js", () => ({
  listGatewayCollaborationSpaces: async () => ({ spaces: [] }),
}));

const { agentGrowthHandlers } = await import("../server-methods/agent-growth.js");

type Captured = { ok: boolean; result: unknown; error: unknown };
function capture(): {
  respond: (ok: boolean, result?: unknown, error?: unknown) => void;
  calls: Captured[];
} {
  const calls: Captured[] = [];
  return {
    calls,
    respond: (ok, result, error) => {
      calls.push({ ok, result, error });
    },
  };
}

async function invoke(
  method: keyof typeof agentGrowthHandlers,
  params: Record<string, unknown>,
  broadcast?: (event: string, payload: unknown) => void,
) {
  const cap = capture();
  await agentGrowthHandlers[method]({
    req: { method, params } as never,
    params,
    respond: cap.respond as never,
    client: undefined as never,
    isWebchatConnect: false as never,
    context: { broadcast: broadcast ?? (() => {}) } as never,
  });
  return cap.calls[0];
}

beforeEach(() => {
  listRobotSkillAssets.mockReturnValue([]);
});

describe("agent-growth RPC", () => {
  it("agents.list-templates returns generic_worker", async () => {
    const res = await invoke("agents.list-templates", {});
    expect(res.ok).toBe(true);
    const templates = (res.result as { templates: Array<{ templateId: string }> }).templates;
    expect(templates.some((t) => t.templateId === "generic_worker")).toBe(true);
  });

  it("agents.get-growth-status initializes birth status for a known agent", async () => {
    const res = await invoke("agents.get-growth-status", { agentId: "main" });
    expect(res.ok).toBe(true);
    const payload = res.result as {
      growthStatus: { lifecycleState: string; isActivated: boolean };
      recommendation: { kind: string };
      funnel: { hasFirstMissionSent: boolean };
      capabilityGaps: unknown[];
    };
    expect(payload.growthStatus.lifecycleState).toBe("birth");
    expect(payload.growthStatus.isActivated).toBe(false);
    expect(payload.recommendation.kind).toBe("start_work");
    expect(payload.funnel.hasFirstMissionSent).toBe(false);
    expect(Array.isArray(payload.capabilityGaps)).toBe(true);
  });

  it("agents.get-growth-status errors for unknown agent", async () => {
    const res = await invoke("agents.get-growth-status", { agentId: "ghost" });
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("agents.recompute-growth reflects installed skills in capability dimension", async () => {
    listRobotSkillAssets.mockReturnValue([{ id: "weather" }, { id: "calendar" }]);
    const res = await invoke("agents.recompute-growth", { agentId: "main" });
    expect(res.ok).toBe(true);
    const status = (res.result as { growthStatus: { dimensions: { capability: number } } })
      .growthStatus;
    // generic_worker has no required skills → 2 installed skills → capability 100.
    expect(status.dimensions.capability).toBe(100);
  });

  it("agents.record-growth-milestone is first-write-wins", async () => {
    await invoke("agents.record-growth-milestone", {
      agentId: "main",
      key: "sessionOpenedAtMs",
      atMs: 111,
    });
    const res = await invoke("agents.record-growth-milestone", {
      agentId: "main",
      key: "sessionOpenedAtMs",
      atMs: 222,
    });
    const status = (res.result as { growthStatus: { milestones: { sessionOpenedAtMs: number } } })
      .growthStatus;
    expect(status.milestones.sessionOpenedAtMs).toBe(111);
  });

  it("agents.record-growth-milestone rejects unknown milestone key", async () => {
    const res = await invoke("agents.record-growth-milestone", { agentId: "main", key: "bogus" });
    expect(res.ok).toBe(false);
  });

  it("collaboration.spaces.get-growth-status errors for unknown space", async () => {
    const res = await invoke("collaboration.spaces.get-growth-status", { groupId: "nope" });
    expect(res.ok).toBe(false);
  });

  it("recording firstMissionSuccessAtMs activates and broadcasts agent_growth.activated", async () => {
    const events: Array<{ event: string; payload: unknown }> = [];
    const broadcast = (event: string, payload: unknown) => events.push({ event, payload });
    const res = await invoke(
      "agents.record-growth-milestone",
      { agentId: "main", key: "firstMissionSuccessAtMs", atMs: 5000 },
      broadcast,
    );
    const status = (
      res.result as { growthStatus: { isActivated: boolean; lifecycleState: string } }
    ).growthStatus;
    expect(status.isActivated).toBe(true);
    expect(status.lifecycleState).toBe("activated");
    expect(events.some((e) => e.event === "agent_growth.activated")).toBe(true);
  });

  it("recompute with low operational signals on a high-config agent emits false_ready_detected", async () => {
    // 预置高维度状态：activationScore 将 >= 90（identity/knowledge/habits=100 + skill 驱动 capability=100）。
    const dir = path.join(tmpRoot, "highcfg");
    mkdirSync(dir, { recursive: true });
    const seeded = createInitialGrowthStatus({ kind: "robot", atMs: 1 });
    seeded.dimensions = { identity: 100, capability: 0, knowledge: 100, habits: 100 };
    writeFileSync(path.join(dir, "growth-status.json"), JSON.stringify(seeded), "utf8");
    listRobotSkillAssets.mockReturnValue([{ id: "a" }, { id: "b" }]);

    const events: Array<{ event: string; payload: unknown }> = [];
    const res = await invoke(
      "agents.recompute-growth",
      { agentId: "highcfg", operationalSignals: { taskSuccessRate: 0.1, toolSuccessRate: 0.1 } },
      (event, payload) => events.push({ event, payload }),
    );
    const status = (
      res.result as { growthStatus: { activationScore: number; operationalScore: number | null } }
    ).growthStatus;
    expect(status.activationScore).toBeGreaterThanOrEqual(90);
    expect(status.operationalScore).not.toBeNull();
    expect(status.operationalScore as number).toBeLessThan(30);
    expect(events.some((e) => e.event === "agent_growth.false_ready_detected")).toBe(true);
  });

  it("agents.analyze-growth-task stores pendingTaskContext with template fallback", async () => {
    listSkillRecommendations.mockReturnValue([
      { skillId: "market_research", name: "市场调研", summary: "竞品" },
    ]);
    const res = await invoke("agents.analyze-growth-task", {
      agentId: "main",
      draftText: "帮我做一份市场分析",
      source: "composer",
    });
    expect(res.ok).toBe(true);
    const payload = res.result as {
      growthStatus: {
        pendingTaskContext: {
          draftText: string;
          extractStatus: string;
          source: string;
        } | null;
      };
      recommendation: { kind: string };
    };
    expect(payload.growthStatus.pendingTaskContext?.draftText).toBe("帮我做一份市场分析");
    expect(payload.growthStatus.pendingTaskContext?.source).toBe("composer");
    expect(payload.growthStatus.pendingTaskContext?.extractStatus).toBe("failed_fallback");
    expect(payload.recommendation).toBeTruthy();
  });

  it("agents.clear-growth-pending-task clears pending context", async () => {
    await invoke("agents.analyze-growth-task", {
      agentId: "main",
      draftText: "临时任务",
      source: "composer",
    });
    const res = await invoke("agents.clear-growth-pending-task", { agentId: "main" });
    expect(res.ok).toBe(true);
    const payload = res.result as {
      growthStatus: { pendingTaskContext: unknown };
    };
    expect(payload.growthStatus.pendingTaskContext == null).toBe(true);
  });
});
