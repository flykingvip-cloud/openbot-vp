/**
 * merge-request.ts — Tip C lane.requestMerge (dual-seal + match-head → MergePort).
 *
 * Real merge only after implementSeal ∧ acceptSeal ∧ matchHead(tipSha).
 * Does not open Worker/chat/collab live paths; flag still default OFF at RPC.
 */

import { updateTask } from "../supervisor/store.js";
import {
  getDefaultMergePort,
  MergePortError,
  type MergePort,
  type MergePortMethod,
  type MergePortResult,
} from "./merge-port.js";
import { buildFocusSummary, buildLaneProjection, computeMissingKeys } from "./projection.js";
import { assertPath1DualSealAuthority } from "./publish-gate.js";
import { DeliveryLaneError } from "./service.js";
import { getLane, updateLane } from "./store.js";
import type { DeliveryLane, LaneProjection, LaneSealVerdict } from "./types.js";

const PASSING_VERDICTS: ReadonlySet<LaneSealVerdict> = new Set(["PASS", "REVIEW_PASS"]);

export type RequestMergeInput = {
  laneId: string;
  storeDir?: string;
  supervisorStoreDir?: string;
  /**
   * Observed HEAD at call time. When set and ≠ lane.tipSha → refuse (drift)
   * without invoking MergePort.
   */
  observedHeadSha?: string;
  method?: MergePortMethod;
  /** Injectable port; default = gh pr merge adapter. */
  mergePort?: MergePort;
  /** Repo cwd for default gh adapter. */
  cwd?: string;
};

async function projectOntoTask(
  lane: DeliveryLane,
  opts: { supervisorStoreDir?: string; focusSummary?: string },
): Promise<LaneProjection> {
  const projection = buildLaneProjection(lane, opts.focusSummary);
  if (!lane.taskId?.trim()) {
    return projection;
  }
  try {
    await updateTask(
      lane.taskId,
      (task) => ({
        ...task,
        laneId: lane.laneId,
        laneProjection: projection,
      }),
      opts.supervisorStoreDir,
    );
  } catch (err) {
    if (err instanceof Error && /not found/i.test(err.message)) {
      return projection;
    }
    throw err;
  }
  return projection;
}

/**
 * Re-check dual seals + match-head, then invoke MergePort exactly once on success.
 * Forged / missing / invalidated seals, verdict fail, or tipSha drift → REFUSED
 * and MergePort is never called.
 */
export async function requestMerge(input: RequestMergeInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
  mergeResult: MergePortResult;
}> {
  const current = await getLane(input.laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }

  const observed = input.observedHeadSha?.trim();
  if (observed) {
    const tip = current.tipSha?.trim();
    if (!tip || observed !== tip) {
      throw new DeliveryLaneError(
        `merge refused: tipSha drift (observed=${observed.slice(0, 12)} tip=${(tip ?? "").slice(0, 12) || "none"})`,
        "REFUSED",
      );
    }
    // Refresh headSha to observed before missing-key check when caller supplies it.
    if (current.headSha?.trim() !== observed) {
      await updateLane(input.laneId, (lane) => ({ ...lane, headSha: observed }), input.storeDir);
    }
  }

  const laneForCheck =
    observed && current.headSha?.trim() !== observed ? { ...current, headSha: observed } : current;

  const missing = computeMissingKeys(laneForCheck);
  if (missing.length > 0) {
    throw new DeliveryLaneError(
      `merge refused: missing ${missing.join(", ")} (need implementSeal ∧ acceptSeal ∧ match-head)`,
      "REFUSED",
    );
  }

  const impl = laneForCheck.implementSeal!;
  const accept = laneForCheck.acceptSeal!;
  if (!PASSING_VERDICTS.has(impl.verdict) || !PASSING_VERDICTS.has(accept.verdict)) {
    throw new DeliveryLaneError(
      "merge refused: implementSeal and acceptSeal must have PASS/REVIEW_PASS verdict",
      "REFUSED",
    );
  }

  // Treat invalidated / forged tip binding as refuse even if computeMissingKeys raced.
  const tipSha = laneForCheck.tipSha!.trim();
  if (impl.tipSha.trim() !== tipSha || accept.tipSha.trim() !== tipSha) {
    throw new DeliveryLaneError("merge refused: seal tipSha does not match lane tipSha", "REFUSED");
  }
  if (impl.invalidatedAt || accept.invalidatedAt) {
    throw new DeliveryLaneError("merge refused: seal invalidated", "REFUSED");
  }

  const path1Gate = assertPath1DualSealAuthority(laneForCheck);
  if (!path1Gate.allowed) {
    throw new DeliveryLaneError(`merge refused: ${path1Gate.reason}`, "REFUSED");
  }

  const prNumber = laneForCheck.prNumber;
  if (typeof prNumber !== "number" || !Number.isFinite(prNumber) || prNumber <= 0) {
    throw new DeliveryLaneError(
      "merge refused: lane.prNumber is required for MergePort",
      "REFUSED",
    );
  }

  const method: MergePortMethod = input.method ?? "squash";
  const port = input.mergePort ?? getDefaultMergePort();

  let mergeResult: MergePortResult;
  try {
    mergeResult = await port.merge({
      prNumber,
      tipSha,
      method,
      ...(input.cwd ? { cwd: input.cwd } : {}),
    });
  } catch (err) {
    if (err instanceof MergePortError) {
      throw new DeliveryLaneError(`merge refused: ${err.message}`, "REFUSED");
    }
    throw err;
  }

  const next = await updateLane(
    input.laneId,
    (lane) => ({
      ...lane,
      stage: "merged",
      mode: "merge",
      headSha: tipSha,
      lastMerge: {
        at: new Date().toISOString(),
        method: mergeResult.method,
        prNumber: mergeResult.prNumber,
        tipSha: mergeResult.tipSha,
      },
    }),
    input.storeDir,
  );

  const projection = await projectOntoTask(next, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(next),
  });
  return { lane: next, projection, mergeResult };
}
