import { afterEach, describe, expect, it } from "vitest";
import {
  getEvolutionGovernanceMode,
  isEvolutionAutoRecoveryEnabled,
  isEvolutionAutoRuntimeMutationEnabled,
  isEvolutionGovernancePipelineEnabled,
  setEvolutionGovernanceModeForTests,
} from "./mode.js";

describe("evolution governance mode", () => {
  afterEach(() => {
    setEvolutionGovernanceModeForTests(null);
    delete process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE;
  });

  it("defaults to assist (detect/suggest only, no runtime mutation)", () => {
    setEvolutionGovernanceModeForTests(null);
    delete process.env.OPENBOT_EVOLUTION_GOVERNANCE_MODE;
    expect(getEvolutionGovernanceMode()).toBe("assist");
    expect(isEvolutionGovernancePipelineEnabled()).toBe(true);
    expect(isEvolutionAutoRecoveryEnabled()).toBe(false);
    expect(isEvolutionAutoRuntimeMutationEnabled()).toBe(false);
  });

  it("auto enables recovery and runtime mutation", () => {
    setEvolutionGovernanceModeForTests("auto");
    expect(isEvolutionAutoRecoveryEnabled()).toBe(true);
    expect(isEvolutionAutoRuntimeMutationEnabled()).toBe(true);
  });

  it("off disables pipeline and mutation", () => {
    setEvolutionGovernanceModeForTests("off");
    expect(isEvolutionGovernancePipelineEnabled()).toBe(false);
    expect(isEvolutionAutoRuntimeMutationEnabled()).toBe(false);
  });
});
