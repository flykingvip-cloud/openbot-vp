#!/usr/bin/env node
/**
 * Formal Stage 6 SBOM generator — OWASP CycloneDX via @cyclonedx/cdxgen.
 *
 * Pins @cyclonedx/cdxgen@12.8.5 (standard tooling). Does not claim Stage 6 product PASS.
 *
 * Usage:
 *   pnpm sbom:cyclonedx
 *   node --import tsx scripts/generate-cyclonedx-sbom.ts [--out path]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const DEFAULT_OUT = path.join(ROOT, "sbom", "openbot.cdx.json");
const CDXGEN_SPEC = "@cyclonedx/cdxgen@12.8.5";

function parseArgs(argv: string[]) {
  let out = DEFAULT_OUT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      out = path.resolve(argv[++i] ?? DEFAULT_OUT);
    } else if (a === "--help" || a === "-h") {
      process.stdout.write(
        "Usage: generate-cyclonedx-sbom.ts [--out path]\n" +
          `Invokes ${CDXGEN_SPEC} (-t js --spec-version 1.6 --no-recurse --no-install-deps).\n`,
      );
      process.exit(0);
    }
  }
  return { out };
}

function main() {
  const { out } = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // Prefer pnpm dlx so the generator is the published OWASP tool, not a custom lockfile emitter.
  const args = [
    "dlx",
    CDXGEN_SPEC,
    "-t",
    "js",
    "--spec-version",
    "1.6",
    "--no-recurse",
    "--no-install-deps",
    "--json-pretty",
    "--validate",
    "-o",
    out,
    ROOT,
  ];
  const result = spawnSync("pnpm", args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  const bom = JSON.parse(fs.readFileSync(out, "utf8")) as {
    bomFormat?: string;
    specVersion?: string;
    components?: unknown[];
    metadata?: { tools?: { components?: Array<{ name?: string; group?: string }> } };
  };
  if (bom.bomFormat !== "CycloneDX") {
    throw new Error(`expected bomFormat CycloneDX, got ${bom.bomFormat}`);
  }
  if (bom.specVersion !== "1.6") {
    throw new Error(`expected specVersion 1.6, got ${bom.specVersion}`);
  }
  const toolNames = (bom.metadata?.tools?.components ?? []).map(
    (c) => `${c.group ?? ""}/${c.name ?? ""}`,
  );
  if (!toolNames.some((n) => n.includes("cdxgen"))) {
    throw new Error(
      `expected @cyclonedx/cdxgen in metadata.tools, got ${JSON.stringify(toolNames)}`,
    );
  }
  const n = bom.components?.length ?? 0;
  process.stdout.write(
    `wrote ${out} via ${CDXGEN_SPEC} (${n} components, CycloneDX ${bom.specVersion})\n`,
  );
}

main();
