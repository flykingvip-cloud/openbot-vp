/**
 * P2 observe / canary standby locks for production validators.
 *
 * OPENBOT_CANARY_VALIDATORS empty or unset must keep json-canvas (and any
 * production validator) inert: no enable, no registration, no gated contract.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JSON_CANVAS_VALIDATOR_ID } from "./json-canvas-validator.js";
import {
  ensureProductionValidatorsRegistered,
  gateProductionCanaryContract,
  productionCanaryEnabled,
  setProductionValidatorRegistrationForTest,
} from "./production-validators.js";
import type { SkillRuntimeContract } from "./skill-contract.js";
import { isTrustedValidatorRegistered, resetValidationStateForTest } from "./validation.js";

function canvasContract(): SkillRuntimeContract {
  return {
    skillId: "json-canvas",
    aliases: [],
    forbiddenFinalEngines: [],
    requiredValidators: [JSON_CANVAS_VALIDATOR_ID],
    allowedTools: ["read", "write"],
    forbiddenTools: [],
    requiredReferences: [],
    requiredConfirmations: [],
    requiredArtifacts: ["board.canvas"],
    deliveryConditions: [],
    generationStageTools: ["read", "write", "edit"],
    deliveryStageTools: ["message"],
    triggers: ["canvas"],
    supportedUiComponents: [],
  };
}

describe("production validators standby (OPENBOT_CANARY_VALIDATORS)", () => {
  const previous = process.env.OPENBOT_CANARY_VALIDATORS;

  beforeEach(() => {
    setProductionValidatorRegistrationForTest(true);
    resetValidationStateForTest();
  });

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.OPENBOT_CANARY_VALIDATORS;
    } else {
      process.env.OPENBOT_CANARY_VALIDATORS = previous;
    }
    setProductionValidatorRegistrationForTest(true);
    resetValidationStateForTest();
  });

  it("productionCanaryEnabled is false when env is unset or empty", () => {
    delete process.env.OPENBOT_CANARY_VALIDATORS;
    expect(productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)).toBe(false);

    process.env.OPENBOT_CANARY_VALIDATORS = "";
    expect(productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)).toBe(false);

    process.env.OPENBOT_CANARY_VALIDATORS = "   ,  , ";
    expect(productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)).toBe(false);
  });

  it("productionCanaryEnabled is true only when the env names the validator id", () => {
    process.env.OPENBOT_CANARY_VALIDATORS = `other,${JSON_CANVAS_VALIDATOR_ID}`;
    expect(productionCanaryEnabled(JSON_CANVAS_VALIDATOR_ID)).toBe(true);
    expect(productionCanaryEnabled("other")).toBe(true);
    expect(productionCanaryEnabled("hook-delivery")).toBe(false);
  });

  it("gateProductionCanaryContract returns undefined for json-canvas when canary is off", () => {
    delete process.env.OPENBOT_CANARY_VALIDATORS;
    expect(gateProductionCanaryContract(canvasContract())).toBeUndefined();
    expect(isTrustedValidatorRegistered(JSON_CANVAS_VALIDATOR_ID)).toBe(false);
  });

  it("gateProductionCanaryContract passes through contracts that do not require json-canvas", () => {
    delete process.env.OPENBOT_CANARY_VALIDATORS;
    const plain: SkillRuntimeContract = {
      ...canvasContract(),
      skillId: "plain",
      requiredValidators: [],
      requiredArtifacts: [],
    };
    expect(gateProductionCanaryContract(plain)).toEqual(plain);
  });

  it("ensureProductionValidatorsRegistered registers nothing when canary is unset", () => {
    delete process.env.OPENBOT_CANARY_VALIDATORS;
    ensureProductionValidatorsRegistered();
    expect(isTrustedValidatorRegistered(JSON_CANVAS_VALIDATOR_ID)).toBe(false);
  });

  it("ensureProductionValidatorsRegistered registers when the env names json-canvas", () => {
    process.env.OPENBOT_CANARY_VALIDATORS = JSON_CANVAS_VALIDATOR_ID;
    ensureProductionValidatorsRegistered();
    expect(isTrustedValidatorRegistered(JSON_CANVAS_VALIDATOR_ID)).toBe(true);
  });
});
