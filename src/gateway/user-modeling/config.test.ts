import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { userModelingEnabled, userModelingInferEnabled } from "./config.js";

describe("userModelingEnabled", () => {
  const prev = process.env.OPENBOT_USER_MODELING;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENBOT_USER_MODELING;
    } else {
      process.env.OPENBOT_USER_MODELING = prev;
    }
  });

  it("defaults to enabled (conservative deterministic mode)", () => {
    delete process.env.OPENBOT_USER_MODELING;
    expect(userModelingEnabled()).toBe(true);
  });

  it("respects OPENBOT_USER_MODELING=off as platform hard-off", () => {
    process.env.OPENBOT_USER_MODELING = "off";
    const cfg = {
      gateway: { userModeling: { enabled: true, tenants: { "tenant-a": { enabled: true } } } },
    } as OpenBotConfig;
    expect(userModelingEnabled(cfg, "tenant-a")).toBe(false);
  });

  it("tenant override takes precedence over global config", () => {
    delete process.env.OPENBOT_USER_MODELING;
    const cfg = {
      gateway: {
        userModeling: {
          enabled: true,
          tenants: { "tenant-a": { enabled: false } },
        },
      },
    } as OpenBotConfig;
    expect(userModelingEnabled(cfg)).toBe(true);
    expect(userModelingEnabled(cfg, "tenant-b")).toBe(true);
    expect(userModelingEnabled(cfg, "tenant-a")).toBe(false);
  });

  it("falls back to global gateway.userModeling.enabled", () => {
    delete process.env.OPENBOT_USER_MODELING;
    expect(
      userModelingEnabled({ gateway: { userModeling: { enabled: false } } } as OpenBotConfig),
    ).toBe(false);
  });
});

describe("userModelingInferEnabled", () => {
  const prev = process.env.OPENBOT_USER_MODELING_INFER;

  afterEach(() => {
    if (prev === undefined) {
      delete process.env.OPENBOT_USER_MODELING_INFER;
    } else {
      process.env.OPENBOT_USER_MODELING_INFER = prev;
    }
  });

  it("defaults to off", () => {
    delete process.env.OPENBOT_USER_MODELING_INFER;
    expect(userModelingInferEnabled()).toBe(false);
  });

  it("enables when OPENBOT_USER_MODELING_INFER=on", () => {
    process.env.OPENBOT_USER_MODELING_INFER = "on";
    expect(userModelingInferEnabled()).toBe(true);
  });

  it("respects tenant inferEnabled override", () => {
    delete process.env.OPENBOT_USER_MODELING_INFER;
    const cfg = {
      gateway: {
        userModeling: {
          inferEnabled: false,
          tenants: { "tenant-a": { inferEnabled: true } },
        },
      },
    } as OpenBotConfig;
    expect(userModelingInferEnabled(cfg)).toBe(false);
    expect(userModelingInferEnabled(cfg, "tenant-a")).toBe(true);
  });

  it("OPENBOT_USER_MODELING_INFER=off is hard-off for infer", () => {
    process.env.OPENBOT_USER_MODELING_INFER = "off";
    const cfg = {
      gateway: {
        userModeling: { inferEnabled: true, tenants: { "tenant-a": { inferEnabled: true } } },
      },
    } as OpenBotConfig;
    expect(userModelingInferEnabled(cfg, "tenant-a")).toBe(false);
  });
});
