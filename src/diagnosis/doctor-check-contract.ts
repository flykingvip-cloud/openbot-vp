/**
 * Doctor read-only check contract.
 * Diagnosis may import this module. It must never import the CLI doctor
 * entry, repair executors, config writers, or the interactive prompter.
 *
 * CLI repair stays on the existing maintenance command + --fix/--repair/--yes.
 */
import { resolveSandboxScope } from "../agents/sandbox/config.js";
import type { OpenBotConfig } from "../config/config.js";
import { hasAmbiguousGatewayAuthModeConfig } from "../gateway/auth-mode-policy.js";

export const DOCTOR_CHECK_ENTRY = "runDoctorChecks";
export const DOCTOR_REPAIR_ENTRY = "cli-doctor-entry";

export type DoctorCheckVerdict = "pass" | "warn" | "fail";

export type DoctorCheckRow = {
  checkId: string;
  verdict: DoctorCheckVerdict;
  pathLabel: string;
  detail?: string;
};

export type DoctorCheckInput = {
  config: OpenBotConfig;
  env?: NodeJS.ProcessEnv;
  configPath?: string;
};

export function assertDoctorCheckInputReadOnly(input: object): void {
  const flags = input as { repair?: boolean; fix?: boolean; yes?: boolean };
  if (flags.repair === true || flags.fix === true || flags.yes === true) {
    throw new Error("Doctor check contract refuses repair/fix/yes — read-only checks only");
  }
}

export function runDoctorChecks(input: DoctorCheckInput): DoctorCheckRow[] {
  assertDoctorCheckInputReadOnly(input);
  const cfg = input.config;
  const rows: DoctorCheckRow[] = [];

  if (!cfg.gateway?.mode) {
    rows.push({
      checkId: "gateway-mode",
      verdict: "fail",
      pathLabel: "gateway.mode",
      detail: "unset",
    });
  } else {
    rows.push({
      checkId: "gateway-mode",
      verdict: "pass",
      pathLabel: "gateway.mode",
    });
  }

  if (cfg.gateway?.mode === "local" && hasAmbiguousGatewayAuthModeConfig(cfg)) {
    rows.push({
      checkId: "gateway-auth-mode",
      verdict: "fail",
      pathLabel: "gateway.auth.mode",
      detail: "ambiguous token+password without mode",
    });
  } else {
    rows.push({
      checkId: "gateway-auth-mode",
      verdict: "pass",
      pathLabel: "gateway.auth.mode",
    });
  }

  rows.push(...collectSandboxScopeCheckRows(cfg));
  return rows;
}

function collectSandboxScopeCheckRows(cfg: OpenBotConfig): DoctorCheckRow[] {
  const globalSandbox = cfg.agents?.defaults?.sandbox;
  const agents = Array.isArray(cfg.agents?.list) ? cfg.agents.list : [];
  const rows: DoctorCheckRow[] = [];
  for (const agent of agents) {
    const agentSandbox = agent.sandbox;
    if (!agentSandbox) {
      continue;
    }
    const scope = resolveSandboxScope({
      scope: agentSandbox.scope ?? globalSandbox?.scope,
      perSession: agentSandbox.perSession ?? globalSandbox?.perSession,
    });
    if (scope !== "shared") {
      continue;
    }
    const overrides = ["docker", "browser", "prune"].filter((key) => {
      const value = agentSandbox[key as "docker" | "browser" | "prune"];
      return Boolean(value && Object.keys(value).length > 0);
    });
    if (overrides.length === 0) {
      continue;
    }
    rows.push({
      checkId: "sandbox-shared-override",
      verdict: "warn",
      pathLabel: `agents.list.${agent.id}.sandbox`,
      detail: `${overrides.join("/")} overrides ignored under shared scope`,
    });
  }
  return rows;
}
