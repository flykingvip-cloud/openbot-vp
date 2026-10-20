/**
 * Seal for recoverEvolutionPrescriptionAfterCron.
 * Production runtime cannot mark a prescription APPLIED through this helper.
 * Every call is audited. A non-production recovery still needs a confirm receipt
 * whose content hash matches the prescription.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export type EvolutionRecoverAudit = {
  tenantId: string;
  prescriptionId: string;
  outcome: "rejected" | "applied";
  reason: string;
  productionRuntime: boolean;
  at: string;
};

export type EvolutionRecoverMetrics = {
  attempts: number;
  rejected: number;
  applied: number;
};

const audits: EvolutionRecoverAudit[] = [];
const metrics: EvolutionRecoverMetrics = { attempts: 0, rejected: 0, applied: 0 };

export function isDiagnosisEvolutionProductionRuntime(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const runtime = env.OPENBOT_DIAGNOSIS_RUNTIME?.trim().toLowerCase();
  if (runtime === "production" || runtime === "live") {
    return true;
  }
  if (runtime === "test" || runtime === "development") {
    return false;
  }
  return env.NODE_ENV === "production";
}

export function readEvolutionRecoverAudits(): readonly EvolutionRecoverAudit[] {
  return audits;
}

export function readEvolutionRecoverMetrics(): EvolutionRecoverMetrics {
  return { ...metrics };
}

export function resetEvolutionRecoverAuditForTests(): void {
  audits.length = 0;
  metrics.attempts = 0;
  metrics.rejected = 0;
  metrics.applied = 0;
}

export function noteEvolutionRecoverAudit(
  entry: Omit<EvolutionRecoverAudit, "at">,
  configDir?: string,
): EvolutionRecoverAudit {
  const row: EvolutionRecoverAudit = { ...entry, at: new Date().toISOString() };
  audits.push(row);
  metrics.attempts += 1;
  if (row.outcome === "applied") {
    metrics.applied += 1;
  } else {
    metrics.rejected += 1;
  }
  if (configDir) {
    const digest = createHash("sha256").update(row.tenantId).digest("hex").slice(0, 16);
    const dir = path.join(configDir, "diagnosis-evolution-audit");
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, `${digest}.jsonl`), `${JSON.stringify(row)}\n`);
  }
  return row;
}
