/**
 * Gateway timed tick for READ_ONLY diagnose(). Never throws into the main chain.
 * Disable with OPENBOT_DIAGNOSIS_TICK=0.
 */
import { CONFIG_DIR } from "../utils.js";
import { createDiagnoseGroupExpandDeps } from "./diagnose-group-expand-deps.js";
import {
  executeParsedDiagnoseRequest,
  loadStructuralPreviewConfig,
} from "./diagnose-live-request.js";
import { markDiagnosisScheduleRun, requestFromSchedule } from "./diagnose-schedule.js";
import { listSchedulesAdmittingNewJobRuns } from "./diagnosis-job.js";
import type { LiveDiagnoseSummary } from "./live-run.js";
import type { TrustedTenantContext } from "./types.js";

export const DEFAULT_DIAGNOSIS_TICK_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_DIAGNOSIS_TICK_SESSION_CAP = 8;

export type DiagnosisSchedulerConfig = {
  enabled: boolean;
  intervalMs: number;
  sessionCap: number;
};

type TickHandler = () => Promise<void> | void;

let config: DiagnosisSchedulerConfig = {
  enabled: process.env.OPENBOT_DIAGNOSIS_TICK !== "0",
  intervalMs: DEFAULT_DIAGNOSIS_TICK_INTERVAL_MS,
  sessionCap: DEFAULT_DIAGNOSIS_TICK_SESSION_CAP,
};
let timer: ReturnType<typeof setInterval> | null = null;
let running = false;
let tickHandler: TickHandler | null = null;

export function configureDiagnosisScheduler(
  patch: Partial<DiagnosisSchedulerConfig>,
): DiagnosisSchedulerConfig {
  config = { ...config, ...patch };
  return { ...config };
}

export function getDiagnosisSchedulerConfig(): DiagnosisSchedulerConfig {
  return { ...config };
}

export function startDiagnosisScheduler(handler: TickHandler): void {
  tickHandler = handler;
  if (timer || !config.enabled) {
    return;
  }
  timer = setInterval(() => {
    void runDiagnosisTick();
  }, config.intervalMs);
  if (typeof timer === "object" && timer && "unref" in timer) {
    (timer as { unref: () => void }).unref();
  }
}

export function stopDiagnosisScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function defaultDiagnosisTick(): Promise<{
  ran: boolean;
  diagnosed: number;
  summaries: LiveDiagnoseSummary[];
  reason?: string;
}> {
  if (!config.enabled) {
    return { ran: false, diagnosed: 0, summaries: [], reason: "disabled" };
  }
  const summaries: LiveDiagnoseSummary[] = [];
  // Pause blocks a new scheduled run. In-flight diagnose() calls already
  // inside this loop are not cancelled. Cadence off remains a separate state.
  for (const schedule of listSchedulesAdmittingNewJobRuns({ configDir: CONFIG_DIR })) {
    try {
      const trusted: TrustedTenantContext = { tenantId: schedule.tenantId };
      const expandDeps = await createDiagnoseGroupExpandDeps();
      const payload = await executeParsedDiagnoseRequest({
        request: requestFromSchedule(schedule),
        trusted,
        requestedBy: {
          schemaVersion: 1,
          principalId: "diagnosis-tick",
          kind: "system",
          tenantId: trusted.tenantId,
        },
        skillConfigDir: CONFIG_DIR,
        allowConversationDelivery: false,
        allowSelfEvolutionConfirm: false,
        structuralPreview: loadStructuralPreviewConfig(),
        registry: expandDeps.registry,
        loadGroupMembers: expandDeps.loadGroupMembers,
        sessionKeyExists: expandDeps.sessionKeyExists,
      });
      if (payload.reportId) {
        summaries.push({
          reportId: payload.reportId,
          completion: payload.completion,
          findingCount: payload.findingCount,
          findings: payload.findings,
        });
      }
      markDiagnosisScheduleRun({ tenantId: schedule.tenantId, configDir: CONFIG_DIR });
    } catch {
      // never throw into the main chain
    }
  }
  return { ran: true, diagnosed: summaries.length, summaries };
}

export async function runDiagnosisTick(): Promise<{ ran: boolean; reason?: string }> {
  if (!config.enabled) {
    return { ran: false, reason: "disabled" };
  }
  if (running) {
    return { ran: false, reason: "already-running" };
  }
  running = true;
  try {
    if (tickHandler) {
      await tickHandler();
    } else {
      await defaultDiagnosisTick();
    }
    return { ran: true };
  } catch {
    return { ran: false, reason: "tick-error" };
  } finally {
    running = false;
  }
}
