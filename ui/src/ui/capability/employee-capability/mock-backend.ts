import type {
  CapabilityPreflightResponse,
  HealthLabelSubscribeResponse,
  InstallToRobotResponse,
  MyAccumulationResponse,
  QuickSaveResponse,
  RecommendationsResponse,
  UpdateRecapResponse,
  UsageBriefResponse,
} from "./endpoints.ts";
import type { CapabilitySummary, RobotCapabilityProfile } from "./types.ts";

type MockBackendSeed = {
  capabilities?: CapabilitySummary[];
  profiles?: RobotCapabilityProfile[];
};

function toListItem(capability: CapabilitySummary): MyAccumulationResponse["items"][number] {
  return {
    id: capability.id,
    name: capability.name,
    summary: capability.summary,
    health: capability.health,
    shareVisibility: capability.shareVisibility,
    isDraft: capability.isDraft,
    recentUpdate: capability.recentUpdate,
    updatedAt: capability.updatedAt,
    sourceRobotName: capability.attribution.sourceRobot.name,
    usageBrief: {
      robotCount: capability.usage.robots.length,
      lastUsedAt: capability.usage.lastUsedAt,
    },
    usageMetrics: capability.usageMetrics,
    versionInfo: capability.versionInfo,
    enterpriseReview: capability.enterpriseReview,
    enterpriseLifecycle: capability.enterpriseLifecycle,
  };
}

export class MockEmployeeCapabilityBackend {
  private capabilities: CapabilitySummary[];
  private profiles: RobotCapabilityProfile[];

  constructor(seed: MockBackendSeed = {}) {
    this.capabilities = [...(seed.capabilities ?? [])];
    this.profiles = [...(seed.profiles ?? [])];
  }

  quickSave(req: {
    name: string;
    summary: string;
    sourceAgentId: string;
    sourceContextId: string;
    patternHint?: {
      sampleTaskDescription: string;
      firstFormedScenario: string;
    } | null;
  }): QuickSaveResponse {
    const sourceProfile = this.profiles.find((profile) => profile.robotId === req.sourceAgentId);
    if (!sourceProfile) {
      throw new Error(req.sourceAgentId);
    }
    const capability: CapabilitySummary = {
      id: `cap-${this.capabilities.length + 1}`,
      name: req.name,
      summary: req.summary,
      usageExamples: [],
      inputDescription: "",
      outputDescription: "",
      tags: [],
      category: "",
      avatar: null,
      health: "运行稳定",
      shareVisibility: "私有",
      maturity: null,
      attribution: {
        sourceRobot: { id: req.sourceAgentId, name: req.sourceAgentId },
        sourceTaskSummary: req.patternHint?.sampleTaskDescription ?? "",
        firstFormedScenario: req.patternHint?.firstFormedScenario ?? "",
        highFrequencyScenarios: [],
      },
      usage: {
        robots: [{ id: req.sourceAgentId, name: req.sourceAgentId }],
        totalUsageCount: 1,
        lastUsedAt: 1,
      },
      usageMetrics: {
        robotCount: 1,
        groupCount: 0,
        totalUsageCount: 1,
        lastUsedAt: 1,
      },
      recentUpdate: null,
      versionInfo: {
        currentVersion: "1.0.0",
        versionCount: 1,
        submittedVersion: null,
      },
      isDraft: true,
      createdAt: 1,
      updatedAt: 1,
      enterpriseLifecycle: {
        stage: "draft",
        stageLabel: "资产草稿",
        nextStep: "补充信息后可共享或提交企业。",
      },
    };
    this.capabilities.push(capability);
    return { capability };
  }

  myAccumulation(): MyAccumulationResponse {
    return {
      items: this.capabilities.map(toListItem),
      availableTags: Array.from(new Set(this.capabilities.flatMap((item) => item.tags))),
      availableCategories: Array.from(
        new Set(this.capabilities.map((item) => item.category).filter(Boolean)),
      ),
      availableSources: Array.from(
        new Set(this.capabilities.map((item) => item.attribution.sourceRobot.name).filter(Boolean)),
      ),
    };
  }

  recommendations(req: { agentId: string }): RecommendationsResponse {
    const profile = this.profiles.find((entry) => entry.robotId === req.agentId);
    const installed = new Set(profile?.whatItCanDo.map((item) => item.id) ?? []);
    return {
      recommendations: this.capabilities
        .filter(
          (capability) =>
            !installed.has(capability.id) &&
            (capability.shareVisibility === "已共享到协作小组" ||
              capability.shareVisibility === "已进入企业资产库"),
        )
        .map((capability) => ({
          capability,
          reason:
            capability.shareVisibility === "已进入企业资产库"
              ? "已在企业资产库中沉淀，适合补充这个机器人"
              : "来自协作小组共享，适合当前工作场景",
        })),
    };
  }

