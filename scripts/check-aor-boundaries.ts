#!/usr/bin/env node
/**
 * AOR boundary guard (machine-enforced).
 *
 * The defining invariant of AOR is that it grows *on top of* OpenBot and never
 * forks it: AOR packages may depend on OpenBot only through its public surface
 * (`openclaw/plugin-sdk`) or the network (Gateway / OpenAI-compatible HTTP),
 * never by importing OpenBot internals.
 *
 * This script fails CI if any `packages/aor-*` source imports:
 *   - `openclaw` or `openclaw/<internal>` (only `openclaw/plugin-sdk` is allowed,
 *     and only from the backend adapter package),
 *   - pi runtime internals (`@earendil-works/pi-*` / `@mariozechner/pi-*`),
 *   - a relative path that escapes the package root (reaching into repo `src/`).
 *
 * Run `--self-test` to prove the detector flags a violation (negative example).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const AOR_PACKAGES = [
  "packages/aor-core",
  "packages/aor-backend-openbot",
  "packages/aor-backend-stub",
  "packages/aor-backend-graph",
  "packages/aor-sdk-node",
];

/** Packages allowed to import the public `openclaw/plugin-sdk` surface. */
const PLUGIN_SDK_ALLOWED = new Set(["packages/aor-backend-openbot"]);

export interface BoundaryViolation {
  file: string;
  specifier: string;
  reason: string;
}

const IMPORT_RE =
  /(?:import|export)\s[^;]*?\sfrom\s*["']([^"']+)["']|(?:import|require)\s*\(\s*["']([^"']+)["']\s*\)|import\s*["']([^"']+)["']/g;

function extractSpecifiers(source: string): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(IMPORT_RE)) {
    const spec = match[1] ?? match[2] ?? match[3];
    if (spec) {
      out.push(spec);
    }
  }
  return out;
}

/** Inspect a single file's source for boundary violations. */
export function scanSource(params: {
  pkgDir: string; // e.g. "packages/aor-core" (repo-relative)
  fileAbs: string;
  source: string;
}): BoundaryViolation[] {
  const { pkgDir, fileAbs, source } = params;
  const pkgRootAbs = resolve(REPO_ROOT, pkgDir);
  const fileRel = relative(REPO_ROOT, fileAbs);
  const violations: BoundaryViolation[] = [];

  for (const spec of extractSpecifiers(source)) {
    // OpenBot package: only plugin-sdk, only in the adapter package.
    if (spec === "openclaw" || spec.startsWith("openclaw/")) {
      const isPluginSdk = spec === "openclaw/plugin-sdk" || spec.startsWith("openclaw/plugin-sdk/");
      if (!(isPluginSdk && PLUGIN_SDK_ALLOWED.has(pkgDir))) {
        violations.push({
          file: fileRel,
          specifier: spec,
          reason: isPluginSdk
            ? "openclaw/plugin-sdk is only allowed from the backend adapter package"
            : "AOR must not import OpenBot internals; use the public Gateway/plugin-sdk contract",
        });
      }
      continue;
    }
    // pi runtime internals.
    if (spec.startsWith("@earendil-works/pi") || spec.startsWith("@mariozechner/pi")) {
      violations.push({
        file: fileRel,
        specifier: spec,
        reason: "AOR must not import the pi runtime; reach OpenBot via the ExecutionBackend",
      });
      continue;
    }
    // Relative path escaping the package root.
    if (spec.startsWith(".")) {
      const resolved = resolve(dirname(fileAbs), spec);
      const rel = relative(pkgRootAbs, resolved);
      if (rel.startsWith("..")) {
        violations.push({
          file: fileRel,
          specifier: spec,
          reason: "relative import escapes the AOR package root (reaching into the host repo)",
        });
      }
    }
  }
  return violations;
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "dist" || entry === "node_modules") {
        continue;
      }
      out.push(...walkTsFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

function scanPackages(): BoundaryViolation[] {
  const violations: BoundaryViolation[] = [];
  for (const pkgDir of AOR_PACKAGES) {
    const srcAbs = resolve(REPO_ROOT, pkgDir, "src");
    for (const fileAbs of walkTsFiles(srcAbs)) {
      const source = readFileSync(fileAbs, "utf8");
      violations.push(...scanSource({ pkgDir, fileAbs, source }));
    }
  }
  return violations;
}

function runSelfTest(): number {
  const violatingCore = [
    `import { agentCommand } from "openclaw";`,
    `import { runEmbeddedPiAgent } from "../../../src/agents/pi-embedded.js";`,
    `import { Model } from "@earendil-works/pi-ai";`,
  ].join("\n");
  const violations = scanSource({
    pkgDir: "packages/aor-core",
    fileAbs: resolve(REPO_ROOT, "packages/aor-core/src/__synthetic__.ts"),
    source: violatingCore,
  });
  const clean = scanSource({
    pkgDir: "packages/aor-core",
    fileAbs: resolve(REPO_ROOT, "packages/aor-core/src/__synthetic__.ts"),
    source: `import { selectModel } from "./selector.js";\nimport { x } from "@openbot/aor-core";`,
  });

  const expectViolations = 3;
  const ok = violations.length === expectViolations && clean.length === 0;
  if (!ok) {
    console.error(
      `self-test FAILED: expected ${expectViolations} violations + 0 on clean, got ` +
        `${violations.length} + ${clean.length}`,
    );
    return 1;
  }
  console.log(
    `AOR boundary guard self-test OK: detected ${violations.length} planted violations, 0 false positives.`,
  );
  for (const v of violations) {
    console.log(`  - flagged ${v.specifier} (${v.reason})`);
  }
  return 0;
}

function main(): number {
  if (process.argv.includes("--self-test")) {
    return runSelfTest();
  }
  const violations = scanPackages();
  if (violations.length === 0) {
    console.log("AOR boundary guard: OK (no forbidden imports in packages/aor-*).");
    return 0;
  }
  console.error(`AOR boundary guard: ${violations.length} violation(s) found:`);
  for (const v of violations) {
    console.error(`  ${v.file}: "${v.specifier}" -> ${v.reason}`);
  }
  return 1;
}

process.exitCode = main();
