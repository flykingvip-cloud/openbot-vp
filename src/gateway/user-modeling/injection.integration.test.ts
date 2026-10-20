import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { OpenBotConfig } from "../../config/config.js";
import { userModelingEnabled } from "./config.js";
import { detectUserPreferenceDirectives } from "./derive.js";
import { renderUserProfileInstructions } from "./render.js";
import { DEFAULT_USER_PROFILE } from "./types.js";
import { resolveUserModelingKey } from "./user-key.js";
import {
  applyUserInteractionSignals,
  resolveUserProfileInstructions,
} from "./user-profile-store.js";

const cfg = {} as OpenBotConfig;
const tmpDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("get-reply-run user modeling injection contract", () => {
  it("returns undefined when no profile persisted (fail-before)", async () => {
    const dir = path.join(os.tmpdir(), `um-inject-${Date.now()}`);
    tmpDirs.push(dir);
    const key = resolveUserModelingKey({ channel: "webchat", peerId: "user@example.com" })!;
    const instructions = await resolveUserProfileInstructions(cfg, key, { userModelingDir: dir });
    expect(instructions).toBeUndefined();
  });

  it("returns concise instructions after explicit preference is stored (pass-after)", async () => {
    const dir = path.join(os.tmpdir(), `um-inject-${Date.now()}`);
    tmpDirs.push(dir);
    const key = resolveUserModelingKey({ channel: "webchat", peerId: "user@example.com" })!;
    const opts = { userModelingDir: dir };
    await applyUserInteractionSignals(
      cfg,
      key,
      { directives: detectUserPreferenceDirectives("简洁点") },
      0,
      opts,
    );
    const instructions = await resolveUserProfileInstructions(cfg, key, opts);
    expect(instructions).toContain("concise");
    expect(renderUserProfileInstructions(DEFAULT_USER_PROFILE)).toBe("");
  });

  it("modeling disabled gate matches config helper", () => {
    const prev = process.env.OPENBOT_USER_MODELING;
    process.env.OPENBOT_USER_MODELING = "off";
    expect(userModelingEnabled()).toBe(false);
    if (prev === undefined) {
      delete process.env.OPENBOT_USER_MODELING;
    } else {
      process.env.OPENBOT_USER_MODELING = prev;
    }
  });

  it("tenant disable overrides global enabled", () => {
    const prev = process.env.OPENBOT_USER_MODELING;
    delete process.env.OPENBOT_USER_MODELING;
    const cfg = {
      gateway: { userModeling: { enabled: true, tenants: { "tenant-a": { enabled: false } } } },
    } as OpenBotConfig;
    expect(userModelingEnabled(cfg, "tenant-a")).toBe(false);
    expect(userModelingEnabled(cfg, "tenant-b")).toBe(true);
    if (prev === undefined) {
      delete process.env.OPENBOT_USER_MODELING;
    } else {
      process.env.OPENBOT_USER_MODELING = prev;
    }
  });
});
