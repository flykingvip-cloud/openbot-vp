import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs([
      "node",
      "openclaw",
      "gateway",
      "--dev",
      "--allow-unconfigured",
    ]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "openclaw", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "openclaw", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "openclaw", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "openclaw", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "openclaw", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "openclaw", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "openclaw", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "openclaw", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "openbot doctor --fix",
      env: {},
      expected: "openbot doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "openbot doctor --fix",
      env: { OPENBOT_PROFILE: "default" },
      expected: "openbot doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "openbot doctor --fix",
      env: { OPENBOT_PROFILE: "Default" },
      expected: "openbot doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "openbot doctor --fix",
      env: { OPENBOT_PROFILE: "bad profile" },
      expected: "openbot doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "openbot --profile work doctor --fix",
      env: { OPENBOT_PROFILE: "work" },
      expected: "openbot --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "openbot --dev doctor",
      env: { OPENBOT_PROFILE: "dev" },
      expected: "openbot --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("openbot doctor --fix", { OPENBOT_PROFILE: "work" })).toBe(
      "openbot --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("openbot doctor --fix", { OPENBOT_PROFILE: "  jbopenbot  " })).toBe(
      "openbot --profile jbopenbot doctor --fix",
    );
  });

  it("handles command with no args after openbot", () => {
    expect(formatCliCommand("openbot", { OPENBOT_PROFILE: "test" })).toBe("openbot --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm openbot doctor", { OPENBOT_PROFILE: "work" })).toBe(
      "pnpm openbot --profile work doctor",
    );
  });
});
