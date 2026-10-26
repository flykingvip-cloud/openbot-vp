import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { PlatformPortReadModel } from "../semantic/platform-read-model.ts";
import { buildPlatformModelsVM } from "./adapter.ts";
import { suggestedEvidenceFromInferred, verifiedCapabilityIds } from "./capability-evidence.ts";
import { normalizeCapabilityIds, toCanonicalCapabilityId } from "./capability-ids.ts";
import {
  createCapabilityVerificationTask,
  expireCapabilityEvidenceForModel,
  getVerificationTask,
  listVerificationTasks,
} from "./capability-verification.ts";
import { assertNoNativeMidjourneyClaim, resolveExecutorPathLabel } from "./executor-path-labels.ts";
import {
  __resetModelAdmissionStoreForTest,
  getModelAdmission,
  isStubOrDemoEvidence,
  setAutoRoutingAdmission,
  setExecutorCallTypeArchive,
  setTenantSelectable,
  upsertModelAdmission,
} from "./model-admission-store.ts";
import {
  __resetModelConnectionSessionForTest,
  buildConnectionFingerprint,
  hasSuccessfulModelConnection,
  isConnectionVerificationStale,
  markModelConnectionVerified,
} from "./model-connection-gate.ts";
import { buildPlatformModelDefinitionEntry } from "./platform-model-definition.ts";
import { previewRoutingDecision } from "./routing-decision-preview.ts";
import type { ModelAsset } from "./view-model.ts";

/**
 * Mirrors src/config/zod-schema.core.ts ModelDefinitionSchema (.strict()).
 * Kept local so UI tests do not pull the full gateway config graph; keys must
 * stay aligned with the backend contract (no callType / archive fields).
 */
const ModelDefinitionSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    api: z
      .enum([
        "openai-completions",
        "openai-responses",
        "openai-codex-responses",
        "anthropic-messages",
        "google-generative-ai",
        "github-copilot",
        "bedrock-converse-stream",
        "ollama",
      ])
      .optional(),
    reasoning: z.boolean().optional(),
    input: z.array(z.union([z.literal("text"), z.literal("image")])).optional(),
    cost: z
      .object({
        input: z.number().optional(),
        output: z.number().optional(),
        cacheRead: z.number().optional(),
        cacheWrite: z.number().optional(),
      })
      .strict()
      .optional(),
    contextWindow: z.number().positive().optional(),
    maxTokens: z.number().positive().optional(),
    headers: z.record(z.string(), z.string()).optional(),
  })
  .strict();

function asset(overrides: Partial<ModelAsset> = {}): ModelAsset {
  return {
    modelId: "private/demo",
    displayName: "Demo",
    providerId: "private",
    source: "configured",
    inputModalities: ["text"],
    outputModalities: ["text"],
    capabilities: [],
    costTier: "unknown",
    health: "healthy",
    healthBasis: "config_inferred",
    taskTags: [],
    inRecommendationPool: false,
    tenantSelectable: false,
    admissionControlsAvailable: false,
    autoRouting: "disabled",
    ...overrides,
  };
}

describe("capability ids", () => {
  it("maps legacy code/tools to canonical coding/tool_use", () => {
    expect(toCanonicalCapabilityId("code")).toBe("coding");
    expect(toCanonicalCapabilityId("tools")).toBe("tool_use");
    expect(normalizeCapabilityIds(["code", "tools", "coding"])).toEqual(["coding", "tool_use"]);
  });
});

describe("executor path labels", () => {
  it("labels Midjourney keywords as Stepfun, never native Midjourney", () => {
    const label = resolveExecutorPathLabel({
      modelId: "midjourney-v6",
      outputModalities: ["image"],
    });
    expect(label.badge).toContain("Stepfun");
    expect(label.badge.toLowerCase()).not.toContain("原生 midjourney");
    expect(assertNoNativeMidjourneyClaim(label.detail)).toBe(true);
  });

  it("labels music as Suno-compatible", () => {
    const label = resolveExecutorPathLabel({ modelId: "suno-v3", callType: "music_generation" });
    expect(label.badge).toContain("Suno");
  });
});