  preflight(req: { agentId: string; capabilityId: string }): CapabilityPreflightResponse {
    const capability = this.capabilities.find((entry) => entry.id === req.capabilityId);
    if (!capability) {
      return {
        capabilityId: req.capabilityId,
        status: "not_available",
        nextStep: "这个能力已经停用，换一个能用的试试",
        canInstall: false,
      };
    }
    return {
      capabilityId: req.capabilityId,
      status: "can_use_now",
      nextStep: "可以立刻给这个机器人用",
      canInstall: true,
    };
  }

  installToRobot(req: { capabilityId: string; agentId: string }): InstallToRobotResponse {
    const capability = this.capabilities.find((entry) => entry.id === req.capabilityId);
    if (!capability) {
      throw new Error(req.capabilityId);
    }
    capability.usage.robots = [
      ...capability.usage.robots.filter((robot) => robot.id !== req.agentId),
      { id: req.agentId, name: req.agentId },
    ];
    capability.usageMetrics = {
      ...capability.usageMetrics,
      robotCount: capability.usage.robots.length,
      totalUsageCount: capability.usage.totalUsageCount,
      lastUsedAt: capability.usage.lastUsedAt,
    };
    const profile = this.profiles.find((entry) => entry.robotId === req.agentId);
    if (profile && !profile.whatItCanDo.some((item) => item.id === req.capabilityId)) {
      profile.whatItCanDo = [...profile.whatItCanDo, capability];
    }
    return {
      capabilityId: req.capabilityId,
      agentId: req.agentId,
    };
  }

  removeFromRobot(req: { capabilityId: string; agentId: string }) {
    const capability = this.capabilities.find((entry) => entry.id === req.capabilityId);
    if (!capability) {
      throw new Error(req.capabilityId);
    }
    capability.usage.robots = capability.usage.robots.filter((robot) => robot.id !== req.agentId);
    capability.usageMetrics = {
      ...capability.usageMetrics,
      robotCount: capability.usage.robots.length,
      totalUsageCount: capability.usage.totalUsageCount,
      lastUsedAt: capability.usage.lastUsedAt,
    };
    const profile = this.profiles.find((entry) => entry.robotId === req.agentId);
    if (profile) {
      profile.whatItCanDo = profile.whatItCanDo.filter((item) => item.id !== req.capabilityId);
    }
    return {
      capabilityId: req.capabilityId,
      agentId: req.agentId,
    };
  }

  usageBrief(req: { capabilityId: string }): UsageBriefResponse {
    const capability = this.capabilities.find((entry) => entry.id === req.capabilityId);
    if (!capability) {
      throw new Error(req.capabilityId);
    }
    return {
      capabilityId: req.capabilityId,
      usage: capability.usage,
    };
  }

  healthLabelSubscribe(req: { capabilityIds: string[] }): HealthLabelSubscribeResponse {
    return {
      subscriptionId: "sub-mock",
      initialLabels: req.capabilityIds.map((capabilityId) => {
        const capability = this.capabilities.find((entry) => entry.id === capabilityId);
        return {
          capabilityId,
          health: capability?.health ?? "运行稳定",
        };
      }),
    };
  }

  updateRecap(req: { capabilityId: string }): UpdateRecapResponse {
    const capability = this.capabilities.find((entry) => entry.id === req.capabilityId);
    if (!capability) {
      throw new Error(req.capabilityId);
    }
    return {
      capabilityId: req.capabilityId,
      recaps: capability.recentUpdate ? [capability.recentUpdate] : [],
    };
  }
}

export function createMockEmployeeCapabilityGateway(backend: MockEmployeeCapabilityBackend) {
  return {
    quickSave: async (req: Parameters<MockEmployeeCapabilityBackend["quickSave"]>[0]) =>
      backend.quickSave(req),
    myAccumulation: async () => backend.myAccumulation(),
    recommendations: async (req: Parameters<MockEmployeeCapabilityBackend["recommendations"]>[0]) =>
      backend.recommendations(req),
    preflight: async (req: Parameters<MockEmployeeCapabilityBackend["preflight"]>[0]) =>
      backend.preflight(req),
    installToRobot: async (req: Parameters<MockEmployeeCapabilityBackend["installToRobot"]>[0]) =>
      backend.installToRobot(req),
    removeFromRobot: async (req: Parameters<MockEmployeeCapabilityBackend["removeFromRobot"]>[0]) =>
      backend.removeFromRobot(req),
    usageBrief: async (req: Parameters<MockEmployeeCapabilityBackend["usageBrief"]>[0]) =>
      backend.usageBrief(req),
    healthLabelSubscribe: async (
      req: Parameters<MockEmployeeCapabilityBackend["healthLabelSubscribe"]>[0],
    ) => backend.healthLabelSubscribe(req),
    updateRecap: async (req: Parameters<MockEmployeeCapabilityBackend["updateRecap"]>[0]) =>
      backend.updateRecap(req),
  };
}
