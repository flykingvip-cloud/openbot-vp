import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ApplyEvolutionInput } from "@openbot/evolution-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { DEFAULT_WORKING_STYLE } from "../agent-growth/genome.js";
import {
  readRobotWorkingStyleOrDefault,
  writeRobotWorkingStyle,
  workingStyleVersion,
} from "../agent-growth/working-style-store.js";
import { createWorkingDnaAdapter, type WorkingDnaCandidate } from "./adapters/working-dna.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "working-dna-cas-"));
  roots.push(root);
  const cfg: OpenBotConfig = { agents: { list: [{ id: "bot", agentDir: root }] } };
  const adapter = createWorkingDnaAdapter(cfg, { persistDir: path.join(root, "adapter") });
  const candidate: WorkingDnaCandidate = {
    agentId: "bot",
    baselineStyle: DEFAULT_WORKING_STYLE,
    delta: { riskPreference: "conservative" },
    candidateVersion: "candidate",
  };
  const input = {
    candidate,
    idempotencyKey: "apply",
    scope: "canary",
    context: {
      proposal: {
        target: { domain: "agent", agentId: "bot" },
        surfaceId: "agent.working-dna",
        proposalId: "p",
      },
      experiment: { experimentId: "e" },
    },
  } as ApplyEvolutionInput<WorkingDnaCandidate>;
  return { cfg, adapter, input };
}
describe("Working DNA apply/rollback content CAS", () => {
  it("does not overwrite a change inserted after baseline validation", async () => {
    const { cfg, adapter, input } = await setup();
    const validate = adapter.validate.bind(adapter);
    vi.spyOn(adapter, "validate").mockImplementation(async (candidate, context) => {
      const result = await validate(candidate, context);
      await writeRobotWorkingStyle(cfg, "bot", {
        ...DEFAULT_WORKING_STYLE,
        communicationTone: "friendly",
      });
      return result;
    });
    await expect(adapter.apply(input)).rejects.toThrow(/version_conflict|baseline_drift/);
    expect((await readRobotWorkingStyleOrDefault(cfg, "bot")).communicationTone).toBe("friendly");
  });
  it("does not rollback over a later legitimate change", async () => {
    const { cfg, adapter, input } = await setup();
    const app = await adapter.apply(input);
    await writeRobotWorkingStyle(cfg, "bot", {
      ...DEFAULT_WORKING_STYLE,
      communicationTone: "friendly",
    });
    expect((await adapter.rollback(app)).status).toBe("failed");
    expect((await readRobotWorkingStyleOrDefault(cfg, "bot")).communicationTone).toBe("friendly");
  });
  it("enforces scoped expectedVersion even when current becomes the candidate", async () => {
    const { cfg, adapter, input } = await setup();
    const expected = workingStyleVersion(DEFAULT_WORKING_STYLE);
    const validate = adapter.validate.bind(adapter);
    vi.spyOn(adapter, "validate").mockImplementation(async (candidate, context) => {
      const result = await validate(candidate, context);
      await writeRobotWorkingStyle(cfg, "bot", {
        ...DEFAULT_WORKING_STYLE,
        riskPreference: "conservative",
      });
      return result;
    });
    await expect(
      adapter.withExpectedVersion(input.idempotencyKey, expected, () => adapter.apply(input)),
    ).rejects.toThrow("version_conflict");
  });
});
