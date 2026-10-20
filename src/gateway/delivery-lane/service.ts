/**
 * service.ts — DeliveryLane attach / focus / seal / setMode / requestMergeReady.
 *
 * Tip A guards:
 *  - requestMergeReady requires implementSeal ∧ acceptSeal ∧ match-head
 *  - tipSha change invalidates downstream seals
 *  - path-1 on → refuse same-origin acceptSeal; off → weak same-origin OK
 *
 * Tip B: setLaneMode enters accept|review for capability mutex (see mode-policy.ts).
 * Tip C: real merge is lane.requestMerge (merge-request.ts) via MergePort — not here.
 * Tip D: path-1 refuse same-origin + implement/accept self-sign; handoff bridge separate.
 * Does NOT edit TASK_TRANSITIONS.
 */

import crypto from "node:crypto";
import { updateTask } from "../supervisor/store.js";
import { isDeliveryLanePath1CrossBotEnabled } from "./feature.js";
import { buildFocusSummary, buildLaneProjection, computeMissingKeys } from "./projection.js";
import { assertPath1DualSealAuthority, canPublishLaneAcceptSeal } from "./publish-gate.js";
import { createLane, getLane, updateLane } from "./store.js";
import { getDeliveryLaneTemplate } from "./templates.js";
import type {
  DeliveryLane,
  EvidencePackage,
  LaneMode,
  LaneProjection,
  LaneSeal,
  LaneSealIssuer,
  LaneSealKind,
  LaneSealVerdict,
} from "./types.js";

export class DeliveryLaneError extends Error {
  readonly code: "UNAVAILABLE" | "INVALID_REQUEST" | "NOT_FOUND" | "REFUSED";

  constructor(
    message: string,
    code: "UNAVAILABLE" | "INVALID_REQUEST" | "NOT_FOUND" | "REFUSED" = "INVALID_REQUEST",
  ) {
    super(message);
    this.name = "DeliveryLaneError";
    this.code = code;
  }
}

export type AttachLaneInput = {
  templateId: string;
  taskId?: string;
  agentId?: string;
  tipSha?: string;
  headSha?: string;
  prNumber?: number;
  /** Override path-1; default from feature/env. */
  path1CrossBotEnabled?: boolean;
  laneId?: string;
  storeDir?: string;
  /** Supervisor tasks store dir when projecting onto a task. */
  supervisorStoreDir?: string;
};

export type SealLaneInput = {
  laneId: string;
  kind: LaneSealKind;
  verdict: LaneSealVerdict;
  tipSha: string;
  issuer: LaneSealIssuer;
  evidence?: EvidencePackage;
  ownerCosignUserId?: string;
  /** When sealing, optionally refresh headSha for match-head. */
  headSha?: string;
  storeDir?: string;
  supervisorStoreDir?: string;
};

export type RequestMergeReadyInput = {
  laneId: string;
  storeDir?: string;
  supervisorStoreDir?: string;
};

export type FocusLaneInput = {
  laneId: string;
  storeDir?: string;
  supervisorStoreDir?: string;
};

/** Tip B: implement|review|accept only — merge mode is set by requestMergeReady (Tip C merge tools). */
export type SetLaneModeInput = {
  laneId: string;
  mode: Exclude<LaneMode, "merge">;
  storeDir?: string;
  supervisorStoreDir?: string;
};

const PASSING_VERDICTS: ReadonlySet<LaneSealVerdict> = new Set(["PASS", "REVIEW_PASS"]);

function nowIso(): string {
  return new Date().toISOString();
}

function invalidateSeal(seal: LaneSeal | undefined, reason: string): LaneSeal | undefined {
  if (!seal || seal.invalidatedAt) {
    return seal;
  }
  return { ...seal, invalidatedAt: nowIso(), invalidateReason: reason };
}

