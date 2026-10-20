/**
 * Floor Runtime v2.1 §2.7 / §5.8 P2-A — Admission.
 * Synchronous and pure. Shadow-A does not collect model bids.
 * L0 must-admit bypasses the novelty gate (deterministic).
 * L1 clear candidates pass only on admissionSignals.
 * selfAssessment may change sort order and cannot alone clear the gate.
 * Ambiguous candidates stay rejected until Shadow-B. Cap is the emergency fuse (12).
 */
import type { FloorBudgets } from "./effective-policy.js";
import type { L0Reason, L0Route } from "./router-l0.js";
import type { L1Route } from "./router-l1.js";
import type { RuntimeAuthority } from "./runtime-authority.js";

export const ADMISSION_ROLES = [
  "peer",
  "challenger",
  "evidence",
  "task_owner",
  "reviewer",
] as const;

export type AdmissionRole = (typeof ADMISSION_ROLES)[number];

export type AdmissionVia = L0Reason | "l1" | "bid";

export type AdmissionSignals = {
  novelty: number;
  duplicateSimilarity: number;
  capabilityFit: number;
};

export type AdmissionBid = {
  agentId: string;
  selfAssessment?: { novelty: number; confidence: number };
  admissionSignals: AdmissionSignals;
};

export type AdmittedAgent = {
  agentId: string;
  role: AdmissionRole;
  via: AdmissionVia;
  order: number;
};

export type RejectedAgent = {
  agentId: string;
  reason: string;
};

export type AdmissionResult = {
  admitted: AdmittedAgent[];
  rejected: RejectedAgent[];
  fuseTripped: boolean;
  budgets: {
    remaining: FloorBudgets;
    consumed: FloorBudgets;
  };
};

function roleFor(reason: L0Reason): AdmissionRole {
  return reason === "task_owner" ? "task_owner" : "peer";
}

function passesSignals(
  signals: AdmissionSignals,
  noveltyFloor: number,
  duplicateMax: number,
): "ok" | "novelty" | "duplicate" {
  if (signals.novelty < noveltyFloor) {
    return "novelty";
  }
  if (signals.duplicateSimilarity > duplicateMax) {
    return "duplicate";
  }
  return "ok";
}

function sortScore(fit: number, selfNovelty: number | undefined, weight: number): number {
  const self = selfNovelty ?? fit;
  return (1 - weight) * fit + weight * self;
}

export function admit(
  authority: RuntimeAuthority,
  l0: L0Route,
  l1: L1Route,
  bids: readonly AdmissionBid[] = [],
): AdmissionResult {
  const policy = authority.policy.effective;
  const fuse = policy.participation.emergencyFanoutFuse;
  const visiblePosts = policy.dispatch.tuning.floor.admission.budgets.visiblePosts;
  const rollCeiling = policy.participation.rollCall.ceiling;
  const openness = policy.participation.floorOpenness;
  const noveltyFloor = policy.dispatch.tuning.floor.admission.noveltyFloor;
  const duplicateMax = policy.dispatch.tuning.floor.admission.duplicateSimilarityMax;
  const weight = policy.dispatch.tuning.floor.bid.selfAssessmentWeight;
  const modelCalls = policy.dispatch.tuning.floor.admission.budgets.modelCalls;
  const tokens = policy.dispatch.tuning.floor.admission.budgets.tokens;
  const l0Cap = l0.rollCall ? Math.min(rollCeiling, fuse) : fuse;
  const bidsById = new Map(bids.map((bid) => [bid.agentId, bid]));
  const admitted: AdmittedAgent[] = [];
  const rejected: RejectedAgent[] = [];
  const seen = new Set<string>();

  const take = (agentId: string, role: AdmissionRole, via: AdmissionVia) => {
    if (!agentId || seen.has(agentId)) {
      return;
    }
    seen.add(agentId);
    admitted.push({ agentId, role, via, order: admitted.length });
  };

  const reject = (agentId: string, reason: string) => {
    if (!agentId || seen.has(agentId) || rejected.some((row) => row.agentId === agentId)) {
      return;
    }
    rejected.push({ agentId, reason });
  };

  for (const member of l0.mustAdmit) {
    if (admitted.length >= l0Cap) {
      reject(member.agentId, admitted.length >= fuse ? "fuse" : "budget");
      continue;
    }
    take(member.agentId, roleFor(member.reason), member.reason);
  }

  const l1Allowed = !l0.rollCall && openness !== "mention_only";
  let l1Room = 0;
  if (l1Allowed) {
    if (openness === "single") {
      l1Room = admitted.length === 0 ? 1 : 0;
    } else {
      l1Room = Math.max(0, Math.min(visiblePosts, fuse) - admitted.length);
    }
  }

  const ranked = l1.clear
    .map((candidate) => {
      const bid = bidsById.get(candidate.agentId);
      const signals = bid?.admissionSignals ?? {
        novelty: 1,
        duplicateSimilarity: 0,
        capabilityFit: candidate.capabilityFit,
      };
      return {
        candidate,
        signals,
        score: sortScore(candidate.capabilityFit, bid?.selfAssessment?.novelty, weight),
      };
    })
    .toSorted(
      (left, right) =>
        right.score - left.score || left.candidate.agentId.localeCompare(right.candidate.agentId),
    );

  for (const row of ranked) {
    const agentId = row.candidate.agentId;
    if (seen.has(agentId)) {
      continue;
    }
    if (!l1Allowed) {
      reject(agentId, openness === "mention_only" ? "mention_only" : "roll_call");
      continue;
    }
    if (l1Room <= 0 || admitted.length >= fuse) {
      reject(agentId, admitted.length >= fuse ? "fuse" : "budget");
      continue;
    }
    const gate = passesSignals(row.signals, noveltyFloor, duplicateMax);
    if (gate !== "ok") {
      reject(agentId, gate);
      continue;
    }
    take(agentId, "peer", "l1");
    l1Room -= 1;
  }

  for (const candidate of l1.ambiguous) {
    reject(candidate.agentId, "ambiguous");
  }
  for (const candidate of l1.below) {
    reject(candidate.agentId, "below_band");
  }
  for (const row of l0.excluded) {
    reject(row.agentId, row.reason);
  }

  const consumedVisible = admitted.length;
  const fuseTripped = admitted.length >= fuse;
  return {
    admitted,
    rejected,
    fuseTripped,
    budgets: {
      consumed: { visiblePosts: consumedVisible, modelCalls: 0, tokens: 0 },
      remaining: {
        visiblePosts: Math.max(0, visiblePosts - consumedVisible),
        modelCalls,
        tokens,
      },
    },
  };
}
