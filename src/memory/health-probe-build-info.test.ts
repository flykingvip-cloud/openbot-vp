import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveProbeModuleSha } from "./health-probe-build-info.js";
import { probeModuleShaFromSource } from "./health-probe.js";

describe("resolveProbeModuleSha", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reads probeModuleSha from build-info.json and never requires a .ts source", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-build-info-"));
    dirs.push(dir);
    fs.writeFileSync(
      path.join(dir, "build-info.json"),
      JSON.stringify({ probeModuleSha: "abcdef0123456789" }),
    );
    const moduleUrl = pathToFileURL(path.join(dir, "caller.js")).href;
    expect(resolveProbeModuleSha({ moduleUrl })).toBe("abcdef0123456789");
    expect(fs.existsSync(path.join(dir, "health-probe.ts"))).toBe(false);
  });

  it("falls back to compiled health-probe.js when build-info has no sha", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-build-js-"));
    dirs.push(dir);
    const jsPath = path.join(dir, "health-probe.js");
    fs.writeFileSync(jsPath, "export const probe = 1;\n");
    const moduleUrl = pathToFileURL(path.join(dir, "caller.js")).href;
    expect(resolveProbeModuleSha({ moduleUrl })).toBe(
      probeModuleShaFromSource(fs.readFileSync(jsPath, "utf8")),
    );
  });

  it("returns unknown when neither build-info nor compiled js exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-build-missing-"));
    dirs.push(dir);
    const moduleUrl = pathToFileURL(path.join(dir, "nested", "caller.js")).href;
    expect(resolveProbeModuleSha({ moduleUrl })).toBe("unknown");
  });
});