describe("model definition schema contract", () => {
  it("accepts form→config entries without callType", () => {
    const entry = buildPlatformModelDefinitionEntry({
      modelId: "gpt-demo",
      name: "GPT Demo",
      api: "openai-responses",
      reasoning: false,
      inputModes: ["text"],
      contextWindow: 64000,
      maxTokens: 4096,
    });
    const parsed = ModelDefinitionSchema.safeParse(entry);
    expect(parsed.success).toBe(true);
    expect(entry).not.toHaveProperty("callType");
  });

  it("rejects callType on ModelDefinitionSchema.strict()", () => {
    const entry = {
      ...buildPlatformModelDefinitionEntry({
        modelId: "gpt-demo",
        name: "GPT Demo",
        api: "openai-responses",
        reasoning: false,
        inputModes: ["text"],
      }),
      callType: "music_generation",
    };
    const parsed = ModelDefinitionSchema.safeParse(entry);
    expect(parsed.success).toBe(false);
  });

  it("omits unknown context/maxTokens rather than inventing defaults", () => {
    const entry = buildPlatformModelDefinitionEntry({
      modelId: "unknown-model",
      name: "Unknown",
      api: "openai-completions",
      reasoning: false,
      inputModes: [],
      contextWindow: null,
      maxTokens: null,
    });
    expect(entry).not.toHaveProperty("contextWindow");
    expect(entry).not.toHaveProperty("maxTokens");
    expect(ModelDefinitionSchema.safeParse(entry).success).toBe(true);
  });

  it("stores callType in platform capability archive, not model config", () => {
    __resetModelAdmissionStoreForTest();
    setExecutorCallTypeArchive("private/suno", "music_generation");
    expect(getModelAdmission("private/suno").executorCallType).toBe("music_generation");
    const entry = buildPlatformModelDefinitionEntry({
      modelId: "suno",
      name: "Suno",
      api: "openai-completions",
      reasoning: false,
      inputModes: ["text"],
    });
    expect(entry).not.toHaveProperty("callType");
  });
});

describe("connection fingerprint gate", () => {
  beforeEach(() => {
    __resetModelConnectionSessionForTest();
    __resetModelAdmissionStoreForTest();
  });

  it("invalidates session verification when endpoint changes", () => {
    const modelId = "private/demo";
    markModelConnectionVerified(modelId, {
      modelId,
      providerId: "private",
      baseUrl: "https://a.example",
      api: "openai-completions",
    });
    const same = asset({
      modelId,
      providerId: "private",
      baseUrl: "https://a.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://a.example",
        api: "openai-completions",
      }),
    });
    expect(hasSuccessfulModelConnection(same)).toBe(true);

    const changed = asset({
      modelId,
      providerId: "private",
      baseUrl: "https://b.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://b.example",
        api: "openai-completions",
      }),
    });
    expect(hasSuccessfulModelConnection(changed)).toBe(false);
    expect(isConnectionVerificationStale(changed)).toBe(true);
  });

  it("does not treat retained liveProbe.ok as success after endpoint change", () => {
    const modelId = "private/demo";
    markModelConnectionVerified(modelId, {
      modelId,
      providerId: "private",
      baseUrl: "https://a.example",
      api: "openai-completions",
    });
    upsertModelAdmission(modelId, {
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
        },
      ],
    });
    setAutoRoutingAdmission(modelId, "eligible");

    // Endpoint changed; old probe result retained on the asset.
    const changed = asset({
      modelId,
      providerId: "private",
      baseUrl: "https://b.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://b.example",
        api: "openai-completions",
      }),
      liveProbe: { status: "ok", source: "profile", label: "stale-ok" },
      healthBasis: "live_probe_ok",
    });

    expect(hasSuccessfulModelConnection(changed)).toBe(false);
    expect(isConnectionVerificationStale(changed)).toBe(true);
    const admission = getModelAdmission(modelId);
    expect(admission.capabilityEvidence[0]?.status).toBe("expired");
    expect(admission.autoRouting).toBe("restricted");
    // Stale fingerprint retained until re-verify so liveProbe cannot resurrect success.
    expect(admission.connectionFingerprint).toBe(
      buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://a.example",
        api: "openai-completions",
      }),
    );
  });

  it("does not accept modelId-only session mark once endpoint identity is known", () => {
    const modelId = "private/demo";
    markModelConnectionVerified(modelId);
    const withEndpoint = asset({
      modelId,
      providerId: "private",
      baseUrl: "https://a.example",
      api: "openai-completions",
      connectionFingerprint: buildConnectionFingerprint({
        modelId,
        providerId: "private",
        baseUrl: "https://a.example",
        api: "openai-completions",
      }),
      healthBasis: "config_inferred",
    });
    expect(hasSuccessfulModelConnection(withEndpoint)).toBe(false);
  });
});

