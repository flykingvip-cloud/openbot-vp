import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertP1BundlesFullPorts,
  formatOpenBotSurfaceSelection,
  FULL_UI_PORTS,
  resolveOpenBotSurface,
  selectPortsForSurface,
} from "./openbot-surface.mjs";

const repoRoot = join(import.meta.dirname, "..");

describe("OPENBOT_SURFACE port selection", () => {
  it("defaults unset and empty values to full", () => {
    expect(resolveOpenBotSurface(undefined)).toBe("full");
    expect(resolveOpenBotSurface(null)).toBe("full");
    expect(resolveOpenBotSurface("")).toBe("full");
    expect(resolveOpenBotSurface("full")).toBe("full");
  });

  it("rejects every non-full value, including appliance", () => {
    for (const rejected of [
      "appliance",
      "slim",
      "default",
      "FULL",
      "oem",
      "customer-special",
      " full",
    ]) {
      expect(() => resolveOpenBotSurface(rejected)).toThrow(/must be empty or "full"/);
      expect(() => selectPortsForSurface(rejected)).toThrow(/must be empty or "full"/);
    }
  });

  it("bundles employee, enterprise, platform, and diagnosis for full", () => {
    expect(selectPortsForSurface("full")).toEqual([...FULL_UI_PORTS]);
    expect(selectPortsForSurface(undefined)).toEqual([
      "employee",
      "enterprise",
      "platform",
      "diagnosis",
    ]);
    expect(assertP1BundlesFullPorts("full")).toContain("platform");
    expect(formatOpenBotSurfaceSelection("full", selectPortsForSurface("full"))).toBe(
      "OPENBOT_SURFACE=full UI ports: employee, enterprise, platform, diagnosis",
    );
  });

  it("refuses a cut port list on the full surface", () => {
    expect(() => assertP1BundlesFullPorts("full", ["employee", "enterprise", "diagnosis"])).toThrow(
      /platform/,
    );
  });

  it("documents full as the only shipping surface", () => {
    const dockerDoc = readFileSync(join(repoRoot, "docs/install/docker.md"), "utf8");
    expect(dockerDoc).toContain("orthogonal");
    expect(dockerDoc).toContain("OPENBOT_SURFACE=full");
    expect(dockerDoc).not.toContain("OPENBOT_SURFACE=appliance");
    expect(dockerDoc).toContain("OPENCLAW_VARIANT=default");
    expect(dockerDoc).toContain("OPENCLAW_VARIANT=slim");
    expect(dockerDoc).toContain("employee, enterprise, platform, and diagnosis");
    const uiScript = readFileSync(join(repoRoot, "scripts/ui.js"), "utf8");
    expect(uiScript).toContain("assertP1BundlesFullPorts");
    expect(uiScript).toContain("selectPortsForSurface");
    const viteConfig = readFileSync(join(repoRoot, "ui/vite.config.ts"), "utf8");
    expect(viteConfig).toContain('from "../scripts/openbot-surface.mjs"');
    expect(viteConfig).toContain("assertP1BundlesFullPorts");
    const dockerfile = readFileSync(join(repoRoot, "Dockerfile"), "utf8");
    expect(dockerfile).toContain('""|full)');
    expect(dockerfile).not.toContain("appliance");
  });
});
