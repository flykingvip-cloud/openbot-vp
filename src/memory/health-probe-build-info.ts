import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { probeModuleShaFromSource } from "./health-probe.js";

const BUILD_INFO_CANDIDATES = [
  "../build-info.json",
  "../../build-info.json",
  "./build-info.json",
  "../../../dist/build-info.json",
] as const;

const PROBE_DIST_CANDIDATES = [
  "../memory/health-probe.js",
  "../../memory/health-probe.js",
  "./health-probe.js",
] as const;

type BuildInfoProbe = {
  probeModuleSha?: string;
};

function readBuildInfoProbeModuleSha(moduleUrl: string): string | null {
  try {
    const require = createRequire(moduleUrl);
    for (const candidate of BUILD_INFO_CANDIDATES) {
      try {
        const parsed = require(candidate) as BuildInfoProbe;
        const sha = parsed.probeModuleSha?.trim();
        if (sha) {
          return sha;
        }
      } catch {
        // try next candidate
      }
    }
    return null;
  } catch {
    return null;
  }
}

function readProbeModuleShaFromDist(moduleUrl: string): string | null {
  try {
    const baseDir = path.dirname(fileURLToPath(moduleUrl));
    for (const candidate of PROBE_DIST_CANDIDATES) {
      const resolved = path.resolve(baseDir, candidate);
      if (!fs.existsSync(resolved)) {
        continue;
      }
      return probeModuleShaFromSource(fs.readFileSync(resolved, "utf8"));
    }
    return null;
  } catch {
    return null;
  }
}

/** Resolve probe module identity from build-info (prod) or compiled dist (dev). */
export function resolveProbeModuleSha(options: { moduleUrl?: string } = {}): string {
  const moduleUrl = options.moduleUrl ?? import.meta.url;
  return (
    readBuildInfoProbeModuleSha(moduleUrl) ?? readProbeModuleShaFromDist(moduleUrl) ?? "unknown"
  );
}