describe("admission store separation", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("keeps tenant selectable and auto-routing independent of each other", () => {
    setTenantSelectable("private/demo", true);
    expect(getModelAdmission("private/demo").tenantSelectable).toBe(true);
    expect(getModelAdmission("private/demo").autoRouting).toBe("disabled");

    setAutoRoutingAdmission("private/demo", "eligible");
    expect(getModelAdmission("private/demo").tenantSelectable).toBe(true);
    expect(getModelAdmission("private/demo").autoRouting).toBe("eligible");
  });
});

describe("capability verification stub isolation", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("covers connection-ok but tool_use failed (partial) without formal evidence", () => {
    const task = createCapabilityVerificationTask({
      modelRef: "private/demo",
      capabilityIds: ["text_chat", "tool_use"],
      simulate: { failIds: ["tool_use"] },
    });
    expect(task.status).toBe("partial");
    expect(task.results?.find((r) => r.id === "text_chat")?.status).toBe("passed");
    expect(task.results?.find((r) => r.id === "tool_use")?.status).toBe("failed");
    expect(task.error).toMatch(/演示/);
    const restored = getVerificationTask(task.taskId);
    expect(restored?.taskId).toBe(task.taskId);
    expect(listVerificationTasks("private/demo").length).toBe(1);

    const admission = getModelAdmission("private/demo");
    expect(admission.capabilityEvidence).toEqual([]);
    expect(admission.demoCapabilityEvidence?.some((i) => i.status === "passed")).toBe(true);
    expect(verifiedCapabilityIds(admission.capabilityEvidence)).toEqual([]);
    expect(verifiedCapabilityIds(admission.demoCapabilityEvidence ?? [])).not.toEqual([]);
  });

  it("treats image/music taskId-only as failed (no artifact) in demo only", () => {
    const task = createCapabilityVerificationTask({
      modelRef: "private/img",
      capabilityIds: ["image_generation"],
      simulate: { noArtifactIds: ["image_generation"] },
    });
    expect(task.status).toBe("failed");
    expect(task.results?.[0]?.failureReason).toMatch(/taskId/);
    expect(getModelAdmission("private/img").capabilityEvidence).toEqual([]);
  });

  it("expires formal evidence and restricts auto-routing", () => {
    upsertModelAdmission("private/demo", {
      capabilityEvidence: [
        {
          id: "text_chat",
          label: "text_chat",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
        },
      ],
    });
    setAutoRoutingAdmission("private/demo", "eligible");
    expireCapabilityEvidenceForModel("private/demo", "端点已变更，需重新验证");
    const admission = getModelAdmission("private/demo");
    expect(admission.capabilityEvidence[0]?.status).toBe("expired");
    expect(admission.autoRouting).toBe("restricted");
  });
});

describe("routing decision preview", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("excludes unverified models from required-capability routes", () => {
    const candidates = [
      asset({ modelId: "private/a", autoRouting: "eligible" }),
      asset({ modelId: "private/b", autoRouting: "eligible" }),
    ];
    setAutoRoutingAdmission("private/a", "eligible");
    setAutoRoutingAdmission("private/b", "eligible");
    // Formal evidence only — stub demo must not unlock routing.
    upsertModelAdmission("private/b", {
      capabilityEvidence: [
        {
          id: "coding",
          label: "coding",
          source: "protocol_probe",
          status: "passed",
          verifiedAt: Date.now(),
        },
      ],
    });
    createCapabilityVerificationTask({
      modelRef: "private/a",
      capabilityIds: ["coding"],
    });

    const preview = previewRoutingDecision({
      request: { taskText: "refactor this code module", requiredCapabilities: ["coding"] },
      candidates,
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.uiDemo).toBe(true);
    expect(preview.decisionReason).toMatch(/界面演示，非后端决策/);
    expect(preview.taskCategory).toBe("coding");
    expect(preview.primary).toEqual(["private/b"]);
    expect(
      preview.excluded.some((e) => e.modelId === "private/a" && e.code === "capability_unverified"),
    ).toBe(true);
    // Stub passed coding on private/a must not count as formal verified.
    expect(verifiedCapabilityIds(getModelAdmission("private/a").capabilityEvidence)).toEqual([]);
  });

  it("excludes models with auto-routing disabled", () => {
    const candidates = [asset({ modelId: "private/off", autoRouting: "disabled" })];
    const preview = previewRoutingDecision({
      request: { taskText: "hello" },
      candidates,
    });
    expect(preview.selectedModelId).toBeNull();
    expect(preview.excluded[0]?.code).toBe("auto_routing_disabled");
    expect(preview.uiDemo).toBe(true);
  });
});

