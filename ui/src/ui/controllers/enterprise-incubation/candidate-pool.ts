// ui/src/ui/controllers/enterprise-incubation/candidate-pool.ts

import type {
  CapabilityDomain,
  CapabilityMaturity,
} from "../../capability/enterprise-capability/types.ts";
import type { GatewayBrowserClient } from "../../gateway.ts";
import type { IncubationScore } from "./incubation-score.ts";

export type CandidateCapability = {
  capabilityId: string;
  name: string;
  maturity: CapabilityMaturity;
  calls30d: number;
  departmentCount: number;
  successRate: number;
  domain: CapabilityDomain;
  score: IncubationScore | null;
};

export type CandidatePoolState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  loading: boolean;
  error: string | null;
  candidates: CandidateCapability[];
  domainFilter: CapabilityDomain | null;
  sortBy: "calls30d" | "compositeScore";
};

/**
 * 按领域筛选候选能力。入池门槛只由 gateway `incubation.candidate-pool` 计算。
 */
export function filterByDomain(
  candidates: CandidateCapability[],
  domain: CapabilityDomain | null,
): CandidateCapability[] {
  if (!domain) {
    return candidates;
  }
  return candidates.filter((c) => c.domain === domain);
}

/**
 * 排序候选能力列表
 */
export function sortCandidates(
  candidates: CandidateCapability[],
  sortBy: "calls30d" | "compositeScore",
): CandidateCapability[] {
  return [...candidates].toSorted((a, b) => {
    if (sortBy === "compositeScore") {
      return (b.score?.compositeScore ?? 0) - (a.score?.compositeScore ?? 0);
    }
    return b.calls30d - a.calls30d;
  });
}
