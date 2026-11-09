import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runWithModelFallback } from "../../../agents/model-fallback.js";
import type { OpenBotConfig } from "../../../config/types.js";
import { recordModelProbeResults } from "../model-probe-store.js";
import {
  filterModelCandidatesByPlatformAdmission,
  formatPlatformAdmissionEmptyMessage,
} from "./apply-runtime-admission.js";
import { readStoredModelAdmissions, upsertModelAdmission } from "./store.js";
import { POOLED_HEALTHY_ADMISSION_REASON } from "./sync-pooled-admission.js";

const MODEL_REF = "api-proxy-deepseek/deepseek-v4-flash";

function pooledConfig(modelRef = MODEL_REF, allowlisted = true): OpenBotConfig {
  const slash = modelRef.indexOf("/");
  const provider = modelRef.slice(0, slash);
  const model = modelRef.slice(slash + 1);
  return {
    models: {
      providers: {
        [provider]: {
          models: [{ id: model, name: "DeepSeek V4 Flash" }],
        },
      },
    },
    agents: {
      defaults: {
        models: allowlisted ? { [modelRef]: { alias: "DeepSeek V4 Flash" } } : {},
      },
    },
  } as OpenBotConfig;
}

async function writeProbe(storePath: string, modelRef: string, status: string) {
  const slash = modelRef.indexOf("/");
  await recordModelProbeResults(
    {
      finishedAt: 1,
      results: [
        {
          provider: modelRef.slice(0, slash),
          model: modelRef,
          label: "DeepSeek V4 Flash",
          source: "models.json",
          status,
        },
      ],
    },
    storePath,
  );
}

async function tempPair(prefix: string) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  return {
    dir,
    storePath: path.join(dir, "admission.json"),
    probeStorePath: path.join(dir, "probes.json"),
  };
}

