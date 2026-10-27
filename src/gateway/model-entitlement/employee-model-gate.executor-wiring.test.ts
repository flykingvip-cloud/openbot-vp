// @vitest-environment node
/**
 * Production call-chain: employee-model-gate must pass resolveModalityExecutorWiring(cfg)
 * into buildTaskCapabilityPlan so configured Stepfun/Suno endpoints enable IMAGE/MUSIC.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { STEPFUN_IMAGE_MODEL_ID } from "../../agents/image-generation-models.js";
import { SUNO_MUSIC_MODEL_ID } from "../../agents/music-generation-models.js";
import type { OpenBotConfig } from "../../config/types.js";

vi.mock("../knowledge/context.js", () => ({
  resolveKnowledgeSourceContext: vi.fn(),
}));
vi.mock("../knowledge/reply-gateway-client.js", () => ({
  buildKnowledgeReplyGatewayClient: vi.fn(() => ({ user: "user@acme.test" })),
}));
vi.mock("../resource-catalog/list-enabled-model-ids.js", () => ({
  listEnabledResourceCatalogModelIds: vi.fn(async () => ({
    modelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    catalogEmpty: false,
  })),
}));
vi.mock("../resource-catalog/models-catalog-store.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../resource-catalog/models-catalog-store.js")>();
  return {
    ...actual,
    listResourceModelCatalog: vi.fn(async () => [
      {
        modelId: "api-proxy-deepseek/cheap",
        provider: "api-proxy-deepseek",
        displayName: "cheap",
        tier: "tier_a",
        enabled: true,
        inputCostPer1MCents: 10,
        outputCostPer1MCents: 20,
        capabilities: ["tool_use"],
        contextWindow: 32_000,
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
      {
        modelId: "api-proxy-deepseek/premium",
        provider: "api-proxy-deepseek",
        displayName: "premium",
        tier: "tier_c",
        enabled: true,
        inputCostPer1MCents: 1000,
        outputCostPer1MCents: 2000,
        capabilities: ["coding", "reasoning"],
        contextWindow: 200_000,
        updatedAt: "2026-07-19T00:00:00.000Z",
      },
    ]),
  };
});

import { resolveKnowledgeSourceContext } from "../knowledge/context.js";
import { planChildSpawnCapabilityRouting } from "./child-spawn-capability-routing.js";
import { resolveEmployeeModelGate } from "./employee-model-gate.js";
import { upsertEnterpriseModelEntitlement } from "./enterprise-model-entitlement-store.js";
import { resolveModalityExecutorWiring } from "./executor-wiring.js";
import { grantSeatModels } from "./seat-model-grant-store.js";

const mockResolveCtx = vi.mocked(resolveKnowledgeSourceContext);

function makeBaseCfg(extra?: Partial<OpenBotConfig>): OpenBotConfig {
  return {
    gateway: {
      platform: {
        models: {
          mode: "native",
          entitlement: { enforce: "missing-allow" },
        },
      },
    },
    models: {
      providers: {
        "api-proxy-deepseek": {
          baseUrl: "https://api.deepseek.com",
          api: "openai-completions",
          models: [{ id: "cheap" }, { id: "premium" }],
        },
      },
    },
    ...extra,
  } as unknown as OpenBotConfig;
}

function cfgWithImageAndMusic(): OpenBotConfig {
  const base = makeBaseCfg();
  return {
    ...base,
    models: {
      providers: {
        ...base.models?.providers,
        stepfun: {
          baseUrl: "https://api.stepfun.com/v1",
          apiKey: "test-key",
          models: [{ id: STEPFUN_IMAGE_MODEL_ID }],
        },
        suno: {
          baseUrl: "https://api.sunoapi.org/api/v1",
          apiKey: "test-key",
          models: [{ id: SUNO_MUSIC_MODEL_ID }],
        },
      },
    },
    agents: {
      defaults: {
        imageGenerationModel: { primary: `stepfun/${STEPFUN_IMAGE_MODEL_ID}` },
        musicGenerationModel: { primary: `suno/${SUNO_MUSIC_MODEL_ID}` },
      },
    },
  } as unknown as OpenBotConfig;
}

let tempDir = "";
const storeOpts = () => ({
  entitlementStorePath: path.join(tempDir, "ent.json"),
  seatGrantStorePath: path.join(tempDir, "grant.json"),
  planVersionBindingStorePath: path.join(tempDir, "binding.json"),
  platformConnectedModelIdsOverride: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
});

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "gate-wiring-"));
  vi.clearAllMocks();
  mockResolveCtx.mockResolvedValue({
    tenantId: "acme",
    seatId: "seat-1",
    userId: "user-1",
    tenantName: "Acme",
    hasEnterpriseScope: true,
  } as never);
  await upsertEnterpriseModelEntitlement(
    {
      tenantId: "acme",
      planVersionId: "pv-1",
      allowedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    },
    storeOpts().entitlementStorePath,
  );
  await grantSeatModels(
    {
      tenantId: "acme",
      seatId: "seat-1",
      grantedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
    },
    storeOpts().seatGrantStorePath,
  );
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("employee-model-gate production wiring", () => {
  it("without generation endpoints, image/music tasks stay executor_unwired", async () => {
    const result = await resolveEmployeeModelGate({
      cfg: makeBaseCfg(),
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "用 midjourney 画一张海报",
      ...storeOpts(),
    });
    expect(resolveModalityExecutorWiring(makeBaseCfg()).imageGeneration).toBe(false);
    expect(result.capabilityPlan?.failure.kind).toBe("executor_unwired");
    expect(result.capabilityPlan?.failure).toMatchObject({
      kind: "executor_unwired",
      executor: "image_generation",
    });
  });

  it("with Stepfun/Suno config, gate enables image and music wiring on the plan", async () => {
    const cfg = cfgWithImageAndMusic();
    const wiring = resolveModalityExecutorWiring(cfg);
    expect(wiring.imageGeneration).toBe(true);
    expect(wiring.audioMusicGeneration).toBe(true);
    expect(wiring.audioTts).toBe(false);

    const image = await resolveEmployeeModelGate({
      cfg,
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "用 midjourney 画一张海报",
      ...storeOpts(),
    });
    expect(image.capabilityPlan?.failure.kind).toBe("none");
    expect(image.capabilityPlan?.executor).toBe("image_generation");
    expect(image.capabilityPlan?.categoryId).toBe("design.image");

    const music = await resolveEmployeeModelGate({
      cfg,
      gatewayClientUser: "user@acme.test",
      gatewayClientSessionDomain: "employee",
      taskText: "用 suno 写一段配乐",
      ...storeOpts(),
    });
    expect(music.capabilityPlan?.failure.kind).toBe("none");
    expect(music.capabilityPlan?.executor).toBe("audio_music_generation");
    expect(music.capabilityPlan?.categoryId).toBe("audio.music_gen");
  });

  it("child spawn inherits the same config-gated wiring", () => {
    const cfg = cfgWithImageAndMusic();
    const child = planChildSpawnCapabilityRouting({
      cfg,
      taskText: "generate an image poster",
      authorizedModelIds: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      parentPreferredModelOrder: ["api-proxy-deepseek/cheap", "api-proxy-deepseek/premium"],
      modelContextWindows: {
        "api-proxy-deepseek/cheap": 32_000,
        "api-proxy-deepseek/premium": 200_000,
      },
    });
    expect(child.capabilityPlan.failure.kind).toBe("none");
    expect(child.capabilityPlan.executor).toBe("image_generation");
    expect(child.consumedSurface.targetModalityCompleted).toBe(false);
  });
});