function invalidateDownstreamSeals(lane: DeliveryLane, reason: string): DeliveryLane {
  return {
    ...lane,
    implementSeal: invalidateSeal(lane.implementSeal, reason),
    acceptSeal: invalidateSeal(lane.acceptSeal, reason),
    reviewSeals: lane.reviewSeals?.map((s) => invalidateSeal(s, reason)!),
  };
}

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
    // Task may not exist yet / store unavailable — lane still valid; caller sees projection.
    if (err instanceof Error && /not found/i.test(err.message)) {
      return projection;
    }
    throw err;
  }
  return projection;
}

export async function attachLane(input: AttachLaneInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
}> {
  const templateId = input.templateId.trim();
  const template = getDeliveryLaneTemplate(templateId);
  if (!template) {
    throw new DeliveryLaneError(`unknown templateId: ${templateId}`);
  }
  const path1 =
    typeof input.path1CrossBotEnabled === "boolean"
      ? input.path1CrossBotEnabled
      : isDeliveryLanePath1CrossBotEnabled();
  const createdAt = nowIso();
  const lane: DeliveryLane = {
    laneId: input.laneId?.trim() || `lane_${crypto.randomUUID()}`,
    templateId: template.id,
    taskId: input.taskId?.trim() || undefined,
    stage: "drafting",
    tipSha: input.tipSha?.trim() || undefined,
    headSha: input.headSha?.trim() || input.tipSha?.trim() || undefined,
    prNumber: typeof input.prNumber === "number" ? input.prNumber : undefined,
    mode: template.initialMode,
    path1CrossBotEnabled: path1,
    agentId: input.agentId?.trim() || undefined,
    createdAt,
    updatedAt: createdAt,
  };
  const saved = await createLane(lane, input.storeDir);
  const projection = await projectOntoTask(saved, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(saved),
  });
  return { lane: saved, projection };
}

export async function focusLane(input: FocusLaneInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
  summary: string;
}> {
  const lane = await getLane(input.laneId, input.storeDir);
  if (!lane) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }
  const summary = buildFocusSummary(lane);
  const projection = await projectOntoTask(lane, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: summary,
  });
  return { lane, projection, summary };
}

export async function setLaneMode(input: SetLaneModeInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
}> {
  const mode = input.mode;
  if (mode !== "implement" && mode !== "review" && mode !== "accept") {
    throw new DeliveryLaneError(
      `invalid mode for setLaneMode: ${String(mode)} (merge is reserved for requestMergeReady / requestMerge)`,
      "INVALID_REQUEST",
    );
  }
  const current = await getLane(input.laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }
  const saved = await updateLane(
    input.laneId,
    (lane) => ({
      ...lane,
      mode,
    }),
    input.storeDir,
  );
  const projection = await projectOntoTask(saved, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(saved),
  });
  return { lane: saved, projection };
}

function resolveSealStrength(params: {
  kind: LaneSealKind;
  lane: DeliveryLane;
  issuer: LaneSealIssuer;
  ownerCosignUserId?: string;
}): "weak" | "strong" {
  if (params.kind !== "accept") {
    return "strong";
  }
  const owner = params.lane.agentId?.trim();
  const issuerId = params.issuer.agentId.trim();
  const issuerBot = params.issuer.botId?.trim();
  const sameOrigin =
    Boolean(owner) && (issuerId === owner || (issuerBot !== undefined && issuerBot === owner));

  // Tip E: personal_subagent cannot issue acceptSeal (even when path1 off).
  if (params.issuer.kind === "personal_subagent") {
    throw new DeliveryLaneError(
      "acceptSeal refused: personal_subagent_cannot_accept_seal",
      "REFUSED",
    );
  }

  // Tip D: path-1 gate via canPublishLaneAcceptSeal (same-origin + self-sign).
  if (params.lane.path1CrossBotEnabled) {
    const gate = canPublishLaneAcceptSeal({
      path1CrossBotEnabled: true,
      source: "direct",
      laneOwnerAgentId: owner,
      issuerAgentId: issuerId,
      issuerBotId: issuerBot,
      issuerKind: params.issuer.kind,
      implementIssuerAgentId: params.lane.implementSeal?.issuer.agentId,
      implementIssuerBotId: params.lane.implementSeal?.issuer.botId,
    });
    if (!gate.allowed) {
      throw new DeliveryLaneError(`path-1 cross-bot acceptSeal refused: ${gate.reason}`, "REFUSED");
    }
    return "strong";
  }
  // Single-bot weak gate; Owner co-sign upgrades documentation strength only.
  if (params.ownerCosignUserId?.trim()) {
    return "strong";
  }
  return sameOrigin || !owner ? "weak" : "strong";
}

