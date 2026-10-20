/**
 * E5.1 shadow observer for runtime auto and skill auto.
 *
 * Records whether a direct intent would consume a control-plane Application.
 * Does not import the live runtime action or skill install modules.
 * Does not replace, stop, or repeat the live direct mutator.
 * The live readiness reader keeps cutoverReady false.
 */

import fs from "node:fs";
import path from "node:path";
import {
  APPLICATION_CONSUMPTION_SCHEMA,
  classifyA9M1Event,
  evaluateControlPlaneApplicationConsumption,
  evaluateCutoverReadiness,
  type A9M1Classification,
  type A9M1Event,
  type ConsumptionIntent,
  type ConsumptionObservation,
  type ControlPlaneApplicationConsumption,
  type ControlPlaneConsumptionBinding,
  type CutoverReadinessReport,
  type RuntimeConsumptionAction,
  type ShadowStoreHealth,
} from "@openbot/evolution-core";
import { CONFIG_DIR } from "../../utils.js";
import {
  attestShadowStoreWrite,
  describeShadowHealthChain,
  discardInMemoryShadowStoreHealthForTests,
  latchShadowStoreFaults,
  projectShadowStoreHealth,
  recoverShadowStoreHealth,
  removeShadowStoreHealthFiles,
  type ShadowRecoveryAuthority,
  type ShadowStoreFaultKind,
} from "./application-consumption-shadow-health.js";
import { registerControlPlaneIntent } from "./control-plane-intent-registration.js";
import type { EvolutionGovernanceMode } from "./mode.js";

export { discardInMemoryShadowStoreHealthForTests, type ShadowRecoveryAuthority };

const MAX_ROWS = 500;
const SHADOW_SOURCES = ["runtime-auto-tick", "skill-auto-pass", "a9-m1"] as const;
const SHADOW_LIVE_PATHS = [
  "direct-runtime-action",
  "direct-skill-install",
  "diagnosis-m1-observation",
] as const;
const CLIENT_RECOVERY_CLAIMS = [
  "adminId",
  "audited",
  "observationWindowRevalidated",
  "cutoverReady",
  "e52SwitchAllowed",
  "executedConsumer",
  "directMutatorsRetired",
] as const;

export type ConsumptionShadowRecord = ConsumptionObservation & {
  source: (typeof SHADOW_SOURCES)[number];
  livePath: (typeof SHADOW_LIVE_PATHS)[number];
  liveExecuted: boolean;
  persistenceFailure?: boolean;
};

export type ServerResolvedAdmin = {
  readonly adminId: string;
};

const issuedRecoveryAdmins = new WeakSet<object>();

class ShadowStoreCorruptError extends Error {
  constructor() {
    super("shadow consumption store is corrupt");
    this.name = "ShadowStoreCorruptError";
  }
}

function shadowPath(configDir: string = CONFIG_DIR): string {
  return path.join(
    configDir,
    "evolution-governance",
    "control-plane-application-consumption.jsonl",
  );
}

function blankHealth(): ShadowStoreHealth {
  return {
    observationStoreHealthy: true,
    corruptionCount: 0,
    unsupportedSchemaCount: 0,
    truncated: false,
    persistenceFailure: false,
  };
}

function finishHealth(health: ShadowStoreHealth): void {
  health.observationStoreHealthy =
    health.corruptionCount === 0 &&
    health.unsupportedSchemaCount === 0 &&
    !health.truncated &&
    !health.persistenceFailure;
}

