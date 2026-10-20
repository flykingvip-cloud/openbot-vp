import { describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  loadDependencyGraph,
  loadDependencySummary,
  normalizeDependencyGraph,
  normalizeDependencySummary,
  type SkillDependencyState,
} from "./skill-dependency.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method: string, params?: unknown) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): SkillDependencyState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    summaryCache: {},
    graphCache: {},
    loadingSkillId: null,
  };
}

describe("skill-dependency controller", () => {
  describe("normalizeDependencySummary", () => {
    it("normalizes a valid summary response", () => {
      const result = normalizeDependencySummary({
        installedRobotCount: 3,
        sharedGroupCount: 2,
        dependentSkillCount: 1,
        enterpriseConsumerCount: 4,
      });

      expect(result.installedRobotCount).toBe(3);
      expect(result.sharedGroupCount).toBe(2);
      expect(result.dependentSkillCount).toBe(1);
      expect(result.enterpriseConsumerCount).toBe(4);
      expect(result.hasAnyConsumer).toBe(true);
    });

    it("hasAnyConsumer is false when all counts are 0", () => {
      const result = normalizeDependencySummary({
        installedRobotCount: 0,
        sharedGroupCount: 0,
        dependentSkillCount: 0,
        enterpriseConsumerCount: 0,
      });

      expect(result.hasAnyConsumer).toBe(false);
    });

    it("hasAnyConsumer is true when any count > 0", () => {
      const result = normalizeDependencySummary({
        installedRobotCount: 0,
        sharedGroupCount: 0,
        dependentSkillCount: 0,
        enterpriseConsumerCount: 1,
      });

      expect(result.hasAnyConsumer).toBe(true);
    });

    it("handles missing/malformed data gracefully", () => {
      const result = normalizeDependencySummary(null);

      expect(result.installedRobotCount).toBe(0);
      expect(result.sharedGroupCount).toBe(0);
      expect(result.dependentSkillCount).toBe(0);
      expect(result.enterpriseConsumerCount).toBe(0);
      expect(result.hasAnyConsumer).toBe(false);
    });

    it("handles negative counts by clamping to 0", () => {
      const result = normalizeDependencySummary({
        installedRobotCount: -5,
        sharedGroupCount: -1,
        dependentSkillCount: -2,
        enterpriseConsumerCount: -3,
      });

      expect(result.installedRobotCount).toBe(0);
      expect(result.sharedGroupCount).toBe(0);
      expect(result.dependentSkillCount).toBe(0);
      expect(result.enterpriseConsumerCount).toBe(0);
    });

    it("handles non-numeric values gracefully", () => {
      const result = normalizeDependencySummary({
        installedRobotCount: "three",
        sharedGroupCount: undefined,
        dependentSkillCount: null,
        enterpriseConsumerCount: {},
      });

      expect(result.installedRobotCount).toBe(0);
      expect(result.sharedGroupCount).toBe(0);
      expect(result.dependentSkillCount).toBe(0);
      expect(result.enterpriseConsumerCount).toBe(0);
    });
  });

  describe("normalizeDependencyGraph", () => {
    it("normalizes a full graph response", () => {
      const result = normalizeDependencyGraph({
        installedRobots: [
          { agentId: "robot-1", name: "销售助手" },
          { agentId: "robot-2", name: "客服助手" },
        ],
        sharedGroups: [{ groupId: "group-1", name: "市场部" }],
        dependentSkills: [{ skillId: "skill-2", name: "数据分析" }],
        enterpriseConsumers: [
          { kind: "department", id: "dept-1", label: "技术部" },
          { kind: "enterprise", id: null, label: "全企业" },
        ],
      });

      expect(result.installedRobots).toEqual([
        { id: "robot-1", name: "销售助手" },
        { id: "robot-2", name: "客服助手" },
      ]);
      expect(result.sharedGroups).toEqual([{ id: "group-1", name: "市场部" }]);
      expect(result.dependentSkills).toEqual([{ id: "skill-2", name: "数据分析" }]);
      expect(result.enterpriseConsumers).toEqual([
        { kind: "department", id: "dept-1", label: "技术部" },
        { kind: "enterprise", id: null, label: "全企业" },
      ]);
      expect(result.installedRobotCount).toBe(2);
      expect(result.sharedGroupCount).toBe(1);
      expect(result.dependentSkillCount).toBe(1);
      expect(result.enterpriseConsumerCount).toBe(2);
      expect(result.hasAnyConsumer).toBe(true);
    });

    it("handles empty graph", () => {
      const result = normalizeDependencyGraph({
        installedRobots: [],
        sharedGroups: [],
        dependentSkills: [],
        enterpriseConsumers: [],
      });

      expect(result.installedRobots).toEqual([]);
      expect(result.sharedGroups).toEqual([]);
      expect(result.dependentSkills).toEqual([]);
      expect(result.enterpriseConsumers).toEqual([]);
      expect(result.hasAnyConsumer).toBe(false);
    });

    it("handles null/undefined input gracefully", () => {
      const result = normalizeDependencyGraph(null);

      expect(result.installedRobots).toEqual([]);
      expect(result.sharedGroups).toEqual([]);
      expect(result.dependentSkills).toEqual([]);
      expect(result.enterpriseConsumers).toEqual([]);
      expect(result.hasAnyConsumer).toBe(false);
    });

    it("uses name field as fallback for enterprise consumer label", () => {
      const result = normalizeDependencyGraph({
        installedRobots: [],
        sharedGroups: [],
        dependentSkills: [],
        enterpriseConsumers: [{ kind: "role", id: "role-1", name: "管理员" }],
      });

      expect(result.enterpriseConsumers).toEqual([{ kind: "role", id: "role-1", label: "管理员" }]);
    });

    it("defaults unknown consumer kind to enterprise", () => {
      const result = normalizeDependencyGraph({
        installedRobots: [],
        sharedGroups: [],
        dependentSkills: [],
        enterpriseConsumers: [{ kind: "unknown", id: "x", label: "未知" }],
      });

      expect(result.enterpriseConsumers[0].kind).toBe("enterprise");
    });
  });

  describe("loadDependencySummary", () => {
    it("populates summaryCache on success", async () => {
      const handler = vi.fn(async () => ({
        installedRobotCount: 2,
        sharedGroupCount: 1,
        dependentSkillCount: 0,
        enterpriseConsumerCount: 3,
      }));
      const state = createState(handler);

      await loadDependencySummary(state, "skill-abc");

      expect(handler).toHaveBeenCalledWith("skill-dependency.summary", { skillId: "skill-abc" });
      expect(state.summaryCache["skill-abc"]).toEqual({
        installedRobotCount: 2,
        sharedGroupCount: 1,
        dependentSkillCount: 0,
        enterpriseConsumerCount: 3,
        hasAnyConsumer: true,
      });
      expect(state.loadingSkillId).toBeNull();
    });

    it("does nothing when client is null", async () => {
      const state: SkillDependencyState = {
        client: null,
        connected: true,
        summaryCache: {},
        graphCache: {},
        loadingSkillId: null,
      };

      await loadDependencySummary(state, "skill-abc");

      expect(state.summaryCache).toEqual({});
    });

    it("does nothing when not connected", async () => {
      const handler = vi.fn(async () => ({}));
      const state = createState(handler);
      state.connected = false;

      await loadDependencySummary(state, "skill-abc");

      expect(handler).not.toHaveBeenCalled();
    });

    it("handles error gracefully without crashing", async () => {
      const handler = vi.fn(async () => {
        throw new Error("network error");
      });
      const state = createState(handler);

      await loadDependencySummary(state, "skill-abc");

      expect(state.summaryCache["skill-abc"]).toBeUndefined();
      expect(state.loadingSkillId).toBeNull();
    });
  });

  describe("loadDependencyGraph", () => {
    it("populates graphCache with full graph", async () => {
      const handler = vi.fn(async () => ({
        installedRobots: [{ agentId: "robot-1", name: "助手A" }],
        sharedGroups: [{ groupId: "group-1", name: "小组B" }],
        dependentSkills: [],
        enterpriseConsumers: [{ kind: "department", id: "dept-1", label: "部门C" }],
      }));
      const state = createState(handler);

      await loadDependencyGraph(state, "skill-xyz");

      expect(handler).toHaveBeenCalledWith("skill-dependency.graph", { skillId: "skill-xyz" });
      const cached = state.graphCache["skill-xyz"];
      expect(cached).toBeDefined();
      expect(cached.installedRobots).toEqual([{ id: "robot-1", name: "助手A" }]);
      expect(cached.sharedGroups).toEqual([{ id: "group-1", name: "小组B" }]);
      expect(cached.dependentSkills).toEqual([]);
      expect(cached.enterpriseConsumers).toEqual([
        { kind: "department", id: "dept-1", label: "部门C" },
      ]);
      expect(cached.hasAnyConsumer).toBe(true);
      expect(state.loadingSkillId).toBeNull();
    });

    it("does nothing when client is null", async () => {
      const state: SkillDependencyState = {
        client: null,
        connected: true,
        summaryCache: {},
        graphCache: {},
        loadingSkillId: null,
      };

      await loadDependencyGraph(state, "skill-xyz");

      expect(state.graphCache).toEqual({});
    });

    it("handles error gracefully without crashing", async () => {
      const handler = vi.fn(async () => {
        throw new Error("timeout");
      });
      const state = createState(handler);

      await loadDependencyGraph(state, "skill-xyz");

      expect(state.graphCache["skill-xyz"]).toBeUndefined();
      expect(state.loadingSkillId).toBeNull();
    });
  });
});