function stageAfterSeal(kind: LaneSealKind, current: DeliveryLane["stage"]): DeliveryLane["stage"] {
  if (kind === "implement") {
    return current === "drafting" || current === "implementing" ? "implementing" : current;
  }
  if (kind === "review") {
    return "reviewing";
  }
  if (kind === "accept") {
    return "accepting";
  }
  return current;
}

/** Align stage to still-valid seals after tipSha drift / seal invalidation. Never returns merge_ready. */
function alignStageWithActiveSeals(lane: DeliveryLane): DeliveryLane["stage"] {
  const implOk = Boolean(lane.implementSeal && !lane.implementSeal.invalidatedAt);
  const acceptOk = Boolean(lane.acceptSeal && !lane.acceptSeal.invalidatedAt);
  if (acceptOk) {
    return "accepting";
  }
  if (implOk) {
    return "implementing";
  }
  return "drafting";
}

export async function sealLane(input: SealLaneInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
}> {
  const tipSha = input.tipSha.trim();
  if (!tipSha) {
    throw new DeliveryLaneError("tipSha is required");
  }
  if (!input.issuer?.agentId?.trim()) {
    throw new DeliveryLaneError("issuer.agentId is required");
  }
  if (!PASSING_VERDICTS.has(input.verdict) && input.kind === "accept") {
    // Accept seal with non-pass verdict is stored but cannot unlock merge_ready later.
  }

  const strength = await (async () => {
    const current = await getLane(input.laneId, input.storeDir);
    if (!current) {
      throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
    }
    // Tip D: writing implement after accept — refuse path1 self-sign (order-independent).
    if (
      input.kind === "implement" &&
      current.path1CrossBotEnabled &&
      current.acceptSeal &&
      !current.acceptSeal.invalidatedAt
    ) {
      const gate = canPublishLaneAcceptSeal({
        path1CrossBotEnabled: true,
        source: "direct",
        laneOwnerAgentId: current.agentId,
        issuerAgentId: current.acceptSeal.issuer.agentId,
        issuerBotId: current.acceptSeal.issuer.botId,
        implementIssuerAgentId: input.issuer.agentId,
        implementIssuerBotId: input.issuer.botId,
      });
      if (!gate.allowed) {
        throw new DeliveryLaneError(
          `path-1 cross-bot implementSeal refused: ${gate.reason}`,
          "REFUSED",
        );
      }
    }
    return resolveSealStrength({
      kind: input.kind,
      lane: current,
      issuer: input.issuer,
      ownerCosignUserId: input.ownerCosignUserId,
    });
  })();

  const next = await updateLane(
    input.laneId,
    (lane) => {
      let working = lane;
      const prevTip = working.tipSha?.trim();
      let drifted = false;
      if (prevTip && prevTip !== tipSha) {
        drifted = true;
        working = invalidateDownstreamSeals(
          working,
          `tipSha drift: ${prevTip.slice(0, 12)} → ${tipSha.slice(0, 12)}`,
        );
      }
      const seal: LaneSeal = {
        kind: input.kind,
        verdict: input.verdict,
        tipSha,
        issuer: {
          agentId: input.issuer.agentId.trim(),
          ...(input.issuer.botId?.trim() ? { botId: input.issuer.botId.trim() } : {}),
          ...(input.issuer.mode ? { mode: input.issuer.mode } : {}),
          ...(input.issuer.kind ? { kind: input.issuer.kind } : {}),
        },
        strength,
        ...(input.ownerCosignUserId?.trim()
          ? { ownerCosign: { userId: input.ownerCosignUserId.trim(), at: nowIso() } }
          : {}),
        ...(input.evidence ? { evidence: input.evidence } : {}),
        issuedAt: nowIso(),
      };
      const headSha = input.headSha?.trim() || tipSha;
      if (input.kind === "implement") {
        working = { ...working, tipSha, headSha, implementSeal: seal };
      } else if (input.kind === "accept") {
        working = { ...working, tipSha, headSha, acceptSeal: seal };
      } else {
        working = {
          ...working,
          tipSha,
          headSha,
          reviewSeals: [...(working.reviewSeals ?? []).filter((s) => !s.invalidatedAt), seal],
        };
      }

      // Non-pass → blocked. tipSha drift / incomplete seals → never keep merge_ready.
      let stage: DeliveryLane["stage"];
      let mode = working.mode;
      if (!PASSING_VERDICTS.has(input.verdict)) {
        stage = "blocked";
      } else if (drifted) {
        stage = alignStageWithActiveSeals(working);
        if (mode === "merge") {
          mode = "implement";
        }
      } else {
        stage = stageAfterSeal(input.kind, working.stage);
        const missing = computeMissingKeys(working);
        if (stage === "merge_ready" && missing.length > 0) {
          stage = alignStageWithActiveSeals(working);
          if (mode === "merge") {
            mode = "implement";
          }
        }
      }
      return { ...working, stage, mode };
    },
    input.storeDir,
  );

  const projection = await projectOntoTask(next, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(next),
  });
  return { lane: next, projection };
}

