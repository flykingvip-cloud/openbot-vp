import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runWithModelFallback } from "../../../agents/model-fallback.js";
import { resolveTrustedRunModalityCompletionEvidence } from "../../../task-outcome/modality-artifact-evidence.js";
import {
  assertExecutorModelAdmitted,
  formatPlatformAdmissionEmptyMessage,
  isPlatformAdmissionEmptyError,
  PlatformAdmissionEmptyError,
} from "./apply-runtime-admission.js";
import { previewRoutingDecision } from "./routing-decision.js";
import { decideRuntimeCapability, resolveTaskCategory } from "./runtime-decision.js";
import { upsertModelAdmission } from "./store.js";
import type { ModelAdmissionRecord } from "./types.js";

function record(
  partial: Partial<ModelAdmissionRecord> & Pick<ModelAdmissionRecord, "modelRef">,
): ModelAdmissionRecord {
  return {
    tenantSelectable: true,
    autoRouting: "eligible",
    autoRoutingTaskCategories: [],
    capabilityEvidence: [],
    updatedAt: 1,
    platformEffective: true,
    ...partial,
  };
}

describe("resolveTaskCategory", () => {
  it("prefers output type, then task text, then profile", () => {
    expect(resolveTaskCategory({ taskText: "重构这段代码", outputType: "image" }).category).toBe(
      "image_generation",
    );
    expect(resolveTaskCategory({ taskText: "画一张活动海报" })).toMatchObject({
      category: "image_generation",
      source: "task_text",
    });
    expect(resolveTaskCategory({ taskText: "为短片配乐" }).category).toBe("music_generation");
    expect(resolveTaskCategory({ taskText: "重构这段代码并补充测试" }).category).toBe("coding");
    expect(
      resolveTaskCategory({
        taskText: "请帮我处理一下",
        taskProfileId: "image_generation",
      }),
    ).toMatchObject({ category: "general_text", source: "profile_fallback" });
    expect(resolveTaskCategory({ taskProfileId: "image_generation" })).toMatchObject({
      category: "image_generation",
      source: "profile_fallback",
    });
  });

  it("names Stepfun and Suno-compatible executors without native claims", () => {
    const image = decideRuntimeCapability({
      role: "executor",
      dryRun: true,
      request: { taskText: "用 midjourney 画一张海报" },
      candidates: [],
    });
    expect(image.executorPath).toBe("图片生成 · Stepfun");
    expect(image.executorPath.toLowerCase()).not.toContain("midjourney");
    expect(image.nativeMidjourneyClaimed).toBe(false);
    expect(image.aorInvoked).toBe(false);
    const music = decideRuntimeCapability({
      role: "executor",
      dryRun: true,
      request: { outputType: "music" },
      candidates: [],
    });
    expect(music.executorPath).toBe("音乐生成 · Suno 兼容");
    expect(music.officialSunoCertified).toBe(false);
    expect(music.executorPath).not.toContain("官方");
  });
});

