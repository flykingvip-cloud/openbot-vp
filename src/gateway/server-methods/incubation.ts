// Gateway handlers for incubation.* methods.
//
// Provides endpoints for the enterprise incubation center:
// - incubation.candidate-pool: real-time candidate pool computation
// - incubation.score: multi-dimension incubation scoring
// - incubation.decide: promotion decision with reason validation
// - incubation.effect-tracking: before/after promotion comparison
//
// Platform upstream reporting is handled by the canonical sanitization-gated
// path (enterprise-capability.submit-to-platform -> platform-capability.*), and
// the incubation center's tracker reads enterprise-capability.platform-submissions.

import { randomUUID } from "node:crypto";
import { listBindings, type RuntimeCapabilityBinding } from "../agent-runtime-store.js";
import { listRegistry, type GovernanceRegistryEntry } from "../capability-governance-store.js";
import { listEnterpriseSubmissions } from "../capability-install-governance-store.js";
import {
  CAPABILITY_MATURITY_ORDER,
  effectiveMaturity,
  monthlyExecutionsFromBindings,
  uniqueAgentCount,
  type CapabilityMaturity,
} from "../capability-maturity.js";
import {
  listDecisions,
  saveDecision,
  getEffectTracking,
  type PromotionDecisionRecord,
  type IncubationScoreSnapshot,
} from "../incubation-store.js";
import { ErrorCodes, errorShape } from "../protocol/index.js";
import type { GatewayRequestHandlers, RespondFn } from "./types.js";

// --- Constants ---

const MATURITY_ORDER = CAPABILITY_MATURITY_ORDER;

const CANDIDATE_MATURITY_THRESHOLD: CapabilityMaturity = "企业认证";
const CANDIDATE_CALLS_THRESHOLD = 100;
const CANDIDATE_DEPT_THRESHOLD = 2;
const CANDIDATE_SUCCESS_RATE_THRESHOLD = 0.8;

const SCORE_WEIGHTS = {
  reuseBreath: 0.3,
  effectStability: 0.3,
  businessCoverage: 0.2,
  employeeSatisfaction: 0.2,
} as const;

const DECLINE_THRESHOLD = 0.2;

// --- Helpers ---

function respondInvalid(respond: RespondFn, message: string): void {
  respond(false, undefined, errorShape(ErrorCodes.INVALID_REQUEST, message));
}

function respondUnavailable(respond: RespondFn, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  respond(false, undefined, errorShape(ErrorCodes.UNAVAILABLE, message));
}

type CapabilityDomain = "销售" | "HR" | "客服" | "财务" | "法务" | "数据分析";

type CandidateInfo = {
  capabilityId: string;
  name: string;
  maturity: CapabilityMaturity;
  calls30d: number;
  departmentCount: number;
  successRate: number;
  domain: CapabilityDomain;
  createdAtMs: number;
};

function domainFromManifest(manifest: {
  name: string;
  description: string;
  skillKey?: string;
}): CapabilityDomain {
  const haystack = [manifest.name, manifest.description, manifest.skillKey ?? ""]
    .join(" ")
    .toLowerCase();
  if (/(sales|crm|lead|opportun|customer|客户|商机|销售|营销)/i.test(haystack)) {
    return "销售";
  }
  if (/(hr|recruit|interview|resume|employee|招聘|面试|简历|人事|员工)/i.test(haystack)) {
    return "HR";
  }
  if (/(support|ticket|complaint|service|客服|工单|投诉|售后)/i.test(haystack)) {
    return "客服";
  }
  if (/(finance|invoice|expense|payment|billing|财务|发票|报销|费用|账单)/i.test(haystack)) {
    return "财务";
  }
  if (/(legal|contract|compliance|policy|audit|law|合同|法务|合规|审计)/i.test(haystack)) {
    return "法务";
  }
  return "数据分析";
}