function scanShadowFile(configDir: string): {
  rows: ConsumptionShadowRecord[];
  health: ShadowStoreHealth;
  detected: ShadowStoreFaultKind[];
  storePresent: boolean;
} {
  const health = blankHealth();
  const detected: ShadowStoreFaultKind[] = [];
  const filePath = shadowPath(configDir);
  try {
    if (!fs.existsSync(filePath)) {
      finishHealth(health);
      return { rows: [], health, detected, storePresent: false };
    }
    if (!fs.statSync(filePath).isFile()) {
      health.persistenceFailure = true;
      detected.push("read_failure");
      finishHealth(health);
      return { rows: [], health, detected, storePresent: true };
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const truncated = raw.length > 0 && !raw.endsWith("\n");
    let structuralCorruption = 0;
    if (truncated) {
      health.truncated = true;
      health.corruptionCount += 1;
      detected.push("truncated");
    }
    const lines = raw.split("\n");
    const rows: ConsumptionShadowRecord[] = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] ?? "";
      if (!line.trim()) {
        continue;
      }
      const lastPartial = truncated && index === lines.length - 1;
      let parsed: ConsumptionShadowRecord;
      try {
        parsed = JSON.parse(line) as ConsumptionShadowRecord;
      } catch {
        if (!lastPartial) {
          structuralCorruption += 1;
          health.corruptionCount += 1;
        }
        continue;
      }
      if (parsed?.schemaVersion !== APPLICATION_CONSUMPTION_SCHEMA) {
        health.unsupportedSchemaCount += 1;
        continue;
      }
      if (typeof parsed.idempotencyKey !== "string" || parsed.idempotencyKey.trim() === "") {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      const executedConsumer: unknown = parsed.executedConsumer;
      if (executedConsumer !== false) {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      if (
        typeof parsed.source === "string" &&
        !(SHADOW_SOURCES as readonly string[]).includes(parsed.source)
      ) {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      if (
        typeof parsed.livePath === "string" &&
        !(SHADOW_LIVE_PATHS as readonly string[]).includes(parsed.livePath)
      ) {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      const directMutatorsRetired: unknown = (parsed as { directMutatorsRetired?: unknown })
        .directMutatorsRetired;
      const liveExecuted: unknown = parsed.liveExecuted;
      if (directMutatorsRetired === true || (parsed.source === "a9-m1" && liveExecuted !== false)) {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      if (typeof parsed.recordedAt !== "string" || parsed.recordedAt.trim() === "") {
        structuralCorruption += 1;
        health.corruptionCount += 1;
        continue;
      }
      rows.push({ ...parsed, executedConsumer: false });
    }
    if (structuralCorruption > 0) {
      detected.push("corrupt");
    }
    if (health.unsupportedSchemaCount > 0) {
      detected.push("unsupported_schema");
    }
    finishHealth(health);
    return { rows, health, detected, storePresent: true };
  } catch {
    health.persistenceFailure = true;
    detected.push("read_failure");
    finishHealth(health);
    return { rows: [], health, detected, storePresent: true };
  }
}

function readStore(configDir: string = CONFIG_DIR): {
  rows: ConsumptionShadowRecord[];
  health: ShadowStoreHealth;
} {
  try {
    const scanned = scanShadowFile(configDir);
    if (scanned.detected.length > 0) {
      latchShadowStoreFaults(configDir, scanned.detected);
    }
    return {
      rows: scanned.rows,
      health: projectShadowStoreHealth(configDir, scanned.health, scanned.storePresent),
    };
  } catch {
    latchShadowStoreFaults(configDir, ["read_failure"]);
    const health = blankHealth();
    health.persistenceFailure = true;
    finishHealth(health);
    return { rows: [], health: projectShadowStoreHealth(configDir, health, true) };
  }
}

function writeRows(rows: readonly ConsumptionShadowRecord[], configDir: string): void {
  const filePath = shadowPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const clipped = rows.slice(-MAX_ROWS);
  const payload =
    clipped.length === 0 ? "" : `${clipped.map((row) => JSON.stringify(row)).join("\n")}\n`;
  const tmpPath = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(tmpPath, payload);
    fs.renameSync(tmpPath, filePath);
  } catch (error) {
    fs.rmSync(tmpPath, { force: true });
    throw error;
  }
}

function orphanBinding(input: {
  intent: ConsumptionIntent;
  idempotencyKey: string;
  mode: EvolutionGovernanceMode;
  killSwitch: boolean;
  now: string;
  binding?: ControlPlaneConsumptionBinding | null;
}): ControlPlaneConsumptionBinding {
  if (input.binding) {
    return input.binding;
  }
  return {
    proposal: null,
    experiment: null,
    application: null,
    grant: null,
    trustedTenantId: input.intent.tenantScope,
    mode: input.mode,
    killSwitch: input.killSwitch,
    now: input.now,
    storedCandidate: null,
    rollbackAvailable: false,
    idempotencyKey: input.idempotencyKey,
    priorConsumption: null,
    intent: input.intent,
  };
}

function record(input: {
  source: ConsumptionShadowRecord["source"];
  livePath: ConsumptionShadowRecord["livePath"];
  liveExecuted: boolean;
  directIntentPresent?: boolean;
  recordedAt: string;
  binding: ControlPlaneConsumptionBinding;
  configDir: string;
}): ConsumptionShadowRecord {
  const decision: ControlPlaneApplicationConsumption = evaluateControlPlaneApplicationConsumption(
    input.binding,
  );
  const next: ConsumptionShadowRecord = {
    ...decision,
    recordedAt: input.recordedAt,
    directIntentPresent: input.directIntentPresent ?? true,
    source: input.source,
    livePath: input.livePath,
    liveExecuted: input.liveExecuted,
    executedConsumer: false,
  };
  const existing = readStore(input.configDir);
  if (!existing.health.observationStoreHealthy) {
    throw new ShadowStoreCorruptError();
  }
  const rows = existing.rows.filter(
    (stored) =>
      !(
        stored.idempotencyKey === next.idempotencyKey &&
        stored.source === next.source &&
        stored.recordedAt === next.recordedAt
      ),
  );
  rows.push(next);
  writeRows(rows, input.configDir);
  attestShadowStoreWrite(input.configDir, rows.length);
  return next;
}

function failedWrite(
  binding: ControlPlaneConsumptionBinding,
  input: {
    source: ConsumptionShadowRecord["source"];
    livePath: ConsumptionShadowRecord["livePath"];
    liveExecuted: boolean;
    recordedAt: string;
    configDir: string;
  },
): ConsumptionShadowRecord {
  latchShadowStoreFaults(input.configDir, ["write_failure"]);
  const decision = evaluateControlPlaneApplicationConsumption(binding);
  return {
    ...decision,
    recordedAt: input.recordedAt,
    directIntentPresent: true,
    source: input.source,
    livePath: input.livePath,
    liveExecuted: input.liveExecuted,
    executedConsumer: false,
    persistenceFailure: true,
  };
}

/** Shadow the runtime auto intent. Does not pause, resume, limit, or clear a limit. */
export function observeRuntimeAutoConsumption(input: {
  commandId: string;
  runtimeAgentId: string;
  action: RuntimeConsumptionAction;
  liveExecuted: boolean;
  mode: EvolutionGovernanceMode;
  killSwitch: boolean;
  tenantScope?: string | null;
  binding?: ControlPlaneConsumptionBinding | null;
  configDir?: string;
  recordedAt?: string;
}): ConsumptionShadowRecord {
  const commandId = input.commandId.trim();
  const runtimeAgentId = input.runtimeAgentId.trim();
  const intent: ConsumptionIntent = {
    kind: "runtime-action",
    surfaceId: "system.runtime-binding-governance",
    adapterId: "runtime-governance",
    runtimeAgentId,
    action: input.action,
    approvedAction: input.action,
    candidateVersion: input.binding?.intent.candidateVersion ?? "",
    tenantScope: input.tenantScope ?? input.binding?.intent.tenantScope ?? null,
  };
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const registeredBinding =
    !input.binding && input.mode === "assist" && !input.liveExecuted
      ? registerControlPlaneIntent({
          commandId,
          intent,
          mode: input.mode,
          killSwitch: input.killSwitch,
          recordedAt,
        })
      : null;
  const binding = input.binding
    ? {
        ...input.binding,
        intent,
        idempotencyKey: commandId,
        mode: input.mode,
        killSwitch: input.killSwitch,
        now: recordedAt,
      }
    : (registeredBinding ??
      orphanBinding({
        intent,
        idempotencyKey: commandId,
        mode: input.mode,
        killSwitch: input.killSwitch,
        now: recordedAt,
      }));
  try {
    return record({
      source: "runtime-auto-tick",
      livePath: "direct-runtime-action",
      liveExecuted: input.liveExecuted,
      recordedAt,
      configDir: input.configDir ?? CONFIG_DIR,
      binding,
    });
  } catch (error) {
    if (error instanceof ShadowStoreCorruptError) {
      const decision = evaluateControlPlaneApplicationConsumption(binding);
      return {
        ...decision,
        recordedAt,
        directIntentPresent: true,
        source: "runtime-auto-tick",
        livePath: "direct-runtime-action",
        liveExecuted: input.liveExecuted,
        executedConsumer: false,
      };
    }
    return failedWrite(binding, {
      source: "runtime-auto-tick",
      livePath: "direct-runtime-action",
      liveExecuted: input.liveExecuted,
      recordedAt,
      configDir: input.configDir ?? CONFIG_DIR,
    });
  }
}

/** Shadow the skill-auto install intent. Does not install a skill. */
export function observeSkillAutoConsumption(input: {
  commandId: string;
  agentId: string;
  skillId: string;
  version?: string;
  autoInstallIntent: boolean;
  approvalAuditRef?: string;
  liveExecuted: boolean;
  mode: EvolutionGovernanceMode;
  killSwitch: boolean;
  tenantScope?: string | null;
  binding?: ControlPlaneConsumptionBinding | null;
  configDir?: string;
  recordedAt?: string;
}): ConsumptionShadowRecord {
  const intent: ConsumptionIntent = {
    kind: "skill-install",
    surfaceId: "capability.skill-installation",
    adapterId: "skill-installation",
    agentId: input.agentId.trim(),
    skillId: input.skillId.trim(),
    version: input.version ?? "",
    approvedAction: "install",
    candidateVersion: input.version ?? input.binding?.intent.candidateVersion ?? "",
    autoInstallIntent: input.autoInstallIntent,
    approvalAuditRef: input.approvalAuditRef ?? "",
    tenantScope: input.tenantScope ?? null,
  };
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const commandId = input.commandId.trim();
  const registeredBinding =
    !input.binding && input.mode === "assist" && !input.liveExecuted
      ? registerControlPlaneIntent({
          commandId,
          intent,
          mode: input.mode,
          killSwitch: input.killSwitch,
          recordedAt,
        })
      : null;
  const binding = input.binding
    ? {
        ...input.binding,
        intent,
        idempotencyKey: commandId,
        mode: input.mode,
        killSwitch: input.killSwitch,
        now: recordedAt,
      }
    : (registeredBinding ??
      orphanBinding({
        intent,
        idempotencyKey: commandId,
        mode: input.mode,
        killSwitch: input.killSwitch,
        now: recordedAt,
      }));
  try {
    return record({
      source: "skill-auto-pass",
      livePath: "direct-skill-install",
      liveExecuted: input.liveExecuted,
      recordedAt,
      configDir: input.configDir ?? CONFIG_DIR,
      binding,
    });
  } catch (error) {
    if (error instanceof ShadowStoreCorruptError) {
      const decision = evaluateControlPlaneApplicationConsumption(binding);
      return {
        ...decision,
        recordedAt,
        directIntentPresent: true,
        source: "skill-auto-pass",
        livePath: "direct-skill-install",
        liveExecuted: input.liveExecuted,
        executedConsumer: false,
      };
    }
    return failedWrite(binding, {
      source: "skill-auto-pass",
      livePath: "direct-skill-install",
      liveExecuted: input.liveExecuted,
      recordedAt,
      configDir: input.configDir ?? CONFIG_DIR,
    });
  }
}

function closedReadiness(): CutoverReadinessReport {
  return evaluateCutoverReadiness({
    observations: [],
    killSwitchDrillPassed: false,
    rollbackDrillPassed: false,
    idempotentReplayPassed: false,
    assistZeroMutation: true,
    store: {
      observationStoreHealthy: false,
      corruptionCount: 1,
      unsupportedSchemaCount: 0,
      truncated: false,
      persistenceFailure: true,
    },
    directMutatorsRetired: false,
  });
}

/**
 * Live readiness. Drill receipts are not implied by shadow rows, so this
 * stays cutoverReady=false until a later approved cutover supplies them.
 * A read exception returns No-Go and does not escape.
 */
export function readSingleTrackCutoverReadiness(
  configDir: string = CONFIG_DIR,
): CutoverReadinessReport {
  try {
    const store = readStore(configDir);
    return evaluateCutoverReadiness({
      observations: store.rows,
      killSwitchDrillPassed: false,
      rollbackDrillPassed: false,
      idempotentReplayPassed: false,
      assistZeroMutation: store.rows.every((row) => !row.executedConsumer),
      store: store.health,
      directMutatorsRetired: false,
    });
  } catch {
    latchShadowStoreFaults(configDir, ["read_failure"]);
    try {
      return closedReadiness();
    } catch {
      return closedReadinessFallback();
    }
  }
}

function closedReadinessFallback(): CutoverReadinessReport {
  const closed = {
    matchedApplications: 0,
    orphanDirectMutations: 0,
    targetMismatch: 0,
    tenantMismatch: 0,
    missingGrant: 0,
    missingRollback: 0,
    duplicateConsumption: 0,
    crossTenantEvents: 0,
    actionMismatch: 0,
    killSwitchDrillPassed: false,
    rollbackDrillPassed: false,
    idempotentReplayPassed: false,
    assistZeroMutation: true,
    alignmentComplete: false,
    denyCounts: {},
    unresolvedDenials: 0,
    observationStoreHealthy: false,
    corruptionCount: 1,
    unsupportedSchemaCount: 0,
    truncated: false,
    persistenceFailure: true,
    shadowObservationWindow: { startedAt: null, endedAt: null, sampleCount: 0 },
    cutoverReady: false,
    e52SwitchAllowed: false,
  };
  return closed as CutoverReadinessReport;
}

export function listControlPlaneApplicationConsumptions(
  configDir: string = CONFIG_DIR,
): ConsumptionShadowRecord[] {
  try {
    return readStore(configDir).rows;
  } catch {
    return [];
  }
}

function clientRecoveryClaimPresent(input: object): boolean {
  return CLIENT_RECOVERY_CLAIMS.some((key) => key in input);
}

/**
 * Issue an admin identity only after the server authority accepts the id.
 * A client object that also carries audited, cutover, or execution claims
 * is rejected before any identity is issued.
 */
export function resolveServerAdmin(input: {
  adminId: string;
  authority: ShadowRecoveryAuthority;
  clientClaims?: object | null;
}): ServerResolvedAdmin | null {
  if (input.clientClaims && clientRecoveryClaimPresent(input.clientClaims)) {
    return null;
  }
  const adminId = input.adminId.trim();
  const adminOk: unknown = input.authority.verifyAdmin(adminId);
  if (!adminId || adminOk !== true) {
    return null;
  }
  const admin: ServerResolvedAdmin = { adminId };
  issuedRecoveryAdmins.add(admin);
  return admin;
}

export type A9M1ShadowObservation = {
  classification: A9M1Classification;
  bindingMatched: boolean;
  record: ConsumptionShadowRecord | null;
  readiness: CutoverReadinessReport;
  observationWindow: CutoverReadinessReport["shadowObservationWindow"];
  denialCounts: CutoverReadinessReport["denyCounts"];
  unresolvedDenials: number;
  healthChain: "present" | "missing" | "untrusted";
  directMutatorsRetired: false;
  executedConsumer: false;
  isE52CutoverReceipt: false;
};

function a9Observation(
  configDir: string,
  classification: A9M1Classification,
  bindingMatched: boolean,
  row: ConsumptionShadowRecord | null,
): A9M1ShadowObservation {
  const readiness = readSingleTrackCutoverReadiness(configDir);
  return {
    classification,
    bindingMatched,
    record: row,
    readiness,
    observationWindow: readiness.shadowObservationWindow,
    denialCounts: readiness.denyCounts,
    unresolvedDenials: readiness.unresolvedDenials,
    healthChain: describeShadowHealthChain(configDir),
    directMutatorsRetired: false,
    executedConsumer: false,
    isE52CutoverReceipt: false,
  };
}

/**
 * Record an A9 M1 fact against the server binding. Forged cutover, drill,
 * and execution fields on the event are ignored. This does not Apply.
 */
export function observeA9M1Shadow(input: {
  event: A9M1Event;
  binding?: ControlPlaneConsumptionBinding | null;
  configDir?: string;
}): A9M1ShadowObservation {
  const configDir = input.configDir ?? CONFIG_DIR;
  const classification = classifyA9M1Event(input.event);
  if (!classification.accepted || !classification.recordedAt) {
    return a9Observation(configDir, classification, false, null);
  }
  const serverBinding = input.binding ?? null;
  const bindingMatched = Boolean(
    serverBinding?.proposal &&
    serverBinding.experiment &&
    serverBinding.application &&
    serverBinding.proposal.proposalId === classification.proposalId &&
    serverBinding.experiment.experimentId === classification.experimentId &&
    serverBinding.application.applicationId === classification.applicationId,
  );
  const recordedAt = classification.recordedAt;
  const intent: ConsumptionIntent = serverBinding?.intent ?? {
    kind: "runtime-action",
    surfaceId: "system.runtime-binding-governance",
    adapterId: "runtime-governance",
    runtimeAgentId: "",
    action: "pause",
    approvedAction: "pause",
    candidateVersion: "",
    tenantScope: null,
  };
  const binding: ControlPlaneConsumptionBinding =
    bindingMatched && serverBinding
      ? {
          ...serverBinding,
          intent,
          now: recordedAt,
        }
      : orphanBinding({
          intent,
          idempotencyKey: `a9-m1:${classification.proposalId ?? "unbound"}:${recordedAt}`,
          mode: serverBinding?.mode ?? "assist",
          killSwitch: serverBinding?.killSwitch ?? false,
          now: recordedAt,
        });
  try {
    const row = record({
      source: "a9-m1",
      livePath: "diagnosis-m1-observation",
      liveExecuted: false,
      directIntentPresent: false,
      recordedAt,
      configDir,
      binding,
    });
    return a9Observation(configDir, classification, bindingMatched, row);
  } catch (error) {
    if (error instanceof ShadowStoreCorruptError) {
      return a9Observation(configDir, classification, bindingMatched, null);
    }
    const failed = failedWrite(binding, {
      source: "a9-m1",
      livePath: "diagnosis-m1-observation",
      liveExecuted: false,
      recordedAt,
      configDir,
    });
    return a9Observation(configDir, classification, bindingMatched, {
      ...failed,
      directIntentPresent: false,
      executedConsumer: false,
    });
  }
}

/**
 * Recovery accepts only an admin identity already issued by resolveServerAdmin.
 * Client boolean claims and a raw adminId string do not clear the latch.
 * Does not Apply and does not retire direct mutators.
 */
export function recoverPersistedShadowStoreHealth(input: {
  configDir?: string;
  admin?: ServerResolvedAdmin;
  reason: string;
  authority?: ShadowRecoveryAuthority;
  adminId?: string;
  audited?: unknown;
  observationWindowRevalidated?: unknown;
  cutoverReady?: unknown;
  e52SwitchAllowed?: unknown;
  executedConsumer?: unknown;
  directMutatorsRetired?: unknown;
}): { cleared: boolean; reason: string } {
  if (clientRecoveryClaimPresent(input) || !input.admin || !input.authority) {
    return { cleared: false, reason: "client_claim_rejected" };
  }
  if (!issuedRecoveryAdmins.has(input.admin)) {
    return { cleared: false, reason: "admin_rejected" };
  }
  return recoverShadowStoreHealth({
    configDir: input.configDir ?? CONFIG_DIR,
    adminId: input.admin.adminId,
    reason: input.reason,
    authority: input.authority,
  });
}

function rmQuiet(filePath: string): void {
  try {
    fs.rmSync(filePath, { force: true });
  } catch {
    // A non-directory parent cannot hold the shadow file. Tests still continue.
  }
}

export function resetControlPlaneApplicationConsumptionForTests(
  configDir: string = CONFIG_DIR,
): void {
  removeShadowStoreHealthFiles(configDir);
  rmQuiet(shadowPath(configDir));
  const directory = path.dirname(shadowPath(configDir));
  if (!fs.existsSync(directory)) {
    return;
  }
  let names: string[] = [];
  try {
    names = fs.readdirSync(directory);
  } catch {
    return;
  }
  const prefix = `${path.basename(shadowPath(configDir))}.`;
  for (const name of names) {
    if (name.startsWith(prefix) && name.endsWith(".tmp")) {
      rmQuiet(path.join(directory, name));
    }
  }
}
