/**
 * RPC + registry end-to-end regression for models.admission wrap-up.
 * Uses an in-process fake gateway that mirrors gateway async lifecycle
 * (prompt taskId, cancel/fingerprint/generation guards, no paid APIs).
 * Covers: online/offline bind, refresh interrupt, cancel+retry, batch
 * partial success, Chinese trial classification via wired preview, and
 * explicit text output constraints.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  __resetModelAdmissionStoreForTest,
  getModelAdmission,
  interruptOrphanedInFlightVerificationTasks,
} from "../model-admission-store.ts";
import { detectTaskCategoryForPreview } from "../routing-decision-preview.ts";
import { previewRoutingDecisionViaService } from "./routing-decision-service.ts";
import {
  createRpcCapabilityVerificationService,
  type AdmissionGatewayRequest,
} from "./rpc-adapter.ts";
import {
  __resetCapabilityVerificationServiceForTest,
  bindCapabilityAdmissionGateway,
  getCapabilityVerificationService,
  isCapabilityAdmissionRpcActive,
} from "./verification-service.ts";

type CapId = string;

type FakeTask = {
  taskId: string;
  modelRef: string;
  capabilityIds: CapId[];
  status: string;
  createdAt: number;
  updatedAt: number;
  results?: Array<Record<string, unknown>>;
  error?: string;
  configFingerprint?: string;
  executionGeneration?: number;
};

type FakeAdmission = {
  modelRef: string;
  tenantSelectable: boolean;
  autoRouting: string;
  autoRoutingTaskCategories: string[];
  capabilityEvidence: Array<Record<string, unknown>>;
  updatedAt: number;
  platformEffective: boolean;
  connectionFingerprint?: string;
  connectionVerifiedAt?: number;
};

function createFakeGateway(opts?: {
  hold?: Map<string, { release: () => void; promise: Promise<void> }>;
  resolveConnectionOk?: (modelRef: string, fp?: string) => boolean;
}) {
  const tasks = new Map<string, FakeTask>();
  const admissions = new Map<string, FakeAdmission>();
  const generation = new Map<string, number>();
  const background = new Map<string, Promise<void>>();
  const hold = opts?.hold;
  const resolveConnectionOk = opts?.resolveConnectionOk ?? (() => true);

  function defaultAdmission(modelRef: string): FakeAdmission {
    return {
      modelRef,
      tenantSelectable: false,
      autoRouting: "disabled",
      autoRoutingTaskCategories: [],
      capabilityEvidence: [],
      updatedAt: Date.now(),
      platformEffective: true,
    };
  }

  function getAdmission(modelRef: string): FakeAdmission {
    return admissions.get(modelRef) ?? defaultAdmission(modelRef);
  }

  async function flush() {
    await Promise.all(background.values());
  }

  async function waitTerminal(taskId: string, timeoutMs = 5_000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const task = tasks.get(taskId);
      if (task && task.status !== "queued" && task.status !== "running") {
        return task;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`task ${taskId} not terminal`);
  }

  function runTask(taskId: string) {
    const work = (async () => {
      const task = tasks.get(taskId);
      if (!task || task.status === "cancelled" || task.status === "interrupted") {
        return;
      }
      tasks.set(taskId, { ...task, status: "running", updatedAt: Date.now() });

      const holdEntry = hold?.get(taskId) ?? hold?.get("__next__");
      if (holdEntry) {
        if (hold?.has("__next__")) {
          hold.delete("__next__");
          hold.set(taskId, holdEntry);
        }
        await holdEntry.promise;
      }

      const latest = tasks.get(taskId);
      if (!latest || latest.status === "cancelled" || latest.status === "interrupted") {
        return;
      }
      if (latest.status !== "queued" && latest.status !== "running") {
        return;
      }

      const connectionOk = resolveConnectionOk(latest.modelRef, latest.configFingerprint);
      const results = latest.capabilityIds.map((id) => {
        if (id === "text_chat") {
          return {
            id,
            label: "文本对话",
            source: "protocol_probe",
            status: connectionOk ? "passed" : "failed",
            testVersion: "gateway-protocol-v1",
            verifiedAt: Date.now(),
            ...(connectionOk ? {} : { failureReason: "连接未经验证" }),
          };
        }
        if (id === "tool_use" || id === "image_generation" || id === "music_generation") {
          return {
            id,
            label: id,
            source: "protocol_probe",
            status: "checker_unavailable",
            testVersion: "gateway-protocol-v1",
            sourceNote: "检查器不可用",
          };
        }
        if (id === "coding") {
          return {
            id,
            label: "编码",
            source: "protocol_probe",
            status: "passed",
            testVersion: "gateway-protocol-v1",
            verifiedAt: Date.now(),
          };
        }
        return {
          id,
          label: id,
          source: "protocol_probe",
          status: "untested",
          testVersion: "gateway-protocol-v1",
        };
      });

      const meaningful = results.filter((r) => r.status === "passed" || r.status === "failed");
      let status = "partial";
      if (meaningful.length === 0) {
        status = "partial";
      } else if (
        meaningful.every((r) => r.status === "passed") &&
        meaningful.length === results.length
      ) {
        status = "succeeded";
      } else if (meaningful.every((r) => r.status === "failed")) {
        status = "failed";
      }

      const gen = latest.executionGeneration ?? 0;
      const currentGen = generation.get(latest.modelRef) ?? 0;
      const generationStale = gen < currentGen;

      const done: FakeTask = {
        ...latest,
        status,
        results,
        updatedAt: Date.now(),
        ...(generationStale
          ? { error: "已被更新的验证任务取代，结果仅保留在历史中，未更新正式证据" }
          : {}),
      };
      tasks.set(taskId, done);

      if (generationStale) {
        return;
      }
      // Refuse late merge if cancelled between compute and write.
      const preMerge = tasks.get(taskId);
      if (!preMerge || preMerge.status === "cancelled" || preMerge.status === "interrupted") {
        return;
      }

      const adm = getAdmission(latest.modelRef);
      const byId = new Map(adm.capabilityEvidence.map((e) => [String(e.id), e]));
      for (const item of results) {
        if (item.status === "passed" || item.status === "failed") {
          byId.set(String(item.id), item);
        }
      }
      admissions.set(latest.modelRef, {
        ...adm,
        capabilityEvidence: [...byId.values()],
        ...(latest.configFingerprint
          ? {
              connectionFingerprint: latest.configFingerprint,
              connectionVerifiedAt: Date.now(),
            }
          : {}),
        updatedAt: Date.now(),
        platformEffective: true,
      });
    })().finally(() => {
      background.delete(taskId);
    });
    background.set(taskId, work);
  }

  const request: AdmissionGatewayRequest = async <T>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T> => {
    if (method === "models.admission.listModelAdmissions") {
      return { admissions: [...admissions.values()] } as T;
    }
    if (method === "models.admission.getModelAdmission") {
      return { admission: getAdmission(String(params?.modelRef)) } as T;
    }
    if (method === "models.admission.createVerificationTask") {
      const modelRef = String(params?.modelRef);
      const capabilityIds = (params?.capabilityIds as CapId[]) ?? [];
      const nextGen = (generation.get(modelRef) ?? 0) + 1;
      generation.set(modelRef, nextGen);
      const taskId = `gcvt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      const now = Date.now();
      const queued: FakeTask = {
        taskId,
        modelRef,
        capabilityIds,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        configFingerprint:
          typeof params?.configFingerprint === "string" ? params.configFingerprint : undefined,
        executionGeneration: nextGen,
      };
      const snapshot = { ...queued };
      tasks.set(taskId, { ...queued });
      // Client connectionOk intentionally ignored even if present in params.
      runTask(taskId);
      return { task: snapshot, authority: "formal" } as T;
    }
    if (method === "models.admission.getVerificationTask") {
      return { task: tasks.get(String(params?.taskId)) ?? null } as T;
    }
    if (method === "models.admission.cancelVerificationTask") {
      const task = tasks.get(String(params?.taskId));
      if (!task) {
        return { task: null } as T;
      }
      if (task.status === "queued" || task.status === "running") {
        const next = { ...task, status: "cancelled", updatedAt: Date.now() };
        tasks.set(task.taskId, next);
        return { task: next } as T;
      }
      return { task } as T;
    }
    if (method === "models.admission.createBatchVerificationTasks") {
      const items = (params?.items as Array<Record<string, unknown>>) ?? [];
      const out = [];
      for (const item of items) {
        out.push(await request("models.admission.createVerificationTask", item));
      }
      return { tasks: out } as T;
    }
    if (method === "models.admission.setRoutingEligibility") {
      const modelRef = String(params?.modelRef);
      const adm = {
        ...getAdmission(modelRef),
        autoRouting: String(params?.autoRouting),
        tenantSelectable: Boolean(params?.tenantSelectable ?? false),
        updatedAt: Date.now(),
        platformEffective: true,
      };
      admissions.set(modelRef, adm);
      return {
        status: "applied",
        modelRef,
        autoRouting: adm.autoRouting,
        admission: adm,
      } as T;
    }
    if (method === "models.admission.previewRoutingDecision") {
      const req = (params?.request ?? {}) as Record<string, unknown>;
      const taskText = typeof req.taskText === "string" ? req.taskText : "";
      const outputType = req.outputType as "text" | "image" | "music" | "audio" | undefined;
      const category = detectTaskCategoryForPreview({
        taskText,
        outputType,
      });
      const candidates = (params?.candidates as Array<{ modelId: string }>) ?? [];
      const primary: string[] = [];
      const excluded: Array<{ modelId: string; reason: string; code: string }> = [];
      for (const c of candidates) {
        const adm = getAdmission(c.modelId);
        const codingOk = adm.capabilityEvidence.some(
          (e) => e.id === "coding" && e.status === "passed",
        );
        if (category === "coding" && !codingOk) {
          excluded.push({
            modelId: c.modelId,
            reason: "编码能力未验证",
            code: "capability_unverified",
          });
        } else if (adm.autoRouting === "disabled") {
          excluded.push({
            modelId: c.modelId,
            reason: "未允许自动路由",
            code: "auto_routing_disabled",
          });
        } else {
          primary.push(c.modelId);
        }
      }
      return {
        preview: {
          requestId: `rp_${Date.now()}`,
          taskCategory: category,
          executorPath: category === "image_generation" ? "image_gen" : "chat",
          selectedModelId: primary[0] ?? null,
          primary,
          fallback: [],
          excluded,
          decisionReason: "后端准入干跑预览（干跑）",
          dryRun: true,
          uiDemo: false,
          backendStatus: "wired",
          requiredCapabilities: category === "coding" ? ["coding"] : ["text_chat"],
          outputType,
        },
      } as T;
    }
    throw new Error(`unexpected method ${method}`);
  };

  return { request, tasks, admissions, flush, waitTerminal, generation };
}

describe("rpc + registry e2e regression", () => {
  beforeEach(() => {
    __resetModelAdmissionStoreForTest();
    __resetCapabilityVerificationServiceForTest();
  });

  afterEach(async () => {
    await bindCapabilityAdmissionGateway(null);
    __resetCapabilityVerificationServiceForTest();
    __resetModelAdmissionStoreForTest();
  });

  it("online bind uses rpc; offline unbind falls back to local_protocol without platformEffective formal from stub", async () => {
    const gw = createFakeGateway();
    const bound = await bindCapabilityAdmissionGateway(gw.request);
    expect(bound.mode).toBe("rpc");
    expect(isCapabilityAdmissionRpcActive()).toBe(true);

    const online = getCapabilityVerificationService();
    expect(online.kind).toBe("rpc");
    const created = await online.createVerificationTask({
      modelRef: "openai/online",
      capabilityIds: ["text_chat"],
      // Client claim must not be required / trusted by RPC path.
      connectionOk: true,
    } as never);
    expect(created.task.taskId).toMatch(/^gcvt_/);
    expect(created.task.status).toBe("queued");
    const done = await gw.waitTerminal(created.task.taskId);
    expect(done.status === "succeeded" || done.status === "partial").toBe(true);

    // Disconnect → local_protocol; must not present as platform-effective from gateway.
    const unbound = await bindCapabilityAdmissionGateway(null);
    expect(unbound.mode).toBe("local_protocol");
    expect(isCapabilityAdmissionRpcActive()).toBe(false);
    expect(getCapabilityVerificationService().kind).toBe("local_protocol");
  });

  it("refresh interrupt orphans in-flight local rows; rpc cancel+retry stays honest", async () => {
    const hold = new Map<string, { release: () => void; promise: Promise<void> }>();
    let release!: () => void;
    const promise = new Promise<void>((r) => {
      release = r;
    });
    const gw = createFakeGateway({ hold });
    await bindCapabilityAdmissionGateway(gw.request);
    const service = createRpcCapabilityVerificationService(gw.request);

    hold.set("__next__", { release, promise });
    const first = await service.createVerificationTask({
      modelRef: "openai/retry",
      capabilityIds: ["text_chat", "tool_use"],
      configFingerprint: "fp-a",
    });
    expect(hold.has(first.task.taskId)).toBe(true);

    const cancelled = await service.cancelVerificationTask({ taskId: first.task.taskId });
    expect(cancelled?.status).toBe("cancelled");
    release();
    await gw.flush();
    const afterLate = await service.getVerificationTask({ taskId: first.task.taskId });
    expect(afterLate?.status).toBe("cancelled");
    expect(
      getModelAdmission("openai/retry").capabilityEvidence.some(
        (e) => e.id === "text_chat" && e.status === "passed",
      ),
    ).toBe(false);

    // Retry after cancel.
    const second = await service.createVerificationTask({
      modelRef: "openai/retry",
      capabilityIds: ["text_chat", "tool_use"],
      configFingerprint: "fp-a",
    });
    const done = await gw.waitTerminal(second.task.taskId);
    expect(done.results?.some((r) => r.id === "text_chat" && r.status === "passed")).toBe(true);
    expect(
      done.results?.some((r) => r.id === "tool_use" && r.status === "checker_unavailable"),
    ).toBe(true);

    // Refresh-style orphan interrupt on local mirrored rows.
    const interrupted = interruptOrphanedInFlightVerificationTasks("已中断，可重试（页面刷新）");
    expect(Array.isArray(interrupted)).toBe(true);
  });

  it("batch partial success does not mark whole batch routing-eligible", async () => {
    const gw = createFakeGateway({
      resolveConnectionOk: (modelRef) => modelRef === "openai/ok",
    });
    await bindCapabilityAdmissionGateway(gw.request);
    const service = createRpcCapabilityVerificationService(gw.request);

    const batch = await service.createBatchVerificationTasks({
      items: [
        { modelRef: "openai/ok", capabilityIds: ["text_chat"] },
        { modelRef: "openai/bad", capabilityIds: ["text_chat"] },
      ],
    });
    expect(batch.tasks).toHaveLength(2);
    await gw.flush();
    for (const entry of batch.tasks) {
      await gw.waitTerminal(entry.task.taskId);
    }

    // Re-fetch via RPC so formal evidence is mirrored into the local store.
    for (const entry of batch.tasks) {
      await service.getVerificationTask({ taskId: entry.task.taskId });
    }
    const okTask = await gw.waitTerminal(batch.tasks[0].task.taskId);
    const badTask = await gw.waitTerminal(batch.tasks[1].task.taskId);
    expect(okTask.results?.some((r) => r.id === "text_chat" && r.status === "passed")).toBe(true);
    expect(badTask.results?.some((r) => r.id === "text_chat" && r.status === "failed")).toBe(true);

    // Explicit: batch must not auto-apply routing eligibility.
    expect(getModelAdmission("openai/bad").autoRouting).not.toBe("eligible");
    expect(getModelAdmission("openai/ok").autoRouting).not.toBe("eligible");
  });

  it("wired Chinese trial preview classifies coding and honors text output constraints", async () => {
    const gw = createFakeGateway();
    await bindCapabilityAdmissionGateway(gw.request);
    const service = createRpcCapabilityVerificationService(gw.request);

    // Seed formal coding evidence + eligibility for one candidate.
    await service.setRoutingEligibility({
      modelRef: "private/coder",
      autoRouting: "eligible",
      tenantSelectable: true,
    });
    // Inject coding passed via gateway admission map through a create+flush.
    const seeded = await service.createVerificationTask({
      modelRef: "private/coder",
      capabilityIds: ["coding", "text_chat"],
      configFingerprint: "fp-c",
    });
    await gw.waitTerminal(seeded.task.taskId);

    expect(detectTaskCategoryForPreview({ taskText: "帮我重构这个模块的类型定义" })).toBe("coding");

    const zh = await previewRoutingDecisionViaService({
      request: {
        taskText: "帮我重构这个模块的类型定义",
        outputType: "text",
      },
      candidates: [
        { modelId: "private/coder", health: "healthy", costTier: "low", contextWindow: 128000 },
        { modelId: "private/other", health: "healthy", costTier: "low", contextWindow: 128000 },
      ],
    });
    expect(zh.backendStatus).toBe("wired");
    expect(zh.uiDemo).toBe(false);
    expect(zh.dryRun).toBe(true);
    expect(zh.taskCategory).toBe("coding");
    expect(zh.banner).toMatch(/后端准入干跑预览|后端决策预览/);

    // Explicit text output must not fall through to image_generation profile.
    expect(
      detectTaskCategoryForPreview({
        taskText: "随便写点",
        outputType: "text",
        taskProfileId: "image_generation",
      } as never),
    ).not.toBe("image_generation");
    const textConstrained = await previewRoutingDecisionViaService({
      request: {
        taskText: "画一张海报",
        outputType: "text",
      },
      candidates: [
        { modelId: "private/coder", health: "healthy", costTier: "low", contextWindow: 128000 },
      ],
    });
    expect(textConstrained.taskCategory).not.toBe("image_generation");
    expect(textConstrained.outputType).toBe("text");
  });

  it("client connectionOk on RPC params is ignored by fake gateway formal path", async () => {
    const gw = createFakeGateway({ resolveConnectionOk: () => false });
    await bindCapabilityAdmissionGateway(gw.request);
    const service = createRpcCapabilityVerificationService(gw.request);
    const created = await service.createVerificationTask({
      modelRef: "openai/forge",
      capabilityIds: ["text_chat"],
    });
    // Even if adapter were to pass connectionOk, gateway fake ignores it.
    await gw.request("models.admission.createVerificationTask", {
      modelRef: "openai/forge2",
      capabilityIds: ["text_chat"],
      connectionOk: true,
    });
    const done = await gw.waitTerminal(created.task.taskId);
    expect(done.results?.find((r) => r.id === "text_chat")?.status).toBe("failed");
  });
});
