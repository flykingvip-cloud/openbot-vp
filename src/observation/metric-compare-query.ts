/** Server-owned read-only comparison. Requests contain references, never metric aggregates. */
import type { OpenBotConfig } from "../config/config.js";
import { buildCohortIdentity, cohortDimensionsKey } from "./cohort-identity.js";
import { compareObservationMetrics, type MetricCohort } from "./metric-compare.js";
import { OBSERVATION_METRIC_DICT, OBSERVATION_METRIC_DICT_VERSION } from "./metric-dict.js";
import { readOutcomeMetadata } from "./outcome-reader.js";
import { outcomeMetadataFingerprint } from "./outcome-source.js";
import { queryObservationWithJournal } from "./query.js";
export type ComparisonCaller = { subjectRef: string; tenantId?: string | null };
type Ref = { agentId: string; taskId: string; outcomeVersion: number };
type Side = { refs: Ref[]; window: { from: number; to: number } };
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return (
    Object.keys(value).length === keys.length &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}
function side(value: unknown, now: number): value is Side {
  if (
    !object(value) ||
    !exact(value, ["refs", "window"]) ||
    !Array.isArray(value.refs) ||
    value.refs.length < 1 ||
    value.refs.length > 50 ||
    !object(value.window) ||
    !exact(value.window, ["from", "to"])
  ) {
    return false;
  }
  const { from, to } = value.window;
  if (
    typeof from !== "number" ||
    typeof to !== "number" ||
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    from >= to ||
    to > now ||
    to - from > 30 * 86400000
  ) {
    return false;
  }
  return value.refs.every(
    (ref) =>
      object(ref) &&
      exact(ref, ["agentId", "taskId", "outcomeVersion"]) &&
      typeof ref.agentId === "string" &&
      Boolean(ref.agentId.trim()) &&
      ref.agentId.length <= 256 &&
      typeof ref.taskId === "string" &&
      Boolean(ref.taskId.trim()) &&
      ref.taskId.length <= 512 &&
      typeof ref.outcomeVersion === "number" &&
      Number.isSafeInteger(ref.outcomeVersion) &&
      ref.outcomeVersion > 0,
  );
}
type CohortSummary = { state: "blocked" | "matched"; refs: string[]; reasons: string[] };
function cohortSummary(cohort: CohortSummary): { cohort?: CohortSummary } {
  return { cohort };
}
function callerKey(caller: ComparisonCaller): string {
  return JSON.stringify([caller.subjectRef, caller.tenantId ?? null]);
}
function uniqueRefs(refs: Ref[]): Ref[] {
  return [
    ...new Map(
      refs.map((ref) => [JSON.stringify([ref.agentId, ref.taskId, ref.outcomeVersion]), ref]),
    ).values(),
  ].toSorted((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}
/** authorize is a trusted server port and must re-read current grants, not cached request fields. */
export function createMetricCompareQuery(options: {
  cfg: OpenBotConfig;
  authorize: () => Promise<ComparisonCaller | null>;
  now?: () => number;
}) {
  return async (request: unknown) => {
    const deny = (code: string) => ({ ok: false as const, code });
    const now = (options.now ?? Date.now)();
    if (
      !Number.isFinite(now) ||
      !object(request) ||
      !exact(request, ["baseline", "candidate"]) ||
      !side(request.baseline, now) ||
      !side(request.candidate, now)
    ) {
      return deny("invalid_request");
    }
    // Freeze validated request data before yielding to asynchronous authorization.
    const baseline = structuredClone(request.baseline);
    const candidate = structuredClone(request.candidate);
    const all = [...baseline.refs, ...candidate.refs];
    if (new Set(all.map((ref) => ref.agentId)).size !== 1) {
      return deny("agent_cohort_mismatch");
    }
    try {
      const caller = await options.authorize();
      if (!caller?.subjectRef.trim()) {
        return deny("unauthorized");
      }
      const identity = callerKey(caller);
      const stillAuthorized = async () => {
        const current = await options.authorize();
        return Boolean(current?.subjectRef.trim() && callerKey(current) === identity);
      };
      const metadataStates: { ref: Ref; fingerprint: string; isCurrentTip: boolean }[] = [];
      const read = async (input: Side) => {
        const queries: {
          ref: Ref;
          result: Awaited<ReturnType<typeof queryObservationWithJournal>>;
        }[] = [];
        const cohortIdentities: ReturnType<typeof buildCohortIdentity>[] = [];
        for (const ref of uniqueRefs(input.refs)) {
          if (!(await stillAuthorized())) {
            throw new Error("unauthorized");
          }
          const metadata = readOutcomeMetadata({
            cfg: options.cfg,
            ...ref,
            callerSubjectRef: caller.subjectRef,
            callerTenantId: caller.tenantId,
          });
          if (!metadata.ok) {
            throw new Error(
              metadata.code === "unauthorized" ? "unauthorized" : "evidence_unavailable",
            );
          }
          const result = await queryObservationWithJournal({
            cfg: options.cfg,
            caller,
            ...ref,
            from: input.window.from,
            to: input.window.to,
            projectedAt: now,
          });
          if (!(await stillAuthorized())) {
            throw new Error("unauthorized");
          }
          if (!result.ok) {
            throw new Error(
              result.code === "unauthorized" ? "unauthorized" : "evidence_unavailable",
            );
          }
          if (
            !result.samples.some(
              (sample) =>
                sample.outcome?.taskId === ref.taskId &&
                sample.outcome.outcomeVersion === ref.outcomeVersion,
            )
          ) {
            throw new Error("evidence_unavailable");
          }
          const freshMetadata = readOutcomeMetadata({
            cfg: options.cfg,
            ...ref,
            callerSubjectRef: caller.subjectRef,
            callerTenantId: caller.tenantId,
          });
          if (
            !freshMetadata.ok ||
            cohortDimensionsKey(freshMetadata.outcome.cohortDimensions) !==
              cohortDimensionsKey(metadata.outcome.cohortDimensions)
          ) {
            throw new Error("evidence_unavailable");
          }
          cohortIdentities.push(
            buildCohortIdentity({
              scope: freshMetadata.outcome.scope,
              agentId: ref.agentId,
              dimensions: freshMetadata.outcome.cohortDimensions,
              metricDictVersion: OBSERVATION_METRIC_DICT_VERSION,
              metricId: OBSERVATION_METRIC_DICT.linkCoverage.metricId,
            }),
          );
          metadataStates.push({
            ref,
            fingerprint: outcomeMetadataFingerprint(freshMetadata.outcome),
            isCurrentTip: freshMetadata.outcome.isCurrentTip,
          });
          queries.push({ ref, result });
        }
        const samples: MetricCohort["samples"] = queries.flatMap(({ ref, result }) =>
          result.ok
            ? result.samples.map((sample) => ({
                sampleId: sample.sampleId,
                taskId: ref.taskId,
                outcomeVersion: ref.outcomeVersion,
                qualification: sample.qualification,
                improvementEligible: sample.improvementEligible,
                provenance:
                  sample.provenance.length === 1 ? sample.provenance[0] : ("unknown" as const),
              }))
            : [],
        );
        const metric: MetricCohort = {
          metricDictVersion: OBSERVATION_METRIC_DICT_VERSION,
          metricId: OBSERVATION_METRIC_DICT.linkCoverage.metricId,
          denominatorDefinition: OBSERVATION_METRIC_DICT.linkCoverage.denominator,
          cohortRef:
            cohortIdentities.find((identity) => identity.state === "known")?.cohortRef ??
            "cohort:unknown",
          window: input.window,
          windowDefinition: "TaskOutcome.decidedAt and execution occurredAt; [from,to)",
          numerator: samples.filter((sample) => sample.qualification === "fully_linked").length,
          denominator: samples.length,
          environment: "production",
          samples,
        };
        return { metric, queries, cohortIdentities };
      };
      const b = await read(baseline);
      const c = await read(candidate);
      if (!(await stillAuthorized())) {
        return deny("unauthorized");
      }
      for (const expected of metadataStates) {
        const current = readOutcomeMetadata({
          cfg: options.cfg,
          ...expected.ref,
          callerSubjectRef: caller.subjectRef,
          callerTenantId: caller.tenantId,
        });
        if (
          !current.ok ||
          current.outcome.isCurrentTip !== expected.isCurrentTip ||
          outcomeMetadataFingerprint(current.outcome) !== expected.fingerprint
        ) {
          throw new Error("evidence_unavailable");
        }
      }
      const comparison = compareObservationMetrics({ baseline: b.metric, candidate: c.metric });
      const identities = [...b.cohortIdentities, ...c.cohortIdentities];
      const cohortReasons = [...new Set(identities.flatMap((identity) => identity.reasons))];
      if (identities.some((identity) => identity.state !== "known")) {
        cohortReasons.push("cohort_identity_unknown");
      }
      if (
        new Set(
          identities
            .filter((identity) => identity.state === "known")
            .map((identity) => identity.cohortRef),
        ).size > 1
      ) {
        cohortReasons.push("cohort_dimensions_mismatch");
      }
      const cohortBlocked = cohortReasons.length > 0;
      return {
        ok: true as const,
        comparison: {
          ...comparison,
          status: cohortBlocked ? ("blocked" as const) : comparison.status,
          reasons: [...new Set([...comparison.reasons, ...cohortReasons])].toSorted(),
          baselineValue: cohortBlocked ? null : comparison.baselineValue,
          candidateValue: cohortBlocked ? null : comparison.candidateValue,
          delta: cohortBlocked ? null : comparison.delta,
        },
        evidence: { baseline: b.queries, candidate: c.queries },
        ...cohortSummary({
          state: cohortBlocked ? ("blocked" as const) : ("matched" as const),
          refs: [
            ...new Set(
              identities.flatMap((identity) => (identity.cohortRef ? [identity.cohortRef] : [])),
            ),
          ].toSorted(),
          reasons: cohortReasons.toSorted(),
        }),
        selectionScope: "explicit_references_only" as const,
      };
    } catch (error) {
      return deny(
        error instanceof Error && error.message === "unauthorized"
          ? "unauthorized"
          : "evidence_unavailable",
      );
    }
  };
}
