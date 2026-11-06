/** Default-off, disposable cost evidence. Never changes budgets, billing, or configuration. */
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { OpenBotConfig } from "../config/config.js";
import { resolveConfiguredTaskOutcomeRoot } from "../task-outcome/reject-result.js";
import type { chargeModelCallAgainstTip } from "../task-outcome/runtime-from-runner.js";
import { boundedOutcomePathSegment } from "../task-outcome/store.js";
import type { TaskOutcomeRecord, TrustedScope } from "../task-outcome/types.js";
import { resolveModelCostConfig, type ModelCostConfig } from "../utils/usage-format.js";
import { readOutcomeMetadata, type OutcomeRecordMetadata } from "./outcome-reader.js";
import { OUTCOME_METADATA_SCHEMA_VERSION, outcomeMetadataFingerprint } from "./outcome-source.js";
import {
  projectRunCostEvidence,
  runCostEvidenceSchema,
  runCostLinkSchema,
  type RunCostEvidence,
  type RunCostLink,
} from "./run-cost-evidence.js";
export const RUN_COST_OBSERVATION_FLAG = "OPENBOT_EXECUTION_ROUTER_OBSERVATION";
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const scopeKey = (s: TrustedScope) =>
  JSON.stringify(
    s.kind === "enterprise"
      ? [s.kind, s.enterpriseDomainId, s.tenantId, s.subjectRef, s.authzScopeRef]
      : [s.kind, s.personalDomainId, s.subjectRef, s.authzScopeRef],
  );
