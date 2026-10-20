import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyCliProfileEnv } from "./profile.js";

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".openbot-dev");
    expect(env.OPENBOT_PROFILE).toBe("dev");
    expect(env.OPENBOT_STATE_DIR).toBe(expectedStateDir);
    expect(env.OPENBOT_CONFIG_PATH).toBe(path.join(expectedStateDir, "openbot.json"));
    expect(env.OPENBOT_GATEWAY_PORT).toBe("19001");
    expect(env.OPENCLAW_PROFILE).toBe("dev");
    expect(env.OPENCLAW_STATE_DIR).toBe(expectedStateDir);
    expect(env.OPENCLAW_CONFIG_PATH).toBe(path.join(expectedStateDir, "openbot.json"));
    expect(env.OPENCLAW_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      OPENBOT_STATE_DIR: "/custom",
      OPENBOT_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.OPENBOT_STATE_DIR).toBe("/custom");
    expect(env.OPENBOT_GATEWAY_PORT).toBe("19099");
    expect(env.OPENBOT_CONFIG_PATH).toBe(path.join("/custom", "openbot.json"));
    expect(env.OPENCLAW_STATE_DIR).toBe("/custom");
    expect(env.OPENCLAW_GATEWAY_PORT).toBe("19099");
    expect(env.OPENCLAW_CONFIG_PATH).toBe(path.join("/custom", "openbot.json"));
  });

  it("uses OPENBOT_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      OPENBOT_HOME: "/srv/openbot-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/openbot-home");
    expect(env.OPENBOT_STATE_DIR).toBe(path.join(resolvedHome, ".openbot-work"));
    expect(env.OPENBOT_CONFIG_PATH).toBe(path.join(resolvedHome, ".openbot-work", "openbot.json"));
  });
});