function computeCandidateInfo(
  entry: GovernanceRegistryEntry,
  bindings: RuntimeCapabilityBinding[],
): CandidateInfo {
  const capBindings = bindings.filter((b) => b.capabilityId === entry.manifest.id);
  const robots = uniqueAgentCount(capBindings);
  const calls30d = monthlyExecutionsFromBindings(capBindings);
  const successRates = capBindings
    .filter((b) => b.invocationMetrics.calls7d > 0)
    .map((b) => b.invocationMetrics.successRate7d);
  const successRate =
    successRates.length > 0 ? successRates.reduce((sum, r) => sum + r, 0) / successRates.length : 1;
  const createdAtMs = Date.parse(entry.createdAt);
  return {
    capabilityId: entry.manifest.id,
    name: entry.manifest.name,
    maturity: effectiveMaturity(entry, capBindings),
    calls30d,
    // Field name stays departmentCount for compatibility; value is unique robots.
    departmentCount: robots,
    successRate,
    domain: domainFromManifest(entry.manifest),
    createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : 0,
  };
}

function isCandidateEligible(info: CandidateInfo): boolean {
  const maturityIdx = MATURITY_ORDER.indexOf(info.maturity);
  const thresholdIdx = MATURITY_ORDER.indexOf(CANDIDATE_MATURITY_THRESHOLD);
  return (
    maturityIdx >= thresholdIdx &&
    info.calls30d >= CANDIDATE_CALLS_THRESHOLD &&
    info.departmentCount >= CANDIDATE_DEPT_THRESHOLD &&
    info.successRate >= CANDIDATE_SUCCESS_RATE_THRESHOLD
  );
}

function calcReuseBreath(robotCount: number, employeeCount: number): number {
  const robotScore = Math.min(100, robotCount * 10);
  const employeeScore = Math.min(100, employeeCount * 5);
  return Math.round(robotScore * 0.4 + employeeScore * 0.6);
}

function calcEffectStability(successRate: number, stdDev: number): number {
  const rateScore = Math.min(100, successRate * 100);
  const stabilityPenalty = Math.min(50, stdDev * 200);
  return Math.round(Math.max(0, rateScore - stabilityPenalty));
}

function calcBusinessCoverage(departmentCount: number, roleCount: number): number {
  const deptScore = Math.min(100, departmentCount * 20);
  const roleScore = Math.min(100, roleCount * 15);
  return Math.round(deptScore * 0.6 + roleScore * 0.4);
}

function computeScore(bindings: RuntimeCapabilityBinding[]): IncubationScoreSnapshot {
  const robotCount = new Set(bindings.map((b) => b.runtimeAgentId)).size;
  const employeeCount = robotCount; // approximate
  const successRates = bindings
    .filter((b) => b.invocationMetrics.calls7d > 0)
    .map((b) => b.invocationMetrics.successRate7d);
  const avgSuccessRate =
    successRates.length > 0 ? successRates.reduce((sum, r) => sum + r, 0) / successRates.length : 1;
  const stdDev =
    successRates.length > 1
      ? Math.sqrt(
          successRates.reduce((sum, r) => sum + (r - avgSuccessRate) ** 2, 0) / successRates.length,
        )
      : 0;
  const departmentCount = robotCount;
  const roleCount = Math.min(robotCount, 3); // approximate

  const reuseBreath = calcReuseBreath(robotCount, employeeCount);
  const effectStability = calcEffectStability(avgSuccessRate, stdDev);
  const businessCoverage = calcBusinessCoverage(departmentCount, roleCount);
  // Employee satisfaction: null when no data available
  const employeeSatisfaction: number | null = null;

  // Compute composite score excluding unavailable dimensions
  const dimensions: { value: number; weight: number; available: boolean }[] = [
    { value: reuseBreath, weight: SCORE_WEIGHTS.reuseBreath, available: true },
    { value: effectStability, weight: SCORE_WEIGHTS.effectStability, available: true },
    { value: businessCoverage, weight: SCORE_WEIGHTS.businessCoverage, available: true },
    {
      value: employeeSatisfaction ?? 0,
      weight: SCORE_WEIGHTS.employeeSatisfaction,
      available: employeeSatisfaction !== null,
    },
  ];
  const available = dimensions.filter((d) => d.available);
  const totalWeight = available.reduce((sum, d) => sum + d.weight, 0);
  const compositeScore =
    totalWeight > 0
      ? Math.round(available.reduce((sum, d) => sum + d.value * (d.weight / totalWeight), 0))
      : 0;

  return {
    reuseBreath,
    effectStability,
    businessCoverage,
    employeeSatisfaction,
    compositeScore,
  };
}

