import os from "node:os";
import path from "node:path";

type LooseRecord = Record<string, unknown>;

/** Non-git temp cwd so write-roots do not require D1e identity in unit tests. */
export const CRON_ISOLATED_AGENT_FIXTURE_WORKSPACE = path.join(
  os.tmpdir(),
  "openbot-cron-isolated-agent-workspace",
);

export function cronIsolatedAgentFixtureCfg() {
  return {
    agents: {
      defaults: {
        workspace: CRON_ISOLATED_AGENT_FIXTURE_WORKSPACE,
      },
    },
  };
}

export function makeIsolatedAgentJobFixture(overrides?: LooseRecord) {
  return {
    id: "test-job",
    name: "Test Job",
    schedule: { kind: "cron", expr: "0 9 * * *", tz: "UTC" },
    sessionTarget: "isolated",
    payload: { kind: "agentTurn", message: "test" },
    ...overrides,
  } as never;
}

function ensureFixtureWorkspace(cfg: unknown): LooseRecord {
  const record = cfg && typeof cfg === "object" ? (cfg as LooseRecord) : {};
  const agents =
    record.agents && typeof record.agents === "object" ? (record.agents as LooseRecord) : {};
  const defaults =
    agents.defaults && typeof agents.defaults === "object" ? (agents.defaults as LooseRecord) : {};
  if (typeof defaults.workspace === "string" && defaults.workspace.trim()) {
    return record;
  }
  return {
    ...record,
    agents: {
      ...agents,
      defaults: {
        ...defaults,
        workspace: CRON_ISOLATED_AGENT_FIXTURE_WORKSPACE,
      },
    },
  };
}

export function makeIsolatedAgentParamsFixture(overrides?: LooseRecord) {
  const jobOverrides =
    overrides && "job" in overrides ? (overrides.job as LooseRecord | undefined) : undefined;
  const base = {
    cfg: cronIsolatedAgentFixtureCfg(),
    deps: {} as never,
    job: makeIsolatedAgentJobFixture(jobOverrides),
    message: "test",
    sessionKey: "cron:test",
    ...overrides,
  };
  return {
    ...base,
    cfg: ensureFixtureWorkspace(base.cfg),
  };
}
