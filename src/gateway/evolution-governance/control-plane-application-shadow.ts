/**
 * E5 shadow comparison for historical auto paths.
 *
 * Live tick still calls applyGovernanceRuntimeAction. Live skill-auto still
 * calls installSkillToRobotAsset. This module only records the control-plane
 * Application those paths must consume later. It does not register a Proposal,
 * start an Experiment, Apply, or expand auto.
 *
 * Production cutover stays a later, separately approved change.
 */

import fs from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "../../utils.js";
import type { GovernanceRuntimeAction } from "./runtime-actions.js";

export const CONTROL_PLANE_APPLICATION_SHADOW_SCHEMA = 1 as const;

export type RuntimeAutoShadowAction = Extract<
  GovernanceRuntimeAction,
  "pause" | "resume" | "limit" | "clear_limit"
>;

export type ControlPlaneApplicationShadowRecord = {
  schemaVersion: typeof CONTROL_PLANE_APPLICATION_SHADOW_SCHEMA;
  shadowId: string;
  recordedAt: string;
  source: "runtime-auto-tick" | "skill-auto-pass";
  livePath: "direct-runtime-action" | "direct-skill-install";
  cutoverReady: false;
  intendedApplication: {
    surfaceId: "system.runtime-binding-governance" | "capability.skill-installation";
    adapterId: "runtime-governance" | "skill";
    scope: "shadow";
    appliedToRuntime: false;
    commandId: string;
    target: { domain: "system"; componentId: string } | { domain: "capability"; skillId: string };
    proposedChange:
      | { kind: "runtime-action"; runtimeAgentId: string; action: RuntimeAutoShadowAction }
      | { kind: "skill-install"; agentId: string; skillId: string; operation: "install" };
  };
  liveMutation: {
    kind: RuntimeAutoShadowAction | "install";
    executed: boolean;
    runtimeAgentId?: string;
    skillId?: string;
    agentId?: string;
  };
  aligned: boolean;
};

const MAX_SHADOW_ROWS = 500;

function shadowPath(configDir: string = CONFIG_DIR): string {
  return path.join(configDir, "evolution-governance", "control-plane-application-shadow.jsonl");
}

function readRows(configDir: string = CONFIG_DIR): ControlPlaneApplicationShadowRecord[] {
  const filePath = shadowPath(configDir);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const rows: ControlPlaneApplicationShadowRecord[] = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as ControlPlaneApplicationShadowRecord;
      if (parsed?.schemaVersion === CONTROL_PLANE_APPLICATION_SHADOW_SCHEMA && parsed.shadowId) {
        rows.push(parsed);
      }
    } catch {
      // skip corrupt line
    }
  }
  return rows;
}

function writeRows(
  rows: readonly ControlPlaneApplicationShadowRecord[],
  configDir: string = CONFIG_DIR,
): void {
  const filePath = shadowPath(configDir);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const clipped = rows.slice(-MAX_SHADOW_ROWS);
  fs.writeFileSync(filePath, `${clipped.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function upsert(
  record: ControlPlaneApplicationShadowRecord,
  configDir: string = CONFIG_DIR,
): ControlPlaneApplicationShadowRecord {
  const rows = readRows(configDir).filter((row) => row.shadowId !== record.shadowId);
  rows.push(record);
  writeRows(rows, configDir);
  return record;
}

function sameTarget(
  intended: ControlPlaneApplicationShadowRecord["intendedApplication"]["target"],
  live: ControlPlaneApplicationShadowRecord["liveMutation"],
): boolean {
  if (intended.domain === "system") {
    return intended.componentId === live.runtimeAgentId;
  }
  return intended.skillId === live.skillId;
}

function aligned(record: Omit<ControlPlaneApplicationShadowRecord, "aligned">): boolean {
  const proposed = record.intendedApplication.proposedChange;
  if (proposed.kind === "runtime-action") {
    return (
      !record.intendedApplication.appliedToRuntime &&
      record.intendedApplication.scope === "shadow" &&
      !record.cutoverReady &&
      proposed.action === record.liveMutation.kind &&
      proposed.runtimeAgentId === record.liveMutation.runtimeAgentId &&
      sameTarget(record.intendedApplication.target, record.liveMutation)
    );
  }
  return (
    !record.intendedApplication.appliedToRuntime &&
    record.intendedApplication.scope === "shadow" &&
    !record.cutoverReady &&
    record.liveMutation.kind === "install" &&
    proposed.skillId === record.liveMutation.skillId &&
    proposed.agentId === record.liveMutation.agentId &&
    sameTarget(record.intendedApplication.target, record.liveMutation)
  );
}

/** Record the Application the runtime auto tick must later consume. Does not mutate. */
export function recordRuntimeAutoApplicationShadow(input: {
  commandId: string;
  runtimeAgentId: string;
  action: RuntimeAutoShadowAction;
  liveExecuted: boolean;
  configDir?: string;
}): ControlPlaneApplicationShadowRecord {
  const commandId = input.commandId.trim();
  const runtimeAgentId = input.runtimeAgentId.trim();
  const draft: Omit<ControlPlaneApplicationShadowRecord, "aligned"> = {
    schemaVersion: CONTROL_PLANE_APPLICATION_SHADOW_SCHEMA,
    shadowId: `shadow:runtime-auto:${commandId}`,
    recordedAt: new Date().toISOString(),
    source: "runtime-auto-tick",
    livePath: "direct-runtime-action",
    cutoverReady: false,
    intendedApplication: {
      surfaceId: "system.runtime-binding-governance",
      adapterId: "runtime-governance",
      scope: "shadow",
      appliedToRuntime: false,
      commandId,
      target: { domain: "system", componentId: runtimeAgentId },
      proposedChange: { kind: "runtime-action", runtimeAgentId, action: input.action },
    },
    liveMutation: {
      kind: input.action,
      executed: input.liveExecuted,
      runtimeAgentId,
    },
  };
  return upsert({ ...draft, aligned: aligned(draft) }, input.configDir);
}

/** Record the Application the skill-auto pass must later consume. Does not install. */
export function recordSkillAutoApplicationShadow(input: {
  commandId: string;
  agentId: string;
  skillId: string;
  liveExecuted: boolean;
  configDir?: string;
}): ControlPlaneApplicationShadowRecord {
  const commandId = input.commandId.trim();
  const agentId = input.agentId.trim();
  const skillId = input.skillId.trim();
  const draft: Omit<ControlPlaneApplicationShadowRecord, "aligned"> = {
    schemaVersion: CONTROL_PLANE_APPLICATION_SHADOW_SCHEMA,
    shadowId: `shadow:skill-auto:${commandId}`,
    recordedAt: new Date().toISOString(),
    source: "skill-auto-pass",
    livePath: "direct-skill-install",
    cutoverReady: false,
    intendedApplication: {
      surfaceId: "capability.skill-installation",
      adapterId: "skill",
      scope: "shadow",
      appliedToRuntime: false,
      commandId,
      target: { domain: "capability", skillId },
      proposedChange: { kind: "skill-install", agentId, skillId, operation: "install" },
    },
    liveMutation: {
      kind: "install",
      executed: input.liveExecuted,
      agentId,
      skillId,
    },
  };
  return upsert({ ...draft, aligned: aligned(draft) }, input.configDir);
}

export function listControlPlaneApplicationShadows(
  configDir: string = CONFIG_DIR,
): ControlPlaneApplicationShadowRecord[] {
  return readRows(configDir);
}

export function resetControlPlaneApplicationShadowForTests(configDir: string = CONFIG_DIR): void {
  const filePath = shadowPath(configDir);
  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath, { force: true });
  }
}
