import { describe, expect, it } from "vitest";
import { withEnv } from "../test-utils/env.js";
import { isTruthyEnvValue, normalizeOpenBotCompatEnv, normalizeZaiEnv } from "./env.js";

describe("normalizeZaiEnv", () => {
  it("copies Z_AI_API_KEY to ZAI_API_KEY when missing", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: "zai-legacy" }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("zai-legacy");
    });
  });

  it("does not override existing ZAI_API_KEY", () => {
    withEnv({ ZAI_API_KEY: "zai-current", Z_AI_API_KEY: "zai-legacy" }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("zai-current");
    });
  });

  it("ignores blank legacy Z_AI_API_KEY values", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: "   " }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("");
    });
  });

  it("does not copy when legacy Z_AI_API_KEY is unset", () => {
    withEnv({ ZAI_API_KEY: "", Z_AI_API_KEY: undefined }, () => {
      normalizeZaiEnv();
      expect(process.env.ZAI_API_KEY).toBe("");
    });
  });
});

describe("isTruthyEnvValue", () => {
  it("accepts common truthy values", () => {
    expect(isTruthyEnvValue("1")).toBe(true);
    expect(isTruthyEnvValue("true")).toBe(true);
    expect(isTruthyEnvValue(" yes ")).toBe(true);
    expect(isTruthyEnvValue("ON")).toBe(true);
  });

  it("rejects other values", () => {
    expect(isTruthyEnvValue("0")).toBe(false);
    expect(isTruthyEnvValue("false")).toBe(false);
    expect(isTruthyEnvValue("")).toBe(false);
    expect(isTruthyEnvValue(undefined)).toBe(false);
  });
});

describe("normalizeOpenBotCompatEnv", () => {
  it("mirrors OPENBOT_ vars into OPENCLAW_ vars", () => {
    withEnv({ OPENBOT_GATEWAY_TOKEN: "token-123", OPENCLAW_GATEWAY_TOKEN: undefined }, () => {
      normalizeOpenBotCompatEnv();
      expect(process.env.OPENCLAW_GATEWAY_TOKEN).toBe("token-123");
    });
  });

  it("mirrors OPENCLAW_ vars into OPENBOT_ vars", () => {
    withEnv({ OPENCLAW_STATE_DIR: "/tmp/state", OPENBOT_STATE_DIR: undefined }, () => {
      normalizeOpenBotCompatEnv();
      expect(process.env.OPENBOT_STATE_DIR).toBe("/tmp/state");
    });
  });

  it("does not overwrite existing preferred values", () => {
    withEnv(
      {
        OPENBOT_CONFIG_PATH: "/tmp/openbot.json",
        OPENCLAW_CONFIG_PATH: "/tmp/openclaw.json",
      },
      () => {
        normalizeOpenBotCompatEnv();
        expect(process.env.OPENBOT_CONFIG_PATH).toBe("/tmp/openbot.json");
        expect(process.env.OPENCLAW_CONFIG_PATH).toBe("/tmp/openclaw.json");
      },
    );
  });
});
