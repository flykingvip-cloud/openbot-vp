/**
 * QUICK / TARGETED / FULL replay runner.
 * Walks a frozen graph through planner + read-only adapters + Journal.
 * Does not write Session / Skill Invocation / route / doctor-fix stores.
 *
 * INCIDENT is reserved (Phase 3): must reject explicitly — never else→QUICK.
 *
 * Completion is derived from plan stopWhen + collected Evidence, evaluated
 * after each step (incremental stop). The runner never reads graph.run.completion
 * or graph.verification.
 */
import type { DiagnosisEvidenceAdapter } from "./adapters.js";
import { DiagnosisJournal } from "./journal.js";
import {
  assertSupportedPlannerRunMode,
  buildDiagnosisPlan,
  planMissingEvidence,
} from "./planner.js";
import { markInconclusive, markRunCompleted } from "./run-completion.js";
import { adapterForSource, createPartialSourceAdapters } from "./source-adapters.js";
import { deriveCompletion, matchStopWhen } from "./stop-when.js";
import { resolvePartialSourceBundle, type DiagnosisStorePaths } from "./store-readers.js";
import type {
  DiagnosisCompletion,
  DiagnosisPlan,
  DiagnosticEvidence,
  DiagnosticRun,
  DiagnosticVerification,
  EvidenceRequirement,
  TrustedTenantContext,
} from "./types.js";
import { resolveReplayVerification, type GovernanceReceiptRef } from "./verification.js";

/** Replay input — protocol run + evidence only. Not the golden fixture envelope. */
export type DiagnosticRunGraph = {
  schemaVersion: 1;
  graphKind: "DiagnosticRunGraph";
  run: DiagnosticRun;
  evidences: DiagnosticEvidence[];
  verification: DiagnosticVerification | null;
};

/** Runtime replay output. Must not include fixture `case` / findings / relations. */
export type ReplayResult = {
  run: DiagnosticRun;
  plan: DiagnosisPlan;
  collected: DiagnosticEvidence[];
  missing: EvidenceRequirement[];
  journal: DiagnosisJournal;
  verification: DiagnosticVerification | null;
};

export async function replayDiagnosticRunGraph(input: {
  graph: DiagnosticRunGraph;
  trusted: TrustedTenantContext;
  journal?: DiagnosisJournal;
  adapters?: readonly DiagnosisEvidenceAdapter[];
  stores?: DiagnosisStorePaths;
  governanceReceipt?: GovernanceReceiptRef;
}): Promise<ReplayResult> {
  const journal = input.journal ?? new DiagnosisJournal();
  const seed = stripRunCompletion(input.graph.run);
  const runId = seed.runId;
  const toolTargetSpecified = seed.targets.some((target) => target.targetType === "tool");
  const bundle = resolvePartialSourceBundle({
    evidences: input.graph.evidences,
    stores: input.stores,
  });
  const adapters = input.adapters ?? createPartialSourceAdapters(bundle);
  const toolCandidateLive = (bundle.skillInvocation ?? []).some((row) => row.skillStarted);
  // Exhaustive supported-mode gate — INCIDENT must not become QUICK.
  const mode = assertSupportedPlannerRunMode(seed.mode);
  const plan = buildDiagnosisPlan({
    runId,
    mode,
    toolTargetSpecified,
    toolCandidateLive,
  });
  journal.append({ runId, kind: "plan", code: plan.planId, detail: seed.mode });

  const collected: DiagnosticEvidence[] = [];
  const missing: EvidenceRequirement[] = [...planMissingEvidence(plan)];
  let completion: DiagnosisCompletion | null = null;

  for (const step of plan.steps) {
    for (const request of step.evidenceRequests) {
      const adapter = adapterForSource(adapters, request.source);
      if (!adapter) {
        if (request.required) {
          missing.push(request);
        }
        journal.append({
          runId,
          kind: "collect",
          code: `${request.source}:unbound`,
        });
        continue;
      }
      const result = await adapter.collect(request, input.trusted);
      collected.push(...result.evidences);
      missing.push(...result.missing);
      journal.append({
        runId,
        kind: "collect",
        code: `${request.source}:${result.evidences.length}`,
        detail: result.missing.length > 0 ? "missing" : "ok",
      });
    }

    const uniqueMissing = dedupeMissing(missing);
    const stopped = matchStopWhen({
      stopWhen: step.stopWhen,
      collected,
      missing: uniqueMissing,
    });
    if (stopped) {
      completion = stopped;
      journal.append({
        runId,
        kind: "stop",
        code: step.stepId,
        detail: stopped,
      });
      break;
    }
  }

  const uniqueMissing = dedupeMissing(missing);
  const derived =
    completion ??
    deriveCompletion({
      stopWhen: plan.steps.flatMap((step) => step.stopWhen),
      collected,
      missing: uniqueMissing,
    });
  const run =
    derived === "INCONCLUSIVE"
      ? markInconclusive(seed, input.trusted, uniqueMissing, seed.completedAt)
      : markRunCompleted(seed, derived, input.trusted, {
          missingEvidence: uniqueMissing,
          completedAt: seed.completedAt,
          ...(derived === "BLOCKED" ? { blockReason: "messageReceived=false" } : {}),
        });
  journal.append({ runId, kind: "complete", code: derived, detail: run.status });

  const verification = resolveReplayVerification({
    completion: derived,
    run,
    receipt: input.governanceReceipt,
  });
  return { run, plan, collected, missing: uniqueMissing, journal, verification };
}

/** Drop any fixture/golden completion so mark helpers cannot copy it. */
export function stripRunCompletion(run: DiagnosticRun): DiagnosticRun {
  const { completion: _ignored, ...rest } = run;
  return rest;
}

function dedupeMissing(missing: readonly EvidenceRequirement[]): EvidenceRequirement[] {
  const seen = new Set<string>();
  const out: EvidenceRequirement[] = [];
  for (const req of missing) {
    const key = `${req.source}|${req.targetType}|${req.fields.join(",")}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(req);
  }
  return out;
}
