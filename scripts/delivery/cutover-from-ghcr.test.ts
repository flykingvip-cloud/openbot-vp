import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SCRIPT = "deploy/production/scripts/cutover-from-ghcr.sh";

describe("cutover-from-ghcr.sh", () => {
  it("defaults to the upbeyond GHCR repository", () => {
    const src = readFileSync(SCRIPT, "utf8");
    expect(src).toContain(":-ghcr.io/upbeyond/openbot}");
    // The repository moved; the old default pulls from a repository that no longer gets images.
    expect(src).not.toContain("ghcr.io/gmood2008/openbot");
  });

  it("documents the default in --help", () => {
    const result = spawnSync("bash", [SCRIPT, "--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("default ghcr.io/upbeyond/openbot");
  });
});
