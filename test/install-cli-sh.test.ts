import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installerPath = path.join(repoRoot, "scripts/install-cli.sh");

describe("scripts/install-cli.sh", () => {
  it("exists as a real bash installer, not an alias of install.sh", () => {
    const source = readFileSync(installerPath, "utf8");
    expect(source.startsWith("#!/usr/bin/env bash") || source.startsWith("#!/bin/bash")).toBe(true);
    expect(source).toContain("https://openbot.love/install-cli.sh");
    expect(source).toContain("@upbeyond/openbot");
    expect(source).toContain("https://github.com/gmood2008/openbot.git");
    expect(source).toMatch(/OPENBOT_INSTALL_CLI_SH_NO_RUN/);
    expect(source.split("\n").length).toBeGreaterThan(100);
    expect(source).not.toMatch(/curl -fsSL[^\n]*install\.sh/);
  });

  it.runIf(process.platform !== "win32")("passes bash -n", () => {
    execFileSync("bash", ["-n", installerPath], { encoding: "utf8" });
  });

  it.runIf(process.platform !== "win32")(
    "prints prefix help under NO_RUN and does not install",
    () => {
      const output = execFileSync("bash", [installerPath, "--help"], {
        encoding: "utf8",
        env: {
          ...process.env,
          OPENBOT_INSTALL_CLI_SH_NO_RUN: "1",
        },
      });
      expect(output).toMatch(/--prefix/);
      expect(output).toMatch(/--help/);
      expect(output).toMatch(/~\/.openbot|OPENBOT_PREFIX/);
      expect(output).not.toMatch(/Installing OpenBot/);
      expect(output).not.toMatch(/OpenBot installed/);
    },
  );
});