// --- Handlers ---

export const incubationHandlers: GatewayRequestHandlers = {
  /** Real-time candidate pool computation */
  "incubation.candidate-pool": ({ params, respond }) => {
    try {
      const p = (params ?? {}) as { domainFilter?: string; sortBy?: string };
      const allBindings = listBindings({
        runtimeAgentId: null,
        capabilityId: null,
        bindingType: null,
        bindingState: null,
        health: null,
      });
      const entries = listRegistry().filter((e) => e.lifecycleState !== "retired");

      const candidates: Array<CandidateInfo & { score: IncubationScoreSnapshot }> = [];
      for (const entry of entries) {
        const info = computeCandidateInfo(entry, allBindings);
        if (!isCandidateEligible(info)) {
          continue;
        }
        if (p.domainFilter && info.domain !== p.domainFilter) {
          continue;
        }
        const capBindings = allBindings.filter((b) => b.capabilityId === entry.manifest.id);
        const score = computeScore(capBindings);
        candidates.push({ ...info, score });
      }

      // Sort: default by calls30d desc, or by compositeScore desc
      if (p.sortBy === "compositeScore") {
        candidates.sort((a, b) => b.score.compositeScore - a.score.compositeScore);
      } else {
        candidates.sort((a, b) => b.calls30d - a.calls30d);
      }

      // Compute stats
      const decisions = listDecisions();
      const recommendedIds = new Set(
        decisions.filter((d) => d.result === "recommend_upload").map((d) => d.capabilityId),
      );
      const now = Date.now();
      const monthStart = new Date(now);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const monthStartMs = monthStart.getTime();
      const publishedSubmissions = listEnterpriseSubmissions().filter(
        (submission) => submission.status === "published",
      );

      respond(true, {
        candidates: candidates.map(({ createdAtMs: _createdAtMs, ...candidate }) => candidate),
        stats: {
          totalCandidates: candidates.length,
          newThisMonth: candidates.filter((candidate) => candidate.createdAtMs >= monthStartMs)
            .length,
          recommendedCount: recommendedIds.size,
          platformApprovedCount: publishedSubmissions.length,
        },
      });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  /** Get incubation score for a single capability */
  "incubation.score": ({ params, respond }) => {
    try {
      const p = (params ?? {}) as { capabilityId?: string };
      if (!p.capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }

      const allBindings = listBindings({
        runtimeAgentId: null,
        capabilityId: null,
        bindingType: null,
        bindingState: null,
        health: null,
      });
      const capBindings = allBindings.filter((b) => b.capabilityId === p.capabilityId);
      const score = computeScore(capBindings);

      respond(true, { capabilityId: p.capabilityId, score });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  /** Decision log only. Must not write enterprise-capability.submit-to-platform. */
  "incubation.decide": ({ params, respond }) => {
    try {
      const p = (params ?? {}) as {
        capabilityId?: string;
        result?: string;
        reason?: string;
        decidedBy?: string;
      };

      if (!p.capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }
      const validResults = ["recommend_upload", "continue_incubation", "not_suitable"];
      if (!p.result || !validResults.includes(p.result)) {
        respondInvalid(
          respond,
          "result must be one of: recommend_upload, continue_incubation, not_suitable",
        );
        return;
      }
      if (!p.reason || p.reason.length < 10 || p.reason.length > 500) {
        respondInvalid(respond, "reason must be 10-500 characters");
        return;
      }

      // Compute current score snapshot
      const allBindings = listBindings({
        runtimeAgentId: null,
        capabilityId: null,
        bindingType: null,
        bindingState: null,
        health: null,
      });
      const capBindings = allBindings.filter((b) => b.capabilityId === p.capabilityId);
      const scoreSnapshot = computeScore(capBindings);

      const decisionId = `dec-${randomUUID()}`;
      const decision: PromotionDecisionRecord = {
        decisionId,
        capabilityId: p.capabilityId,
        decidedAt: Date.now(),
        decidedBy: p.decidedBy ?? "admin",
        result: p.result as PromotionDecisionRecord["result"],
        reason: p.reason,
        scoreSnapshot,
      };

      saveDecision(decision);
      respond(true, { decisionId, succeeded: true });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },

  /** Get effect tracking data (before/after promotion comparison) */
  "incubation.effect-tracking": ({ params, respond }) => {
    try {
      const p = (params ?? {}) as { capabilityId?: string };
      if (!p.capabilityId) {
        respondInvalid(respond, "capabilityId is required");
        return;
      }

      const record = getEffectTracking(p.capabilityId);
      if (!record) {
        respond(true, {
          capabilityId: p.capabilityId,
          comparison: null,
          dailyTrend: [],
          promotionDate: null,
        });
        return;
      }

      // Compute before/after comparison
      const promotionDate = new Date(record.promotionTimestamp).toISOString().slice(0, 10);
      const beforeCalls = record.dailyCallSnapshots.filter(
        (s) => new Date(s.date).getTime() < record.promotionTimestamp,
      );
      const afterCalls = record.dailyCallSnapshots.filter(
        (s) => new Date(s.date).getTime() >= record.promotionTimestamp,
      );
      const beforeDepts = record.dailyDepartmentSnapshots.filter(
        (s) => new Date(s.date).getTime() < record.promotionTimestamp,
      );
      const afterDepts = record.dailyDepartmentSnapshots.filter(
        (s) => new Date(s.date).getTime() >= record.promotionTimestamp,
      );
      const beforeRates = record.dailySuccessRateSnapshots.filter(
        (s) => new Date(s.date).getTime() < record.promotionTimestamp,
      );
      const afterRates = record.dailySuccessRateSnapshots.filter(
        (s) => new Date(s.date).getTime() >= record.promotionTimestamp,
      );

      const avg = (arr: number[]) =>
        arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

      const before30dAvgCalls = avg(beforeCalls.map((s) => s.count));
      const after30dAvgCalls = avg(afterCalls.map((s) => s.count));
      const before30dDeptCount =
        beforeDepts.length > 0 ? beforeDepts[beforeDepts.length - 1].count : 0;
      const after30dDeptCount = afterDepts.length > 0 ? afterDepts[afterDepts.length - 1].count : 0;
      const before30dSuccessRate = avg(beforeRates.map((s) => s.rate));
      const after30dSuccessRate = avg(afterRates.map((s) => s.rate));

      const callsDeclineRate =
        before30dAvgCalls > 0 ? (after30dAvgCalls - before30dAvgCalls) / before30dAvgCalls : 0;
      const deptDeclineRate =
        before30dDeptCount > 0 ? (after30dDeptCount - before30dDeptCount) / before30dDeptCount : 0;

      const hasDeclineWarning =
        callsDeclineRate < -DECLINE_THRESHOLD || deptDeclineRate < -DECLINE_THRESHOLD;

      const trackingDaysAfter = afterCalls.length;
      const isTrackingComplete = trackingDaysAfter >= 30;

      const comparison = {
        before30dAvgCalls,
        after30dAvgCalls,
        before30dDeptCount,
        after30dDeptCount,
        before30dSuccessRate,
        after30dSuccessRate,
        callsDeclineRate,
        deptDeclineRate,
        hasDeclineWarning,
        trackingDaysAfter,
        isTrackingComplete,
      };

      const dailyTrend = record.dailyCallSnapshots.map((s) => ({
        date: s.date,
        calls: s.count,
      }));

      respond(true, { capabilityId: p.capabilityId, comparison, dailyTrend, promotionDate });
    } catch (err) {
      respondUnavailable(respond, err);
    }
  },
};