describe("decideRuntimeCapability", () => {
  const now = 1_700_000_000_000;

  it("does not add models and drops paused, missing, expired, and unverified platform rows", () => {
    const decision = decideRuntimeCapability({
      role: "executor",
      dryRun: false,
      request: {
        taskText: "画一张海报",
        outputType: "image",
        nowMs: now,
        configFingerprint: "fp-now",
      },
      candidates: [
        {
          modelId: "platform/paused",
          scope: "platform",
          record: record({
            modelRef: "platform/paused",
            autoRouting: "paused",
            autoRoutingReason: "管理员暂停",
          }),
        },
        {
          modelId: "platform/missing",
          scope: "platform",
          record: null,
        },
        {
          modelId: "platform/stale",
          scope: "platform",
          record: record({
            modelRef: "platform/stale",
            connectionFingerprint: "fp-old",
            capabilityEvidence: [
              {
                id: "image_generation",
                label: "图片生成",
                source: "protocol_probe",
                status: "passed",
                verifiedAt: now - 10,
                testVersion: "v1",
              },
            ],
          }),
        },
        {
          modelId: "platform/expired",
          scope: "platform",
          record: record({
            modelRef: "platform/expired",
            connectionFingerprint: "fp-now",
            capabilityEvidence: [
              {
                id: "image_generation",
                label: "图片生成",
                source: "protocol_probe",
                status: "passed",
                verifiedAt: now - 10,
                expiresAt: now - 1,
                testVersion: "v1",
              },
            ],
          }),
        },
        {
          modelId: "platform/unchecked",
          scope: "platform",
          record: record({
            modelRef: "platform/unchecked",
            connectionFingerprint: "fp-now",
            capabilityEvidence: [
              {
                id: "image_generation",
                label: "图片生成",
                source: "protocol_probe",
                status: "checker_unavailable",
                testVersion: "v1",
              },
            ],
          }),
        },
        {
          modelId: "platform/ok",
          scope: "platform",
          record: record({
            modelRef: "platform/ok",
            connectionFingerprint: "fp-now",
            capabilityEvidence: [
              {
                id: "image_generation",
                label: "图片生成",
                source: "specialized_eval",
                status: "passed",
                verifiedAt: now - 5,
                expiresAt: now + 1_000,
                qualityScore: 0.8,
                testVersion: "img-v2",
              },
            ],
          }),
        },
        {
          modelId: "ent/seat/mine",
          scope: "enterprise_byok",
          record: record({ modelRef: "ent/seat/mine", autoRouting: "paused" }),
        },
      ],
    });

    expect(decision.authorizedModelIds).toEqual([
      "platform/paused",
      "platform/missing",
      "platform/stale",
      "platform/expired",
      "platform/unchecked",
      "platform/ok",
      "ent/seat/mine",
    ]);
    expect(decision.primary).toEqual(["platform/ok"]);
    expect(decision.fallback).toEqual(["ent/seat/mine"]);
    expect(decision.executableModelIds).not.toContain("platform/paused");
    expect(decision.excluded.map((item) => [item.modelId, item.code])).toEqual([
      ["platform/paused", "auto_routing_disabled"],
      ["platform/missing", "no_admission_record"],
      ["platform/stale", "evidence_fingerprint_mismatch"],
      ["platform/expired", "verification_expired"],
      ["platform/unchecked", "checker_unavailable"],
    ]);
    expect(decision.outOfScopeModelIds).toEqual(["ent/seat/mine"]);
    expect(decision.configVersion).toContain("fp-now");
    expect(decision.evidenceVersion).toContain("img-v2");
    expect(decision.aorInvoked).toBe(false);
  });

  it("keeps an orchestrator for image text without requiring image_generation on the chat model", () => {
    const decision = decideRuntimeCapability({
      role: "orchestrator",
      dryRun: false,
      request: { taskText: "画一张海报", nowMs: now },
      candidates: [
        {
          modelId: "platform/chat",
          scope: "platform",
          record: record({
            modelRef: "platform/chat",
            capabilityEvidence: [
              {
                id: "text_chat",
                label: "文本对话",
                source: "protocol_probe",
                status: "passed",
                testVersion: "t1",
              },
            ],
          }),
        },
      ],
    });
    expect(decision.taskCategory).toBe("image_generation");
    expect(decision.executorIdentity).toBe("stepfun_image");
    expect(decision.primary).toEqual(["platform/chat"]);
    expect(decision.requiredCapabilities).toEqual([]);
  });

  it("treats rate limit as transient and illegal scores as unverified", () => {
    const limited = decideRuntimeCapability({
      role: "orchestrator",
      dryRun: false,
      request: { taskText: "hello", nowMs: now },
      candidates: [
        {
          modelId: "platform/hot",
          scope: "platform",
          transientLimited: true,
          record: record({ modelRef: "platform/hot" }),
        },
      ],
    });
    expect(limited.degradation).toBe("transient_rate_limit");
    expect(limited.excluded[0]?.code).toBe("transient_rate_limit");
    expect(new PlatformAdmissionEmptyError(limited).permanent).toBe(false);

    const scored = decideRuntimeCapability({
      role: "executor",
      dryRun: true,
      request: { outputType: "music", nowMs: now },
      candidates: [
        {
          modelId: "platform/music",
          scope: "platform",
          record: record({
            modelRef: "platform/music",
            capabilityEvidence: [
              {
                id: "music_generation",
                label: "音乐生成",
                source: "specialized_eval",
                status: "passed",
                qualityScore: 4,
                testVersion: "bad",
              },
            ],
          }),
        },
      ],
    });
    expect(scored.excluded[0]?.code).toBe("capability_unverified");
    expect(scored.primary).toEqual([]);
  });

  it("matches preview exclusions for the same platform rows", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-admit-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission(
      "platform/ok",
      {
        autoRouting: "eligible",
        capabilityEvidence: [
          {
            id: "coding",
            label: "代码",
            source: "protocol_probe",
            status: "passed",
            testVersion: "c1",
          },
        ],
      },
      storePath,
    );
    const request = { taskText: "重构模块", outputType: "text" as const };
    const preview = await previewRoutingDecision({
      storePath,
      request,
      candidates: [
        { modelId: "platform/ok", health: "healthy", costTier: "low", contextWindow: 8000 },
        { modelId: "platform/other", health: "healthy" },
      ],
    });
    expect(preview.dryRun).toBe(true);
    expect(preview.primary).toEqual(["platform/ok"]);
    expect(preview.excluded.find((item) => item.modelId === "platform/other")?.code).toBe(
      "no_admission_record",
    );
    expect(preview.decisionReason).toContain("后端准入干跑预览");
    expect(preview.aorInvoked).toBe(false);
    expect(preview.nativeMidjourneyClaimed).toBe(false);
  });
});