export function createRunCostStore(
  options: { enabled?: () => boolean; now?: () => number; capacity?: number; ttlMs?: number } = {},
) {
  const now = options.now ?? Date.now;
  const enabled =
    options.enabled ??
    (() => /^(1|true|yes|on)$/i.test(process.env[RUN_COST_OBSERVATION_FLAG]?.trim() ?? ""));
  const capacity = options.capacity ?? 1000,
    ttlMs = options.ttlMs ?? 900000;
  if (!Number.isSafeInteger(capacity) || capacity < 1 || !Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error("invalid_retention");
  }
  const facts = new Map<string, { fact: RunCostEvidence; at: number; conflict: boolean }>();
  const links = new Map<string, { link: RunCostLink; at: number; conflict: boolean }>();
  const processId = randomUUID();
  let epoch = randomUUID();
  let active = false;
  const ready = () => {
    try {
      const next = enabled();
      if (next !== active) {
        facts.clear();
        links.clear();
        epoch = randomUUID();
        active = next;
      }
      if (!next) {
        return false;
      }
      const at = now();
      if (!Number.isFinite(at)) {
        throw new Error("invalid_clock");
      }
      for (const [id, row] of facts) {
        if (at - row.at >= ttlMs) {
          facts.delete(id);
        }
      }
      for (const [id, row] of links) {
        if (at - row.at >= ttlMs) {
          links.delete(id);
        }
      }
      return true;
    } catch {
      facts.clear();
      links.clear();
      active = false;
      return false;
    }
  };
  return {
    isEnabled: ready,
    recordFact(raw: unknown): boolean {
      try {
        if (!ready()) {
          return false;
        }
        const parsed = runCostEvidenceSchema.safeParse(raw);
        if (!parsed.success || parsed.data.occurredAt > now()) {
          return false;
        }
        const fact = parsed.data;
        const key = hash([
          fact.agentId,
          scopeKey(fact.scope),
          fact.taskId,
          fact.runId,
          fact.callSeq,
        ]);
        const prior = facts.get(key);
        if (prior) {
          if (JSON.stringify(prior.fact) !== JSON.stringify(fact)) {
            prior.conflict = true;
            return false;
          }
          return !prior.conflict;
        }
        facts.set(key, { fact, at: now(), conflict: false });
        while (facts.size > capacity) {
          facts.delete(facts.keys().next().value!);
        }
        return true;
      } catch {
        return false;
      }
    },
    recordLink(raw: unknown): boolean {
      try {
        if (!ready()) {
          return false;
        }
        const parsed = runCostLinkSchema.safeParse(raw);
        if (!parsed.success) {
          return false;
        }
        const link = parsed.data;
        if (
          link.callRefs.some(
            (ref) =>
              ![...facts.values()].some(
                (row) =>
                  !row.conflict &&
                  row.fact.evidenceId === ref.evidenceId &&
                  row.fact.budgetOutcomeVersion === ref.budgetOutcomeVersion &&
                  row.fact.agentId === link.agentId &&
                  scopeKey(row.fact.scope) === scopeKey(link.scope) &&
                  row.fact.taskId === link.taskId &&
                  row.fact.runId === link.runId,
              ),
          )
        ) {
          return false;
        }
        const key = hash([
          link.agentId,
          scopeKey(link.scope),
          link.taskId,
          link.finalOutcomeVersion,
          link.runId,
        ]);
        const prior = links.get(key);
        if (prior) {
          if (JSON.stringify(prior.link) !== JSON.stringify(link)) {
            prior.conflict = true;
            return false;
          }
          return !prior.conflict;
        }
        links.set(key, { link, at: now(), conflict: false });
        while (links.size > capacity) {
          links.delete(links.keys().next().value!);
        }
        return true;
      } catch {
        return false;
      }
    },
    query(
      agentId: string,
      scope: TrustedScope,
      record: OutcomeRecordMetadata,
      projectedAt: number,
    ) {
      const on = ready();
      const scopedFacts = on
        ? [...facts.values()].filter(
            (row) =>
              row.fact.agentId === agentId &&
              scopeKey(row.fact.scope) === scopeKey(scope) &&
              row.fact.taskId === record.taskId,
          )
        : [];
      const scopedLinks = on
        ? [...links.values()].filter(
            (row) =>
              !row.conflict &&
              row.link.agentId === agentId &&
              scopeKey(row.link.scope) === scopeKey(scope) &&
              row.link.taskId === record.taskId &&
              row.link.finalOutcomeVersion === record.outcomeVersion,
          )
        : [];
      return {
        retention: "process_memory" as const,
        processId,
        epoch,
        capacity,
        ttlMs,
        sourceWatermark: null,
        runCosts: scopedLinks.map(({ link }) => ({
          runId: link.runId,
          cost: projectRunCostEvidence({
            agentId,
            scope,
            record,
            projectedAt,
            link,
            evidence: scopedFacts.filter((row) => !row.conflict).map((row) => row.fact),
          }),
        })),
        reasons: [
          "cost_retention_continuity_unknown",
          "failed_call_set_unproven",
          "budget_command_does_not_attest_usage_winner",
          ...(!on ? ["cost_observation_disabled"] : []),
        ],
      };
    },
  };
}
let shared: ReturnType<typeof createRunCostStore> | undefined;
export function getRunCostStore() {
  return (shared ??= createRunCostStore());
}
export function snapshotRunCostPricing(
  cfg: OpenBotConfig,
  provider: string,
  model: string,
): ModelCostConfig | null {
  try {
    const rates = resolveModelCostConfig({ config: cfg, provider, model });
    if (
      !rates ||
      ![rates.input, rates.output, rates.cacheRead, rates.cacheWrite].every(
        (n) => Number.isFinite(n) && n >= 0,
      )
    ) {
      return null;
    }
    return {
      input: rates.input,
      output: rates.output,
      cacheRead: rates.cacheRead,
      cacheWrite: rates.cacheWrite,
    };
  } catch {
    return null;
  }
}
export function createRunCostCollector(
  context: {
    cfg: OpenBotConfig;
    agentId?: string;
    taskId?: string;
    scope?: TrustedScope;
    runId: string;
    provenance: "live" | "injected" | "unknown";
  },
  store: ReturnType<typeof createRunCostStore> = getRunCostStore(),
) {
  const refs: RunCostLink["callRefs"] = [];
  let overflow = false;
  const pending = new Set<number>();
  return {
    isEnabled: () => store.isEnabled(),
    beginCall(callSeq: number): boolean {
      try {
        pending.delete(callSeq);
        if (!store.isEnabled() || !context.agentId || !context.taskId || pending.size >= 1000) {
          return false;
        }
        const root = resolveConfiguredTaskOutcomeRoot(context.cfg, context.agentId);
        if (!root.ok) {
          return false;
        }
        const commandId =
          "budget-spend:" + context.taskId + ":" + context.runId + ":call:" + callSeq;
        if (
          fs.existsSync(
            path.join(root.root, "command-log", boundedOutcomePathSegment(commandId) + ".json"),
          )
        ) {
          return false;
        }
        pending.add(callSeq);
        return true;
      } catch {
        return false;
      }
    },
    capture(input: {
      provider: string;
      model: string;
      usage?: unknown;
      callSeq: number;
      nowMs: number;
      pricing: ModelCostConfig | null;
      receipt: ReturnType<typeof chargeModelCallAgainstTip>;
    }): boolean {
      try {
        if (
          !store.isEnabled() ||
          !pending.has(input.callSeq) ||
          !context.agentId ||
          !context.taskId ||
          !context.scope ||
          refs.length >= 1000
        ) {
          if (refs.length >= 1000) {
            overflow = true;
          }
          return false;
        }
        pending.delete(input.callSeq);
        const r = input.receipt.record;
        if (
          !r.budget ||
          r.taskId !== context.taskId ||
          scopeKey(r.scope) !== scopeKey(context.scope)
        ) {
          return false;
        }
        const located = resolveConfiguredTaskOutcomeRoot(context.cfg, context.agentId);
        if (!located.ok) {
          return false;
        }
        const commandId =
          "budget-spend:" + context.taskId + ":" + context.runId + ":call:" + input.callSeq;
        const logPath = path.join(
          located.root,
          "command-log",
          boundedOutcomePathSegment(commandId) + ".json",
        );
        if (fs.statSync(logPath).size > 16384) {
          return false;
        }
        const log = JSON.parse(fs.readFileSync(logPath, "utf8")) as {
          commandId?: unknown;
          taskId?: unknown;
          outcomeVersion?: unknown;
          digest?: unknown;
        };
        if (
          log.commandId !== commandId ||
          log.taskId !== context.taskId ||
          typeof log.outcomeVersion !== "number" ||
          !Number.isSafeInteger(log.outcomeVersion) ||
          log.outcomeVersion < 1 ||
          log.outcomeVersion > r.outcomeVersion
        ) {
          return false;
        }
        if (typeof log.digest !== "string" || !/^[a-f0-9]{64}$/.test(log.digest)) {
          return false;
        }
        const readBudget = (v: number) => {
          const file = path.join(
            located.root,
            "versions",
            boundedOutcomePathSegment(context.taskId!) + "__v" + v + ".json",
          );
          if (fs.statSync(file).size > 131072) {
            throw new Error("budget_snapshot_too_large");
          }
          return JSON.parse(fs.readFileSync(file, "utf8")) as {
            taskId?: unknown;
            outcomeVersion?: unknown;
            budget?: {
              iterationCount?: number;
              spentCostUsd?: number;
              unknownCostCharges?: number;
              knownZeroCostCharges?: number;
            };
          };
        };
        const before = readBudget(log.outcomeVersion - 1);
        const after = readBudget(log.outcomeVersion);
        if (
          before.taskId !== context.taskId ||
          after.taskId !== context.taskId ||
          before.outcomeVersion !== log.outcomeVersion - 1 ||
          after.outcomeVersion !== log.outcomeVersion ||
          !before.budget ||
          !after.budget
        ) {
          return false;
        }
        const prior = before.budget,
          next = after.budget;
        const cost = input.receipt.evidence === "known" ? input.receipt.costUsd : 0;
        if (
          typeof cost !== "number" ||
          !Number.isFinite(cost) ||
          cost < 0 ||
          !Number.isFinite(prior.spentCostUsd) ||
          !Number.isFinite(next.spentCostUsd) ||
          next.iterationCount !== Number(prior.iterationCount) + 1 ||
          Math.abs(Number(next.spentCostUsd) - Number(prior.spentCostUsd) - cost) > 1e-12 ||
          (next.unknownCostCharges ?? 0) - (prior.unknownCostCharges ?? 0) !==
            (input.receipt.evidence === "unknown" ? 1 : 0) ||
          (next.knownZeroCostCharges ?? 0) - (prior.knownZeroCostCharges ?? 0) !==
            (input.receipt.evidence === "known" && cost === 0 ? 1 : 0)
        ) {
          return false;
        }
        // The digest is an opaque original command identity; the return DTO omits its fencing token.
        // Exact version and scalar delta are verified; we never fabricate a transition digest.
        const version = readOutcomeMetadata({
          cfg: context.cfg,
          agentId: context.agentId,
          taskId: context.taskId,
          outcomeVersion: log.outcomeVersion,
          callerSubjectRef: context.scope.subjectRef,
          callerTenantId: context.scope.kind === "enterprise" ? context.scope.tenantId : null,
        });
        if (!version.ok || scopeKey(version.outcome.scope) !== scopeKey(context.scope)) {
          return false;
        }
        // The original budget API does not identify a newly-applied versus replayed winner.
        // Even an equal scalar delta cannot attest this callback's usage under concurrent calls.
        // Keep all usage and monetary values unknown rather than apportion or infer them.
        const evidenceId = hash([context.agentId, scopeKey(context.scope), commandId]);
        const fact: RunCostEvidence = {
          schemaVersion: 1,
          evidenceId,
          sourceId: "runner-budget-command-log",
          collector: "model_call_usage",
          provenance: context.provenance,
          agentId: context.agentId,
          scope: context.scope,
          taskId: context.taskId,
          budgetOutcomeVersion: log.outcomeVersion,
          runId: context.runId,
          callSeq: input.callSeq,
          occurredAt: input.nowMs,
          tokens: {
            input: null,
            output: null,
            cacheRead: null,
            cacheWrite: null,
          },
          estimatedUsd: { amount: null, costEvidence: "unknown", pricingRef: null },
          procurementCents: { amount: null, ledgerRef: null },
          credits: { amount: null, ledgerRef: null },
        };
        const saved = store.recordFact(fact);
        if (saved && !refs.some((x) => x.evidenceId === evidenceId)) {
          refs.push({ evidenceId, budgetOutcomeVersion: log.outcomeVersion });
        }
        return saved;
      } catch {
        return false;
      }
    },
    bind(record: TaskOutcomeRecord): boolean {
      try {
        if (
          !store.isEnabled() ||
          overflow ||
          !refs.length ||
          !context.agentId ||
          !context.scope ||
          record.taskId !== context.taskId ||
          scopeKey(record.scope) !== scopeKey(context.scope) ||
          record.revisionKind === "correction"
        ) {
          return false;
        }
        const run = record.runs.find((r) => r.runId === context.runId);
        const attempt = record.attempts.find(
          (a) =>
            a.runId === context.runId &&
            a.attemptId === run?.effectiveAttemptId &&
            run?.attemptIds.includes(a.attemptId),
        );
        if (!attempt) {
          return false;
        }
        return store.recordLink({
          schemaVersion: 1,
          agentId: context.agentId,
          scope: context.scope,
          taskId: record.taskId,
          finalOutcomeVersion: record.outcomeVersion,
          outcomeMetadataSchemaVersion: OUTCOME_METADATA_SCHEMA_VERSION,
          finalOutcomeFingerprint: outcomeMetadataFingerprint(record),
          runId: context.runId,
          attemptId: attempt.attemptId,
          attemptGranularity: "turn",
          callRefs: [...refs],
          completeCallSet: false,
          expectedCallCount: null,
        });
      } catch {
        return false;
      }
    },
  };
}
