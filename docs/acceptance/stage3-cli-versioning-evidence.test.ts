/**
 * Stage 3 six-column **CLI versioning** slice (narrow E1/E2).
 *
 * Proposition (§5.2 CLI versioning): `openbot` is the user-facing command;
 * `openclaw` remains a compatibility entry that delegates to the same runtime.
 * Not Stage 3 overall PASS. stage8_eligible stays false.
 *
 * Anchors: package.json `bin`, root `openbot.mjs` / `openclaw.mjs`,
 * `src/cli/cli-name.ts` display unification.
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_CLI_NAME, replaceCliName, resolveCliName } from "../../src/cli/cli-name.js";

describe("Stage 3 CLI versioning (E1/E2 narrow)", () => {
  it("package.json bin maps openbot to openbot.mjs and openclaw to openclaw.mjs", () => {
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      bin?: Record<string, string>;
      files?: string[];
    };
    expect(pkg.bin).toEqual({
      openbot: "openbot.mjs",
      openclaw: "openclaw.mjs",
    });
    expect(pkg.files ?? []).toEqual(expect.arrayContaining(["openbot.mjs", "openclaw.mjs"]));
    expect(existsSync("openbot.mjs")).toBe(true);
    expect(existsSync("openclaw.mjs")).toBe(true);
  });

  it("openclaw.mjs is a deprecated shim that imports openbot.mjs", () => {
    const src = readFileSync("openclaw.mjs", "utf8");
    expect(src).toMatch(/DeprecationWarning/);
    expect(src).toMatch(/openclaw\.mjs is deprecated;\s*use openbot\.mjs instead/);
    expect(src).toMatch(/await import\("\.\/openbot\.mjs"\)/);
  });

  it("openbot.mjs recognizes both binary basenames before dispatch", () => {
    const src = readFileSync("openbot.mjs", "utf8");
    expect(src).toMatch(/KNOWN_CLI_NAMES\s*=\s*new Set\(\[\s*"openbot"\s*,\s*"openclaw"\s*\]\)/);
  });

  it("display name unifies to openbot even when invoked via openclaw argv", () => {
    expect(DEFAULT_CLI_NAME).toBe("openbot");
    expect(resolveCliName(["node", "/tmp/openbot.mjs"])).toBe("openbot");
    expect(resolveCliName(["node", "/tmp/openclaw.mjs"])).toBe("openbot");
    expect(resolveCliName(["node", "/tmp/openclaw.js"])).toBe("openbot");
    expect(replaceCliName("openclaw gateway status")).toBe("openbot gateway status");
    expect(replaceCliName("pnpm openclaw doctor")).toBe("pnpm openbot doctor");
  });
});
