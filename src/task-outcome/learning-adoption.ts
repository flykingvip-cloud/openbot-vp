/**
 * W4 residual: upstream **explicit** adoption evidence → tip.adoptedAssetIds.
 *
 * Reuses tip `experienceExposure` + `recordLearningExperienceStage(stage=adopted)`.
 * Callers must pass asset ids with real adoption evidence — never copy injected ids.
 * Without tip exposure scopes already attached, this is a no-op (no agentId guess).
 */
import path from "node:path";
import { resolveAgentDir } from "../agents/agent-scope.js";
import { recordLearningExperienceStage } from "../auto-reply/reply/learning-recall.js";
import type { OpenBotConfig } from "../config/config.js";
import { newFencingToken, TaskOutcomeResultService } from "./result-service.js";
import { TASK_OUTCOME_STORE_DIRNAME } from "./runtime-from-runner.js";
import { DurableTaskOutcomeStore } from "./store.js";
import type { ExperienceExposureState, TaskOutcomeRecord, TrustedScope } from "./types.js";

export type AttachAdoptedLearningAssetsParams = {
  taskId: string;
  scope: TrustedScope;
  /** Explicit adoption evidence only — must be a subset of tip exposure when present. */
  adoptedAssetIds: readonly string[];
  fencingToken?: string;
};

export type AttachAdoptedLearningAssetsResult =
  | { ok: true; record: TaskOutcomeRecord; mergedIds: string[]; stageRecorded: number }
  | { ok: false; code: string; message: string };

function normalizeIds(ids: readonly string[]): string[] {
  return [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
}

/**
 * Merge explicit adoptedAssetIds onto tip experienceExposure and record stage=adopted
 * for the intersection with tip exposure scopes (when scopes exist).
 */
export async function attachAdoptedLearningAssetsToTask(
  cfg: OpenBotConfig,
  agentId: string,
  params: AttachAdoptedLearningAssetsParams,
): Promise<AttachAdoptedLearningAssetsResult> {
  const adopted = normalizeIds(params.adoptedAssetIds);
  if (adopted.length === 0) {
    return { ok: false, code: "empty_adopted", message: "adoptedAssetIds required (explicit)" };
  }
  const taskId = params.taskId.trim();
  if (!taskId) {
    return { ok: false, code: "missing_task", message: "taskId required" };
  }
  const root = path.join(resolveAgentDir(cfg, agentId), TASK_OUTCOME_STORE_DIRNAME);
  const store = new DurableTaskOutcomeStore(root);
  const tip = store.loadTask(taskId);
  if (!tip) {
    return { ok: false, code: "task_not_found", message: `no tip for ${taskId}` };
  }
  const exposure = tip.experienceExposure;
  if (!exposure || exposure.scopes.length === 0) {
    // No tip exposure → cannot bind adoption without guessing injected/pending by agentId.
    return {
      ok: false,
      code: "missing_exposure",
      message: "tip has no experienceExposure scopes; attach exposure first",
    };
  }
  const exposed = new Set(exposure.scopes.flatMap((s) => s.assetIds));
  const inExposure = adopted.filter((id) => exposed.has(id));
  if (inExposure.length === 0) {
    return {
      ok: false,
      code: "adopted_not_in_exposure",
      message: "adopted ids must intersect tip exposure (no invent)",
    };
  }
  const merged = [
    ...new Set([
      ...(exposure.adoptedAssetIds ?? []).map((id) => id.trim()).filter(Boolean),
      ...inExposure,
    ]),
  ];
  const nextExposure: ExperienceExposureState = {
    ...exposure,
    adoptedAssetIds: merged,
  };
  const service = new TaskOutcomeResultService({ store, submittedBy: "learning-adoption" });
  const fencingToken = params.fencingToken?.trim() || tip.fencingToken || newFencingToken();
  const attached = service.submit(
    taskId,
    {
      type: "set_experience_exposure",
      experienceExposure: nextExposure,
      expectedVersion: tip.outcomeVersion,
      fencingToken,
    },
    { requiredScope: params.scope, commandId: `adopt:${taskId}:${merged.join(",")}` },
  );
  if (!attached.ok) {
    return {
      ok: false,
      code: attached.code,
      message: "message" in attached ? String(attached.message) : attached.code,
    };
  }

  // Stage counters: only assets in their tip scopes (explicit, not all injected).
  let stageRecorded = 0;
  for (const scopeRow of exposure.scopes) {
    const ids = inExposure.filter((id) => scopeRow.assetIds.includes(id));
    if (ids.length === 0) {
      continue;
    }
    await recordLearningExperienceStage({
      scopeId: scopeRow.scopeId,
      assetIds: ids,
      stage: "adopted",
    });
    stageRecorded += ids.length;
  }

  return { ok: true, record: attached.record, mergedIds: merged, stageRecorded };
}

/**
 * Pure merge helper for recordRunnerTurnOutcome: fold explicit adopted ids into tip exposure.
 * Returns undefined when no tip exposure or no intersecting ids (never invents exposure).
 */
export function mergeAdoptedIntoExperienceExposure(
  exposure: ExperienceExposureState | undefined,
  adoptedAssetIds: readonly string[] | undefined,
): ExperienceExposureState | undefined {
  if (!exposure || exposure.scopes.length === 0) {
    return undefined;
  }
  const adopted = normalizeIds(adoptedAssetIds ?? []);
  if (adopted.length === 0) {
    return undefined;
  }
  const exposed = new Set(exposure.scopes.flatMap((s) => s.assetIds));
  const inExposure = adopted.filter((id) => exposed.has(id));
  if (inExposure.length === 0) {
    return undefined;
  }
  return {
    ...exposure,
    adoptedAssetIds: [
      ...new Set([
        ...(exposure.adoptedAssetIds ?? []).map((id) => id.trim()).filter(Boolean),
        ...inExposure,
      ]),
    ],
  };
}