describe("runWithModelFallback platform admission", () => {
  it("skips a paused platform model and does not let preferred order reinsert it", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-fallback-admit-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission(
      "openai/paused",
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    await upsertModelAdmission("openai/ok", { autoRouting: "eligible" }, storePath);
    const run = vi.fn(async (_provider: string, _model: string) => "done");
    const result = await runWithModelFallback({
      cfg: {},
      provider: "openai",
      model: "paused",
      fallbacksOverride: ["openai/ok"],
      preferredModelOrder: ["openai/paused", "openai/ok"],
      runtimeAdmission: {
        storePath,
        platformModelIds: ["openai/paused", "openai/ok"],
        discoverPlatformScope: false,
        taskText: "你好",
      },
      run,
    });
    expect(result.result).toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toBe("openai");
    expect(run.mock.calls[0]?.[1]).toBe("ok");
  });

  it("fails closed when every platform candidate is excluded", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-fallback-empty-"));
    const storePath = path.join(dir, "admission.json");
    const run = vi.fn(async (_provider: string, _model: string) => "nope");
    await expect(
      runWithModelFallback({
        cfg: {},
        provider: "openai",
        model: "new",
        fallbacksOverride: [],
        runtimeAdmission: {
          storePath,
          platformModelIds: ["openai/new"],
          discoverPlatformScope: false,
        },
        run,
      }),
    ).rejects.toMatchObject({ code: "PLATFORM_ADMISSION_EMPTY" });
    expect(run).not.toHaveBeenCalled();
  });

  it("leaves enterprise BYOK and personal BYOK outside platform admission", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-fallback-byok-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission(
      "openai/mine",
      { autoRouting: "paused", autoRoutingReason: "should not apply" },
      storePath,
    );
    const personal = vi.fn(async (_provider: string, _model: string) => "personal");
    await runWithModelFallback({
      cfg: {},
      provider: "openai",
      model: "mine",
      fallbacksOverride: [],
      runtimeAdmission: {
        storePath,
        platformModelIds: ["openai/mine"],
        personalByokModelIds: ["openai/mine"],
        discoverPlatformScope: false,
      },
      run: personal,
    });
    expect(personal).toHaveBeenCalledTimes(1);

    await upsertModelAdmission(
      "openai/paused",
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    const enterprise = vi.fn(async (_provider: string, _model: string) => "ent-ok");
    await runWithModelFallback({
      cfg: {},
      provider: "ent",
      model: "hash/gpt",
      fallbacksOverride: ["openai/paused"],
      runtimeAdmission: {
        storePath,
        platformModelIds: ["openai/paused"],
        discoverPlatformScope: false,
      },
      run: enterprise,
    });
    expect(enterprise).toHaveBeenCalledTimes(1);
    expect(enterprise.mock.calls[0]?.[0]).toBe("ent");
    expect(enterprise.mock.calls[0]?.[1]).toBe("hash/gpt");
  });

  it("re-decides on the next run after a model is paused", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-fallback-gen-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission("openai/m", { autoRouting: "eligible" }, storePath);
    const runtime = {
      storePath,
      platformModelIds: ["openai/m"],
      discoverPlatformScope: false as const,
    };
    const first = vi.fn(async (_provider: string, _model: string) => "one");
    await runWithModelFallback({
      cfg: {},
      provider: "openai",
      model: "m",
      fallbacksOverride: [],
      runtimeAdmission: runtime,
      run: first,
    });
    await upsertModelAdmission(
      "openai/m",
      { autoRouting: "paused", autoRoutingReason: "后来暂停" },
      storePath,
    );
    const second = vi.fn(async (_provider: string, _model: string) => "two");
    await expect(
      runWithModelFallback({
        cfg: {},
        provider: "openai",
        model: "m",
        fallbacksOverride: [],
        runtimeAdmission: runtime,
        run: second,
      }),
    ).rejects.toSatisfy((err: unknown) => isPlatformAdmissionEmptyError(err));
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});