describe("pooled healthy platform admission sync", () => {
  it("lets chat call an allowlisted probe-ok model that had no admission row", async () => {
    const { storePath, probeStorePath } = await tempPair("openbot-pool-admit-");
    await writeProbe(probeStorePath, MODEL_REF, "ok");
    const run = vi.fn(async (_provider: string, _model: string) => "hello");
    const result = await runWithModelFallback({
      cfg: {},
      provider: "api-proxy-deepseek",
      model: "deepseek-v4-flash",
      fallbacksOverride: [],
      runtimeAdmission: {
        storePath,
        probeStorePath,
        cfg: pooledConfig(),
        platformModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "你好",
      },
      run,
    });

    expect(result.result).toBe("hello");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("api-proxy-deepseek");
    expect(run.mock.calls[0]?.[1]).toBe("deepseek-v4-flash");
    const stored = await readStoredModelAdmissions(storePath);
    expect(stored[MODEL_REF]?.autoRouting).toBe("eligible");
    expect(stored[MODEL_REF]?.autoRoutingReason).toBe(POOLED_HEALTHY_ADMISSION_REASON);
    expect(stored[MODEL_REF]?.tenantSelectable).toBe(false);
  });

  it("lets a coding prompt call an allowlisted probe-ok model without coding evidence", async () => {
    const { storePath, probeStorePath } = await tempPair("openbot-pool-coding-");
    await writeProbe(probeStorePath, MODEL_REF, "ok");
    const run = vi.fn(async () => "refactored");
    const result = await runWithModelFallback({
      cfg: {},
      provider: "api-proxy-deepseek",
      model: "deepseek-v4-flash",
      fallbacksOverride: [],
      runtimeAdmission: {
        storePath,
        probeStorePath,
        cfg: pooledConfig(),
        platformModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "重构这段代码并补充测试",
      },
      run,
    });

    expect(result.result).toBe("refactored");
    expect(run).toHaveBeenCalledTimes(1);
    const stored = await readStoredModelAdmissions(storePath);
    expect(stored[MODEL_REF]?.autoRouting).toBe("eligible");
    expect(stored[MODEL_REF]?.capabilityEvidence ?? []).toEqual([]);
  });

  it("keeps an admin pause and still refuses that model", async () => {
    const { storePath, probeStorePath } = await tempPair("openbot-pool-pause-");
    await writeProbe(probeStorePath, MODEL_REF, "ok");
    await upsertModelAdmission(
      MODEL_REF,
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    const filtered = await filterModelCandidatesByPlatformAdmission({
      candidates: [{ provider: "api-proxy-deepseek", model: "deepseek-v4-flash" }],
      runtime: {
        storePath,
        probeStorePath,
        cfg: pooledConfig(),
        platformModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "你好",
      },
    });
    expect(filtered.candidates).toEqual([]);
    expect(filtered.decision?.excluded[0]?.code).toBe("auto_routing_disabled");
    const stored = await readStoredModelAdmissions(storePath);
    expect(stored[MODEL_REF]?.autoRouting).toBe("paused");
    expect(stored[MODEL_REF]?.autoRoutingReason).toBe("管理员暂停");
  });

  it("does not admit a platform model that is not allowlisted or whose probe failed", async () => {
    const notPooled = await tempPair("openbot-pool-skip-");
    await writeProbe(notPooled.probeStorePath, MODEL_REF, "ok");
    const unpooled = await filterModelCandidatesByPlatformAdmission({
      candidates: [{ provider: "api-proxy-deepseek", model: "deepseek-v4-flash" }],
      runtime: {
        storePath: notPooled.storePath,
        probeStorePath: notPooled.probeStorePath,
        cfg: pooledConfig(MODEL_REF, false),
        platformModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "你好",
      },
    });
    expect(unpooled.candidates).toEqual([]);
    expect(unpooled.decision?.excluded[0]?.code).toBe("no_admission_record");
    expect(formatPlatformAdmissionEmptyMessage(unpooled.decision!)).toContain(
      "没有平台准入记录，不能当作已验证或已允许自动路由",
    );
    expect(await readStoredModelAdmissions(notPooled.storePath)).toEqual({});

    const failed = await tempPair("openbot-pool-fail-");
    await writeProbe(failed.probeStorePath, MODEL_REF, "auth");
    const unhealthy = await filterModelCandidatesByPlatformAdmission({
      candidates: [{ provider: "api-proxy-deepseek", model: "deepseek-v4-flash" }],
      runtime: {
        storePath: failed.storePath,
        probeStorePath: failed.probeStorePath,
        cfg: pooledConfig(),
        platformModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "你好",
      },
    });
    expect(unhealthy.decision?.excluded[0]?.code).toBe("no_admission_record");
    expect(await readStoredModelAdmissions(failed.storePath)).toEqual({});
  });

  it("does not write a row for an unscoped or personal model", async () => {
    const unscoped = await tempPair("openbot-pool-unscoped-");
    await writeProbe(unscoped.probeStorePath, MODEL_REF, "ok");
    const open = await filterModelCandidatesByPlatformAdmission({
      candidates: [{ provider: "api-proxy-deepseek", model: "deepseek-v4-flash" }],
      runtime: {
        storePath: unscoped.storePath,
        probeStorePath: unscoped.probeStorePath,
        cfg: pooledConfig(),
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
        taskText: "你好",
      },
    });
    expect(open.engaged).toBe(false);
    expect(open.candidates).toHaveLength(1);
    expect(await readStoredModelAdmissions(unscoped.storePath)).toEqual({});

    const personalDir = await tempPair("openbot-pool-personal-");
    await writeProbe(personalDir.probeStorePath, MODEL_REF, "ok");
    const personal = await filterModelCandidatesByPlatformAdmission({
      candidates: [{ provider: "api-proxy-deepseek", model: "deepseek-v4-flash" }],
      runtime: {
        storePath: personalDir.storePath,
        probeStorePath: personalDir.probeStorePath,
        cfg: pooledConfig(),
        platformModelIds: [MODEL_REF],
        personalByokModelIds: [MODEL_REF],
        discoverPlatformScope: false,
        syncPooledHealthyAdmission: true,
      },
    });
    expect(personal.engaged).toBe(false);
    expect(personal.candidates).toHaveLength(1);
    expect(await readStoredModelAdmissions(personalDir.storePath)).toEqual({});
  });
});
