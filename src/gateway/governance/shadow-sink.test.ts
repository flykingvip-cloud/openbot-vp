import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGovernanceDecision } from "./decision.js";
import {
  appendGovernanceShadowDecision,
  GOVERNANCE_SHADOW_LOG_ENV,
  governanceShadowDecisionsPath,
  isGovernanceShadowLogEnabled,
} from "./shadow-sink.js";

const decision = createGovernanceDecision({
  effect: "deny",
  decisionId: "gd-sink-1",
  source: "model-entitlement",
  mode: "shadow",
  runId: "run-1",
  commercialAuthorizationId: "auth-1",
  ts: "2026-09-27T00:00:00.000Z",
});

describe("governance shadow sink", () => {
  let configDir: string;

  beforeEach(async () => {
    configDir = await fs.mkdtemp(path.join(os.tmpdir(), "openbot-gov-sink-"));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(configDir, { recursive: true, force: true });
  });

  it("is off by default", () => {
    expect(isGovernanceShadowLogEnabled({})).toBe(false);
    expect(isGovernanceShadowLogEnabled({ [GOVERNANCE_SHADOW_LOG_ENV]: "0" })).toBe(false);
    expect(isGovernanceShadowLogEnabled({ [GOVERNANCE_SHADOW_LOG_ENV]: "1" })).toBe(true);
  });

  it("writes nothing when the flag is off", async () => {
    const wrote = await appendGovernanceShadowDecision(decision, { env: {}, configDir });
    expect(wrote).toBe(false);
    await expect(fs.stat(path.join(configDir, "audit"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("appends one JSON line per decision when the flag is on", async () => {
    const env = { [GOVERNANCE_SHADOW_LOG_ENV]: "true" };
    expect(await appendGovernanceShadowDecision(decision, { env, configDir })).toBe(true);
    expect(
      await appendGovernanceShadowDecision(
        { ...decision, decisionId: "gd-sink-2" },
        {
          env,
          configDir,
        },
      ),
    ).toBe(true);
    const filePath = governanceShadowDecisionsPath(configDir);
    expect(filePath).toBe(path.join(configDir, "audit", "governance-shadow-decisions.jsonl"));
    const lines = (await fs.readFile(filePath, "utf8")).trim().split("\n");
    expect(lines.map((line) => JSON.parse(line).decisionId)).toEqual(["gd-sink-1", "gd-sink-2"]);
    if (process.platform !== "win32") {
      expect((await fs.stat(filePath)).mode & 0o777).toBe(0o600);
      expect((await fs.stat(path.dirname(filePath))).mode & 0o777).toBe(0o700);
    }
  });

  it("never throws when the write fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const blocker = path.join(configDir, "blocked");
    await fs.writeFile(blocker, "not a directory");
    const wrote = await appendGovernanceShadowDecision(decision, {
      env: { [GOVERNANCE_SHADOW_LOG_ENV]: "1" },
      configDir: blocker,
    });
    expect(wrote).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("[governance]"));
  });
});
