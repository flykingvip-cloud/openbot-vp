import { describe, expect, it } from "vitest";
import type { GatewayBrowserClient } from "../gateway.ts";
import {
  expandCapability,
  installSkillToRobot,
  loadRobotCapabilities,
  removeCapability,
  toggleCapabilityEnabled,
  type RobotCapabilityState,
} from "./robot-capability.ts";
import { containsSkillRuntimeField } from "./skill-models.ts";

type RequestHandler = (method: string, params?: unknown) => unknown;

function toGatewayRequest(handler: RequestHandler): GatewayBrowserClient["request"] {
  return ((method, params) =>
    Promise.resolve(handler(method, params))) as GatewayBrowserClient["request"];
}

function createState(request: RequestHandler): RobotCapabilityState {
  return {
    client: { request: toGatewayRequest(request) } as GatewayBrowserClient,
    connected: true,
    loading: false,
    error: null,
    agentId: null,
    items: [],
    busyRelationId: null,
    expandedSkillId: null,
    messages: {},
  };
}

describe("robot capability controller", () => {
  describe("loadRobotCapabilities", () => {
    it("populates items from gateway response", async () => {
      const state = createState(async () => ({
        items: [
          {
            relationId: "rel-1",
            id: "skill-1",
            profile: {
              id: "skill-1",
              name: "自动生成周报",
              summary: "根据项目进展生成周报草稿",
              tags: ["周报"],
            },
            health: { status: "healthy", successRate: 0.98, avgLatency: 200 },
            enabled: true,
            installedVersion: "1.0.0",
            latestVersion: "1.1.0",
            lastInvokedAt: 1700000000000,
            usageCount: 42,
            runtimeDefinition: { prompts: ["hidden"], tools: ["hidden"] },
          },
          {
            relationId: "rel-2",
            id: "skill-2",
            profile: {
              id: "skill-2",
              name: "客户情绪分析",
              summary: "识别客户反馈倾向",
            },
            health: { status: "warning", successRate: 0.7, avgLatency: 1200 },
            enabled: false,
            installedVersion: "2.0.0",
            latestVersion: null,
            usageCount: 5,
          },
        ],
      }));

      await loadRobotCapabilities(state, "agent-1");

      expect(state.agentId).toBe("agent-1");
      expect(state.items).toHaveLength(2);
      expect(state.items[0]).toMatchObject({
        relationId: "rel-1",
        skillId: "skill-1",
        name: "自动生成周报",
        summary: "根据项目进展生成周报草稿",
        enabled: true,
        lastInvokedAt: 1700000000000,
        usageCount: 42,
        hasNewerVersion: true,
        secondary: { installedVersion: "1.0.0", latestVersion: "1.1.0" },
      });
      expect(state.items[0]?.health.status).toBe("healthy");
      expect(state.items[1]).toMatchObject({
        relationId: "rel-2",
        skillId: "skill-2",
        name: "客户情绪分析",
        enabled: false,
        hasNewerVersion: false,
        secondary: { installedVersion: "2.0.0", latestVersion: null },
      });
      expect(containsSkillRuntimeField(state.items)).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });

    it("sets error on failure", async () => {
      const state = createState(async () => {
        throw new Error("connection lost");
      });

      await loadRobotCapabilities(state, "agent-1");

      expect(state.error).toBe("connection lost");
      expect(state.items).toEqual([]);
      expect(state.loading).toBe(false);
    });

    it("does not load when already loading", async () => {
      let callCount = 0;
      const state = createState(async () => {
        callCount++;
        return { items: [] };
      });
      state.loading = true;

      await loadRobotCapabilities(state, "agent-1");

      expect(callCount).toBe(0);
    });
  });

  describe("toggleCapabilityEnabled", () => {
    function stateWithItem(request: RequestHandler): RobotCapabilityState {
      const state = createState(request);
      state.agentId = "agent-1";
      state.items = [
        {
          relationId: "rel-1",
          skillId: "skill-1",
          name: "合同审查",
          summary: "检查风险条款",
          health: {
            status: "healthy",
            successRate: 1,
            avgLatency: 0,
            lastVerifiedAt: null,
            failureReasons: [],
          },
          enabled: true,
          lastInvokedAt: null,
          usageCount: 0,
          hasNewerVersion: false,
          secondary: { installedVersion: "1.0.0", latestVersion: null },
        },
      ];
      return state;
    }

    it("optimistically updates enabled state", async () => {
      let captured: unknown = null;
      const state = stateWithItem(async (_method, params) => {
        captured = params;
      });

      await toggleCapabilityEnabled(state, "rel-1", false);

      expect(state.items[0]?.enabled).toBe(false);
      expect(captured).toMatchObject({ relationId: "rel-1", enabled: false });
      expect(state.messages["rel-1"]?.kind).toBe("success");
    });

    it("rolls back on error", async () => {
      const state = stateWithItem(async () => {
        throw new Error("server error");
      });

      await toggleCapabilityEnabled(state, "rel-1", false);

      // Rolled back to original enabled=true
      expect(state.items[0]?.enabled).toBe(true);
      expect(state.error).toBe("server error");
      expect(state.messages["rel-1"]?.kind).toBe("error");
      expect(state.busyRelationId).toBeNull();
    });

    it("is idempotent when toggling to same state", async () => {
      const state = stateWithItem(async () => {});

      await toggleCapabilityEnabled(state, "rel-1", true);

      expect(state.items[0]?.enabled).toBe(true);
      expect(state.messages["rel-1"]?.kind).toBe("success");
    });
  });

  describe("removeCapability", () => {
    it("removes item from list on success", async () => {
      const state = createState(async () => {});
      state.agentId = "agent-1";
      state.items = [
        {
          relationId: "rel-1",
          skillId: "skill-1",
          name: "周报生成",
          summary: "生成周报",
          health: {
            status: "healthy",
            successRate: 1,
            avgLatency: 0,
            lastVerifiedAt: null,
            failureReasons: [],
          },
          enabled: true,
          lastInvokedAt: null,
          usageCount: 10,
          hasNewerVersion: false,
          secondary: { installedVersion: "1.0.0", latestVersion: null },
        },
        {
          relationId: "rel-2",
          skillId: "skill-2",
          name: "客户分析",
          summary: "分析客户",
          health: {
            status: "healthy",
            successRate: 1,
            avgLatency: 0,
            lastVerifiedAt: null,
            failureReasons: [],
          },
          enabled: true,
          lastInvokedAt: null,
          usageCount: 5,
          hasNewerVersion: false,
          secondary: { installedVersion: "1.0.0", latestVersion: null },
        },
      ];

      await removeCapability(state, "rel-1");

      // Only rel-2 remains — skill itself still exists in personal library (not tested here)
      expect(state.items).toHaveLength(1);
      expect(state.items[0]?.relationId).toBe("rel-2");
      expect(state.messages["rel-1"]?.kind).toBe("success");
    });

    it("rolls back on error", async () => {
      const state = createState(async () => {
        throw new Error("cannot remove");
      });
      state.items = [
        {
          relationId: "rel-1",
          skillId: "skill-1",
          name: "周报生成",
          summary: "生成周报",
          health: {
            status: "healthy",
            successRate: 1,
            avgLatency: 0,
            lastVerifiedAt: null,
            failureReasons: [],
          },
          enabled: true,
          lastInvokedAt: null,
          usageCount: 10,
          hasNewerVersion: false,
          secondary: { installedVersion: "1.0.0", latestVersion: null },
        },
      ];

      await removeCapability(state, "rel-1");

      expect(state.items).toHaveLength(1);
      expect(state.error).toBe("cannot remove");
    });
  });

  describe("installSkillToRobot", () => {
    it("adds new item to list with enabled=true and usageCount=0", async () => {
      let requestCount = 0;
      const state = createState(async (method) => {
        requestCount++;
        if (method === "robot-capability.install") {
          return {};
        }
        // Second call is loadRobotCapabilities reload
        return {
          items: [
            {
              relationId: "rel-new",
              id: "skill-new",
              profile: {
                id: "skill-new",
                name: "新安装能力",
                summary: "刚安装的能力",
              },
              health: { status: "healthy", successRate: 1, avgLatency: 0 },
              enabled: true,
              installedVersion: "1.0.0",
              latestVersion: null,
              usageCount: 0,
              lastInvokedAt: null,
            },
          ],
        };
      });

      await installSkillToRobot(state, "skill-new", "agent-1");

      expect(requestCount).toBe(3); // preflight + install + reload
      expect(state.items).toHaveLength(1);
      expect(state.items[0]).toMatchObject({
        relationId: "rel-new",
        skillId: "skill-new",
        name: "新安装能力",
        enabled: true,
        usageCount: 0,
      });
      expect(state.messages["skill-new"]?.kind).toBe("success");
      expect(state.agentId).toBe("agent-1");
    });

    it("sets error on failure without modifying items", async () => {
      const state = createState(async () => {
        throw new Error("install failed");
      });
      state.items = [];

      await installSkillToRobot(state, "skill-new", "agent-1");

      expect(state.items).toEqual([]);
      expect(state.error).toBe("install failed");
      expect(state.messages["skill-new"]?.kind).toBe("error");
    });

    it("shows the employee next step and skips install when preflight blocks", async () => {
      const methods: string[] = [];
      const state = createState(async (method) => {
        methods.push(method);
        if (method === "employee-capability.preflight") {
          return {
            capabilityId: "skill-new",
            status: "needs_setup",
            nextStep: "需要先完成服务配置",
            canInstall: false,
          };
        }
        throw new Error(`unexpected ${method}`);
      });

      await installSkillToRobot(state, "skill-new", "agent-1");

      expect(methods).toEqual(["employee-capability.preflight"]);
      expect(state.items).toEqual([]);
      expect(state.error).toBe("需要先完成服务配置");
      expect(state.messages["skill-new"]?.message).toBe("需要先完成服务配置");
    });
  });

  describe("expandCapability", () => {
    it("sets expandedSkillId when expanding", () => {
      const state = createState(async () => {});

      expandCapability(state, "skill-1");

      expect(state.expandedSkillId).toBe("skill-1");
    });

    it("toggles off when expanding same skill", () => {
      const state = createState(async () => {});
      state.expandedSkillId = "skill-1";

      expandCapability(state, "skill-1");

      expect(state.expandedSkillId).toBeNull();
    });

    it("switches to different skill", () => {
      const state = createState(async () => {});
      state.expandedSkillId = "skill-1";

      expandCapability(state, "skill-2");

      expect(state.expandedSkillId).toBe("skill-2");
    });

    it("collapses when null is passed", () => {
      const state = createState(async () => {});
      state.expandedSkillId = "skill-1";

      expandCapability(state, null);

      expect(state.expandedSkillId).toBeNull();
    });
  });
});
