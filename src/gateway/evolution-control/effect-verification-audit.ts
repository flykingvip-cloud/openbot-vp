import fs from "node:fs";
import path from "node:path";
import type { ExternalEffectOutcome, EvolutionTarget } from "@openbot/evolution-core";
import { canPromoteWithExternalEffect } from "@openbot/evolution-core";
import { logEvolutionLoop } from "./evolution-loop-log.js";
import { resolveEvolutionControlRoot } from "./persistent-store.js";

export const EVOLUTION_EFFECT_VERIFICATIONS_FILENAME = "evolution-effect-verifications.jsonl";

export type EffectVerificationAudit = {
  runId: string;
  surfaceId: string;
  target: EvolutionTarget | Record<string, unknown>;
  beforeState: unknown;
  afterState: unknown;
  outcome: ExternalEffectOutcome | "unavailable";
  result: "verified" | "unavailable" | "contradicted" | "not_observed";
  timestamp: string;
  verifierVersion: string;
  agentId?: string;
  tenantId?: string;
  reason: string;
};

export function resolveEffectVerificationAuditPath(persistDir?: string): string {
  return path.join(
    resolveEvolutionControlRoot(persistDir),
    EVOLUTION_EFFECT_VERIFICATIONS_FILENAME,
  );
}

export function mapExternalEffectToAuditResult(
  outcome: ExternalEffectOutcome | null | undefined,
): EffectVerificationAudit["result"] {
  if (outcome === "verified") {
    return "verified";
  }
  if (outcome === "contradicted") {
    return "contradicted";
  }
  if (outcome === "not_observed") {
    return "not_observed";
  }
  return "unavailable";
}

export function writeEffectVerificationAudit(input: {
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  surfaceId: string;
  target: EvolutionTarget | Record<string, unknown>;
  beforeState?: unknown;
  afterState?: unknown;
  outcome?: ExternalEffectOutcome | null;
  verifierVersion: string;
  reason: string;
  persistDir?: string;
  now?: string;
}): EffectVerificationAudit {
  const result = mapExternalEffectToAuditResult(input.outcome);
  const record: EffectVerificationAudit = {
    runId: input.runId?.trim() || "",
    surfaceId: input.surfaceId,
    target: input.target,
    beforeState: input.beforeState ?? null,
    afterState: input.afterState ?? null,
    outcome: result === "unavailable" ? "unavailable" : (input.outcome ?? "inconclusive"),
    result,
    timestamp: input.now ?? new Date().toISOString(),
    verifierVersion: input.verifierVersion,
    ...(input.agentId ? { agentId: input.agentId } : {}),
    ...(input.tenantId ? { tenantId: input.tenantId } : {}),
    reason: input.reason,
  };
  const persistToDisk = Boolean(input.persistDir?.trim()) || process.env.VITEST !== "true";
  if (persistToDisk) {
    const filePath = resolveEffectVerificationAuditPath(input.persistDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
  logEvolutionLoop(
    result === "unavailable"
      ? "evolution.effect_verification.unavailable"
      : "evolution.effect_verification.created",
    {
      runId: record.runId || null,
      agentId: input.agentId ?? null,
      tenantId: input.tenantId ?? null,
      surfaceId: input.surfaceId,
      reason: input.reason,
    },
  );
  return record;
}

export function promotionGateFromEffect(input: {
  proposalStatus: string;
  verificationId?: string;
  riskLevel: string;
  requireExternalEffect: boolean;
  externalEffectOutcome?: ExternalEffectOutcome | null;
  runId?: string | null;
  agentId?: string | null;
  tenantId?: string | null;
  surfaceId?: string | null;
}): { ok: true } | { ok: false; code: string; reason: string } {
  const gate = canPromoteWithExternalEffect(input);
  logEvolutionLoop(gate.ok ? "evolution.promotion.accepted" : "evolution.promotion.rejected", {
    runId: input.runId ?? null,
    agentId: input.agentId ?? null,
    tenantId: input.tenantId ?? null,
    surfaceId: input.surfaceId ?? null,
    reason: gate.ok ? "gates_satisfied" : gate.code,
  });
  return gate;
}

export function readEffectVerificationAudits(persistDir?: string): EffectVerificationAudit[] {
  const filePath = resolveEffectVerificationAuditPath(persistDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: EffectVerificationAudit[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean)) {
    try {
      rows.push(JSON.parse(line) as EffectVerificationAudit);
    } catch {
      // skip corrupt lines
    }
  }
  return rows;
}

export const EVOLUTION_PROMOTE_AUDITS_FILENAME = "evolution-promote-audits.jsonl";

export type PromoteGateAudit = {
  runId: string;
  agentId: string;
  tenantId: string;
  surfaceId: string;
  ok: boolean;
  code?: string;
  reason: string;
  verificationId?: string;
  externalEffectOutcome?: ExternalEffectOutcome | null;
  timestamp: string;
};

export function resolvePromoteGateAuditPath(persistDir?: string): string {
  return path.join(resolveEvolutionControlRoot(persistDir), EVOLUTION_PROMOTE_AUDITS_FILENAME);
}

export function findLatestEffectVerificationAudit(input: {
  runId: string;
  agentId: string;
  tenantId: string;
  surfaceId: string;
  persistDir?: string;
}): EffectVerificationAudit | null {
  const rows = readEffectVerificationAudits(input.persistDir);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (
      row.runId === input.runId &&
      row.agentId === input.agentId &&
      row.tenantId === input.tenantId &&
      row.surfaceId === input.surfaceId
    ) {
      return row;
    }
  }
  return null;
}

export function evaluatePromoteGateFromPersistedAudit(input: {
  runId: string;
  agentId: string;
  tenantId: string;
  surfaceId: string;
  persistDir?: string;
  now?: string;
}): {
  ok: boolean;
  code?: string;
  reason: string;
  audit: EffectVerificationAudit | null;
  verificationId?: string;
} {
  const audit = findLatestEffectVerificationAudit(input);
  const verified = audit?.result === "verified";
  const verificationId = verified ? `ver:raw:${input.runId}` : undefined;
  const externalEffectOutcome = !audit || audit.outcome === "unavailable" ? null : audit.outcome;
  const gate = promotionGateFromEffect({
    proposalStatus: verified ? "VERIFIED" : "CANARY",
    verificationId,
    riskLevel: "medium",
    requireExternalEffect: true,
    externalEffectOutcome,
    runId: input.runId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    surfaceId: input.surfaceId,
  });
  const record: PromoteGateAudit = {
    runId: input.runId,
    agentId: input.agentId,
    tenantId: input.tenantId,
    surfaceId: input.surfaceId,
    ok: gate.ok,
    reason: gate.ok ? "gates_satisfied" : gate.reason,
    timestamp: input.now ?? new Date().toISOString(),
    ...(gate.ok ? {} : { code: gate.code }),
    ...(verificationId ? { verificationId } : {}),
    ...(externalEffectOutcome ? { externalEffectOutcome } : {}),
  };
  const persistToDisk = Boolean(input.persistDir?.trim()) || process.env.VITEST !== "true";
  if (persistToDisk) {
    const filePath = resolvePromoteGateAuditPath(input.persistDir);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  }
  return {
    ...gate,
    reason: record.reason,
    audit,
    ...(verificationId ? { verificationId } : {}),
  };
}
