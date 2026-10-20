import { afterEach, describe, expect, it } from "vitest";
import { getFabricService, setFabricServiceProvider } from "../gateway/server-methods/fabric.js";
import { FABRIC_ENABLED_ENV, isFabricEnabled } from "./feature.js";

afterEach(() => {
  setFabricServiceProvider(null);
  delete process.env[FABRIC_ENABLED_ENV];
});

describe("feature — isFabricEnabled (default off, R13.1)", () => {
  const noConfig = () => false;

  it("is off when unset or falsey", () => {
    expect(isFabricEnabled({}, noConfig)).toBe(false);
    expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: "0" }, noConfig)).toBe(false);
    expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: "false" }, noConfig)).toBe(false);
    expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: "" }, noConfig)).toBe(false);
  });

  it("is on for 1/true/yes/on (case-insensitive)", () => {
    for (const v of ["1", "true", "TRUE", "yes", "on"]) {
      expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: v }, noConfig)).toBe(true);
    }
  });

  it("is on when the config source enables it (platform toggle), even with env unset", () => {
    expect(isFabricEnabled({}, () => true)).toBe(true);
  });

  it("env OR config — either source enables", () => {
    expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: "0" }, () => true)).toBe(true);
    expect(isFabricEnabled({ [FABRIC_ENABLED_ENV]: "1" }, () => false)).toBe(true);
    expect(isFabricEnabled({}, () => false)).toBe(false);
  });
});

describe("feature — getFabricService env gating", () => {
  it("returns null when off (no provider, env unset) → handlers report UNAVAILABLE", () => {
    setFabricServiceProvider(null);
    delete process.env[FABRIC_ENABLED_ENV];
    expect(getFabricService()).toBeNull();
  });

  it("returns a default (fail-closed) service when env-enabled", () => {
    setFabricServiceProvider(null);
    process.env[FABRIC_ENABLED_ENV] = "1";
    expect(getFabricService()).not.toBeNull();
  });

  it("explicit provider wins over env default", () => {
    const sentinel = {} as never;
    setFabricServiceProvider(() => sentinel);
    delete process.env[FABRIC_ENABLED_ENV];
    expect(getFabricService()).toBe(sentinel);
  });
});