export async function requestMergeReady(input: RequestMergeReadyInput): Promise<{
  lane: DeliveryLane;
  projection: LaneProjection;
}> {
  const current = await getLane(input.laneId, input.storeDir);
  if (!current) {
    throw new DeliveryLaneError(`delivery lane "${input.laneId}" not found`, "NOT_FOUND");
  }

  const missing = computeMissingKeys(current);
  if (missing.length > 0) {
    throw new DeliveryLaneError(
      `merge_ready refused: missing ${missing.join(", ")} (need implementSeal ∧ acceptSeal ∧ match-head)`,
      "REFUSED",
    );
  }

  const impl = current.implementSeal!;
  const accept = current.acceptSeal!;
  if (!PASSING_VERDICTS.has(impl.verdict) || !PASSING_VERDICTS.has(accept.verdict)) {
    throw new DeliveryLaneError(
      "merge_ready refused: implementSeal and acceptSeal must have PASS/REVIEW_PASS verdict",
      "REFUSED",
    );
  }

  const path1Gate = assertPath1DualSealAuthority(current);
  if (!path1Gate.allowed) {
    throw new DeliveryLaneError(`merge_ready refused: ${path1Gate.reason}`, "REFUSED");
  }

  const next = await updateLane(
    input.laneId,
    (lane) => ({
      ...lane,
      stage: "merge_ready",
      // Tip A: mark merge_ready only — Tip C lane.requestMerge performs guarded merge.
      mode: "merge",
    }),
    input.storeDir,
  );

  const projection = await projectOntoTask(next, {
    supervisorStoreDir: input.supervisorStoreDir,
    focusSummary: buildFocusSummary(next),
  });
  return { lane: next, projection };
}

export async function getLaneOrThrow(laneId: string, storeDir?: string): Promise<DeliveryLane> {
  const lane = await getLane(laneId, storeDir);
  if (!lane) {
    throw new DeliveryLaneError(`delivery lane "${laneId}" not found`, "NOT_FOUND");
  }
  return lane;
}
