/**
 * Server-derived Cron Objective identity.
 * Uses parsePersonalCronTaskMetaRecord — never copies the private marker parser,
 * and never reads non-existent objectiveId/revision from PersonalCronTaskMetaRecord.
 *
 * objectiveId is a stable function of the permanent job id (not occurrence/runId).
 * revision is a digest of the normalized Cron task contract, including goal /
 * intent / acceptance / compiled instruction. Raw text is hashed in memory and
 * never written to the shadow record.
 */

import { createHash } from "node:crypto";
import { parsePersonalCronTaskMetaRecord } from "../cron/personal-task-meta.js";
import type { ShadowCandidate } from "./types.js";

export const CRON_OBJECTIVE_ID_PREFIX = "cron-obj:";

export type CronObjectiveJobInput = {
  id?: string | null;
  enabled?: boolean;
  sessionTarget?: string | null;
  schedule?: unknown;
  delivery?: unknown;
  description?: string | null;
  /** Compiled isolated-run instruction when distinct from payload.message. */
  compiledInstruction?: string | null;
  payload?: {
    kind?: string;
    message?: string;
    text?: string;
    model?: string;
    timeoutSeconds?: number;
    thinking?: string;
    lightContext?: boolean;
    fallbacks?: string[];
  } | null;
};

export type DerivedCronObjective = {
  objectiveId: string;
  revision?: number;
};

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .toSorted()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function normalizeCronContractText(value?: string | null): string {
  return (value ?? "").normalize("NFC").replace(/\s+/gu, " ").trim();
}

function digestContractText(value?: string | null): string {
  return createHash("sha256").update(normalizeCronContractText(value), "utf8").digest("hex");
}

function digestAcceptanceRules(rules?: string[] | null): string[] {
  return (rules ?? []).map((rule) => digestContractText(rule));
}

function payloadInstruction(payload: CronObjectiveJobInput["payload"]): string {
  if (!payload) {
    return "";
  }
  if (payload.kind === "systemEvent") {
    return payload.text ?? "";
  }
  return payload.message ?? payload.text ?? "";
}

export function deriveCronObjectiveId(jobId?: string | null): string | undefined {
  const id = jobId?.trim() ?? "";
  if (!id) {
    return undefined;
  }
  return id.startsWith(CRON_OBJECTIVE_ID_PREFIX) ? id : `${CRON_OBJECTIVE_ID_PREFIX}${id}`;
}

export function deriveCronObjectiveIdentity(
  job: CronObjectiveJobInput,
): DerivedCronObjective | null {
  const objectiveId = deriveCronObjectiveId(job.id);
  if (!objectiveId) {
    return null;
  }
  const meta = parsePersonalCronTaskMetaRecord(job.description);
  const snapshot = {
    enabled: job.enabled !== false,
    sessionTarget: job.sessionTarget?.trim() ?? "",
    schedule: job.schedule ?? null,
    delivery: job.delivery ?? null,
    goal: digestContractText(meta?.goal),
    intentText: digestContractText(meta?.intentText),
    acceptanceRules: digestAcceptanceRules(meta?.acceptanceRules),
    compiledInstruction: digestContractText(
      job.compiledInstruction || payloadInstruction(job.payload),
    ),
    payload: {
      kind: job.payload?.kind ?? "",
      model: job.payload?.model ?? "",
      timeoutSeconds: job.payload?.timeoutSeconds ?? null,
      thinking: job.payload?.thinking ?? "",
      lightContext: job.payload?.lightContext === true,
      fallbacks: [...(job.payload?.fallbacks ?? [])].map((entry) => entry.trim()).filter(Boolean),
    },
    dataBindings: (meta?.dataBindings ?? []).map((binding) => ({
      bindingId: binding.bindingId,
      kind: binding.kind,
      resourceId: binding.resourceId,
      knowledgeScope: binding.knowledgeScope ?? "",
    })),
    notify: meta?.notify ?? {},
    selectedGroups: [...(meta?.selectedGroups ?? [])].toSorted(),
  };
  const digest = createHash("sha256").update(stableStringify(snapshot), "utf8").digest("hex");
  const revision = Number.parseInt(digest.slice(0, 12), 16);
  if (!Number.isFinite(revision)) {
    return { objectiveId };
  }
  return { objectiveId, revision };
}

export function cronCandidatesFromJob(job: CronObjectiveJobInput): ShadowCandidate[] {
  const derived = deriveCronObjectiveIdentity(job);
  if (!derived) {
    return [];
  }
  const candidate: ShadowCandidate = { source: "cron", objectiveId: derived.objectiveId };
  if (typeof derived.revision === "number" && Number.isFinite(derived.revision)) {
    candidate.revision = derived.revision;
  }
  return [candidate];
}
