import { beforeEach, describe, expect, it } from "vitest";
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
  setAutoRoutingAdmission,
  setTenantSelectable,
} from "./model-admission-store.ts";
import {
  __resetModelConnectionSessionForTest,
  buildConnectionFingerprint,
  hasSuccessfulModelConnection,
  isConnectionVerificationStale,
  markModelConnectionVerified,
} from "./model-connection-gate.ts";
import { previewRoutingDecision } from "./routing-decision-preview.ts";
import type { ModelAsset } from "./view-model.ts";

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

describe("capability verification stub", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
  });

  it("covers connection-ok but tool_use failed (partial)", () => {
    const task = createCapabilityVerificationTask({
      modelRef: "private/demo",
      capabilityIds: ["text_chat", "tool_use"],
      simulate: { failIds: ["tool_use"] },
    });
    expect(task.status).toBe("partial");
    expect(task.results?.find((r) => r.id === "text_chat")?.status).toBe("passed");
    expect(task.results?.find((r) => r.id === "tool_use")?.status).toBe("failed");
    const restored = getVerificationTask(task.taskId);
    expect(restored?.taskId).toBe(task.taskId);
    expect(listVerificationTasks("private/demo").length).toBe(1);
  });

  it("treats image/music taskId-only as failed (no artifact)", () => {
    const task = createCapabilityVerificationTask({
      modelRef: "private/img",
      capabilityIds: ["image_generation"],
      simulate: { noArtifactIds: ["image_generation"] },
    });
    expect(task.status).toBe("failed");
    expect(task.results?.[0]?.failureReason).toMatch(/taskId/);
  });

  it("expires evidence and restricts auto-routing", () => {
    createCapabilityVerificationTask({
      modelRef: "private/demo",
      capabilityIds: ["text_chat"],
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
    // Only b gets verified coding
    createCapabilityVerificationTask({
      modelRef: "private/b",
      capabilityIds: ["coding"],
    });

    const preview = previewRoutingDecision({
      request: { taskText: "refactor this code module", requiredCapabilities: ["coding"] },
      candidates,
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.taskCategory).toBe("coding");
    expect(preview.primary).toEqual(["private/b"]);
    expect(
      preview.excluded.some((e) => e.modelId === "private/a" && e.code === "capability_unverified"),
    ).toBe(true);
  });

  it("excludes models with auto-routing disabled", () => {
    const candidates = [asset({ modelId: "private/off", autoRouting: "disabled" })];
    const preview = previewRoutingDecision({
      request: { taskText: "hello" },
      candidates,
    });
    expect(preview.selectedModelId).toBeNull();
    expect(preview.excluded[0]?.code).toBe("auto_routing_disabled");
  });
});

describe("suggested evidence is never verified", () => {
  it("marks inferred tags as suggested only", () => {
    const items = suggestedEvidenceFromInferred(["code", "tools"]);
    expect(verifiedCapabilityIds(items)).toEqual([]);
    expect(items.every((i) => i.status === "suggested")).toBe(true);
    expect(items.map((i) => i.id).toSorted()).toEqual(["coding", "tool_use"]);
  });
});