describe("legacy stub evidence upgrade migration", () => {
  const STORAGE_KEY = "openbot.platform.modelAdmission.v1";

  function installMemoryLocalStorage() {
    const map = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return map.size;
      },
      clear() {
        map.clear();
      },
      getItem(key: string) {
        return map.has(key) ? (map.get(key) as string) : null;
      },
      setItem(key: string, value: string) {
        map.set(key, String(value));
      },
      removeItem(key: string) {
        map.delete(key);
      },
      key(index: number) {
        return Array.from(map.keys())[index] ?? null;
      },
    };
    Object.defineProperty(globalThis, "localStorage", {
      value: storage,
      configurable: true,
      writable: true,
    });
  }

  beforeEach(() => {
    installMemoryLocalStorage();
    __resetModelAdmissionStoreForTest();
  });

  afterEach(() => {
    __resetModelAdmissionStoreForTest();
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  function seedLegacyStubLocalStorage(modelRef: string) {
    const legacy = {
      [modelRef]: {
        modelRef,
        tenantSelectable: false,
        autoRouting: "disabled",
        autoRoutingTaskCategories: [],
        capabilityEvidence: [
          {
            id: "text_chat",
            label: "text_chat",
            source: "protocol_probe",
            status: "passed",
            verifiedAt: 1_700_000_000_000,
            testVersion: "stub-v1",
            sourceNote: "基础协议探测",
          },
          {
            id: "tool_use",
            label: "tool_use",
            source: "protocol_probe",
            status: "failed",
            verifiedAt: 1_700_000_000_000,
            testVersion: "stub-v1",
            sourceNote: "stub",
            failureReason: "tool_use 专项检查失败",
          },
          {
            id: "coding",
            label: "coding",
            source: "protocol_probe",
            status: "passed",
            verifiedAt: 1_700_000_000_100,
            // Genuine formal evidence from a real probe — must be retained.
          },
        ],
        updatedAt: 1_700_000_000_000,
      },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));
  }

  it("moves legacy stub-v1 rows out of formal evidence on read and keeps real formal", () => {
    const modelRef = "deepseek/deepseek-chat";
    seedLegacyStubLocalStorage(modelRef);

    const first = getModelAdmission(modelRef);
    expect(first.capabilityEvidence.map((i) => i.id)).toEqual(["coding"]);
    expect(first.capabilityEvidence[0]?.status).toBe("passed");
    expect(first.capabilityEvidence.every((i) => !isStubOrDemoEvidence(i))).toBe(true);
    expect(verifiedCapabilityIds(first.capabilityEvidence)).toEqual(["coding"]);
    expect(verifiedCapabilityIds(first.capabilityEvidence)).not.toContain("text_chat");

    expect(first.demoCapabilityEvidence?.map((i) => i.id).toSorted()).toEqual([
      "text_chat",
      "tool_use",
    ]);
    expect(first.demoCapabilityEvidence?.every((i) => i.testVersion === "stub-v1")).toBe(true);

    // Refresh / second read — migration persists; formal stays clean without clearing browser.
    const second = getModelAdmission(modelRef);
    expect(verifiedCapabilityIds(second.capabilityEvidence)).toEqual(["coding"]);
    expect(second.demoCapabilityEvidence?.map((i) => i.id).toSorted()).toEqual([
      "text_chat",
      "tool_use",
    ]);

    const persisted = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Record<
      string,
      {
        capabilityEvidence: Array<{ id: string; testVersion?: string }>;
        demoCapabilityEvidence?: Array<{ id: string }>;
      }
    >;
    expect(persisted[modelRef]?.capabilityEvidence.map((i) => i.id)).toEqual(["coding"]);
    expect(persisted[modelRef]?.capabilityEvidence.some((i) => i.testVersion === "stub-v1")).toBe(
      false,
    );
    expect(persisted[modelRef]?.demoCapabilityEvidence?.map((i) => i.id).toSorted()).toEqual([
      "text_chat",
      "tool_use",
    ]);
  });

  it("keeps stub results out of formal verified set when reading model assets after upgrade", () => {
    const modelRef = "deepseek/deepseek-chat";
    seedLegacyStubLocalStorage(modelRef);

    const readModel = {
      currentTenantId: "tenant-a",
      currentTenantLabel: "Tenant A",
      knownTenantIds: ["tenant-a"],
      tenantDirectory: [{ tenantId: "tenant-a", label: "Tenant A" }],
      enterpriseDirectory: [],
      agentDirectory: [],
      modelDirectory: [],
      gatewayCatalogModels: [
        {
          providerId: "deepseek",
          modelId: "deepseek-chat",
          name: "DeepSeek Chat",
          contextWindow: 64000,
        },
      ],
      taskPlanDirectory: [],
      routingPolicyDirectory: [],
      gatewayCatalogCount: 1,
      defaultModelPrimary: "deepseek/deepseek-chat",
      defaultModelFallbacks: [],
      defaultImageModelPrimary: null,
      allowlistedModelRefs: ["deepseek/deepseek-chat"],
      allowlistEntries: [{ modelRef: "deepseek/deepseek-chat", alias: "DeepSeek" }],
      aliasCount: 1,
      providerHealthDirectory: [],
      agentCount: 0,
      featureMethodCount: 0,
      channelCount: 0,
      channelIds: [],
      accountCount: 0,
      connectedAccountCount: 0,
      nodeCount: 0,
      presenceCount: 0,
      runtimeHosts: [],
      sessionsCount: 0,
      totalTokens: 0,
      totalCost: 0,
      missingCostEntries: 0,
      currentUsageOverview: {
        sessionCount: 0,
        totalTokens: 0,
        totalCost: 0,
        totalMessages: 0,
        errorCount: 0,
        errorRate: 0,
        avgLatencyMs: null,
        peakErrorDayLabel: null,
        topModelLabel: null,
        topAgentId: null,
        activeAgentCount: 0,
        activeChannelCount: 0,
        dailyCalls: [],
        dailyCost: [],
        updatedAt: null,
      },
      modelMode: "merge",
      configuredProviderCount: 1,
      providerIds: ["deepseek"],
      configuredModelCount: 0,
      configuredModelIds: [],
      installedCapabilityCount: 0,
      attentionItems: [],
      currentVersion: "2026.3.9",
      latestVersion: "2026.3.9",
      hasUpdateAvailable: false,
      cronEnabled: null,
      cronNextAt: null,
      operatorUser: "ops@example.com",
      operatorRole: "super_admin",
      latestInvite: null,
    } as PlatformPortReadModel;

    const vm = buildPlatformModelsVM({ readModel, legacyModelsVM: null });
    const asset = vm.assets.models.find((m) => m.modelId === modelRef);
    expect(asset).toBeTruthy();
    const formalVerified = verifiedCapabilityIds(asset?.capabilityEvidence ?? []);
    expect(formalVerified).toContain("coding");
    expect(formalVerified).not.toContain("text_chat");
    expect(formalVerified).not.toContain("tool_use");
    expect((asset?.capabilityEvidence ?? []).some((i) => i.testVersion === "stub-v1")).toBe(false);

    const refreshed = buildPlatformModelsVM({ readModel, legacyModelsVM: null });
    const again = refreshed.assets.models.find((m) => m.modelId === modelRef);
    expect(verifiedCapabilityIds(again?.capabilityEvidence ?? [])).toEqual(
      expect.arrayContaining(["coding"]),
    );
    expect(verifiedCapabilityIds(again?.capabilityEvidence ?? [])).not.toContain("text_chat");
  });

  it("keeps formal verified clean after page-refresh-like memory clear (localStorage kept)", () => {
    const modelRef = "deepseek/deepseek-chat";
    seedLegacyStubLocalStorage(modelRef);
    const migrated = getModelAdmission(modelRef);
    expect(verifiedCapabilityIds(migrated.capabilityEvidence)).toEqual(["coding"]);

    const persisted = localStorage.getItem(STORAGE_KEY);
    expect(persisted).toBeTruthy();

    // Simulate browser refresh: in-memory store wiped, migrated localStorage retained.
    __resetModelAdmissionStoreForTest();
    localStorage.setItem(STORAGE_KEY, persisted!);

    const afterRefresh = getModelAdmission(modelRef);
    expect(verifiedCapabilityIds(afterRefresh.capabilityEvidence)).toEqual(["coding"]);
    expect(afterRefresh.capabilityEvidence.some((i) => i.testVersion === "stub-v1")).toBe(false);
    expect(afterRefresh.demoCapabilityEvidence?.map((i) => i.id).toSorted()).toEqual([
      "text_chat",
      "tool_use",
    ]);
    // No admin clear of browser data required — re-read stays migrated.
    expect(verifiedCapabilityIds(afterRefresh.capabilityEvidence)).not.toContain("text_chat");
  });
});

describe("suggested evidence is never verified", () => {
  it("marks inferred tags as suggested only", () => {
    const items = suggestedEvidenceFromInferred(["code", "tools"]);
    expect(verifiedCapabilityIds(items)).toEqual([]);
    expect(items.every((i) => i.status === "suggested")).toBe(true);
  });
});