describe("entry fixtures through real runWithModelFallback", () => {
  async function rejectBeforeRun(params: { taskText: string; preferredModelOrder?: string[] }) {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-entry-admit-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission(
      "openai/paused",
      { autoRouting: "paused", autoRoutingReason: "管理员暂停" },
      storePath,
    );
    const run = vi.fn(async (_provider: string, _model: string) => "should-not-run");
    let thrown: unknown;
    try {
      await runWithModelFallback({
        cfg: {},
        provider: "openai",
        model: "paused",
        fallbacksOverride: ["openai/missing"],
        ...(params.preferredModelOrder ? { preferredModelOrder: params.preferredModelOrder } : {}),
        runtimeAdmission: {
          storePath,
          platformModelIds: ["openai/paused", "openai/missing"],
          discoverPlatformScope: false,
          taskText: params.taskText,
        },
        run,
      });
    } catch (err) {
      thrown = err;
    }
    expect(isPlatformAdmissionEmptyError(thrown)).toBe(true);
    if (!isPlatformAdmissionEmptyError(thrown)) {
      return;
    }
    expect(thrown.code).toBe("PLATFORM_ADMISSION_EMPTY");
    expect(run).not.toHaveBeenCalled();
    expect(formatPlatformAdmissionEmptyMessage(thrown.decision)).toContain("openai/paused");
    expect(formatPlatformAdmissionEmptyMessage(thrown.decision)).toContain("openai/missing");
  }

  it("chat orchestrator task text rejects paused and unrecorded platform models before run", async () => {
    await rejectBeforeRun({
      taskText: "画一张海报",
      preferredModelOrder: ["openai/paused", "openai/missing"],
    });
  });

  it("followup prompt rejects paused and unrecorded platform models before run", async () => {
    await rejectBeforeRun({ taskText: "继续处理上一问" });
  });

  it("CLI message rejects paused and unrecorded platform models before run", async () => {
    await rejectBeforeRun({ taskText: "重构这段代码" });
  });

  it("Routine prompt rejects paused and unrecorded platform models before run", async () => {
    await rejectBeforeRun({ taskText: "每日摘要" });
  });

  it("subagent child order cannot reinsert a paused platform model before run", async () => {
    await rejectBeforeRun({
      taskText: "子任务：写测试",
      preferredModelOrder: ["openai/paused", "openai/missing"],
    });
  });
});

describe("modality executor admission", () => {
  it("refuses an unverified in-scope image model before generation", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-exec-admit-"));
    const storePath = path.join(dir, "admission.json");
    await upsertModelAdmission("stepfun/step-image-edit-2", { autoRouting: "eligible" }, storePath);
    await expect(
      assertExecutorModelAdmitted({
        modelRef: "stepfun/step-image-edit-2",
        outputType: "image",
        taskText: "海报",
        storePath,
        platformModelIds: ["stepfun/step-image-edit-2"],
      }),
    ).rejects.toMatchObject({ code: "PLATFORM_ADMISSION_EMPTY" });
  });
});

describe("image and music completion evidence", () => {
  it("does not treat a successful chat turn as image or music completion", () => {
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "image_generation",
        success: true,
        runId: "run-1",
      }),
    ).toBeUndefined();
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "audio_music_generation",
        success: true,
        runId: "run-1",
        artifacts: [{ toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" }],
      }),
    ).toBeUndefined();
    expect(
      resolveTrustedRunModalityCompletionEvidence({
        targetModality: "image_generation",
        success: true,
        runId: "run-1",
        artifacts: [{ toolName: "image_gen", relativePath: ".openbot/generated-images/a.png" }],
      })?.kind,
    ).toBe("execution_artifact");
  });
});
