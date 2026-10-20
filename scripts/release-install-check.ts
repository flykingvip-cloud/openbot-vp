#!/usr/bin/env -S node --import tsx

import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function checkPublishableDependencies() {
  const pkg = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
  const deps = { ...pkg.dependencies, ...pkg.optionalDependencies };
  const errors: string[] = [];

  for (const [name, spec] of Object.entries(deps)) {
    if (spec.includes("workspace:")) {
      errors.push(
        `dependency ${name} uses workspace protocol "${spec}" (not installable from npm)`,
      );
    }
    if (name === "@openbot/aor-core") {
      errors.push("dependency @openbot/aor-core must be bundled, not declared for publish");
    }
  }

  if (errors.length > 0) {
    console.error("release-install-check: publishable dependency validation failed:");
    for (const error of errors) {
      console.error(`  - ${error}`);
    }
    process.exit(1);
  }
}

function checkAorCoreNotExternalized() {
  const distDir = resolve("dist");
  const stack = [distDir];
  const externalImport =
    /(?:from|import|require)\s*(?:\(\s*)?["']@openbot\/aor-core["']|@openbot\/aor-core["']\s*\)/;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (!entry.name.endsWith(".js") && !entry.name.endsWith(".mjs")) {
        continue;
      }
      const content = readFileSync(fullPath, "utf8");
      if (externalImport.test(content)) {
        console.error(
          `release-install-check: dist still references external @openbot/aor-core in ${fullPath}`,
        );
        process.exit(1);
      }
    }
  }
}

function packTarball(): string {
  const output = execSync("npm pack --ignore-scripts", {
    encoding: "utf8",
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tarball = output
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1);
  if (!tarball) {
    console.error("release-install-check: npm pack did not return a tarball name");
    process.exit(1);
  }
  return resolve(tarball);
}

function checkPackManifestHasNoAorCore() {
  const raw = execSync("npm pack --dry-run --json --ignore-scripts", {
    encoding: "utf8",
    cwd: resolve("."),
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 100,
  });
  const results = JSON.parse(raw) as Array<{ dependencies?: Record<string, string> }>;
  for (const entry of results) {
    if (entry.dependencies?.["@openbot/aor-core"]) {
      console.error(
        "release-install-check: packed manifest still declares @openbot/aor-core dependency",
      );
      process.exit(1);
    }
  }
}

function checkGlobalInstallFromTarball(tarballPath: string) {
  const prefix = mkdtempSync(join(tmpdir(), "openbot-release-install-"));
  try {
    execFileSync("npm", ["install", "-g", tarballPath, "--prefix", prefix], {
      stdio: "inherit",
      env: {
        ...process.env,
        NPM_CONFIG_PREFIX: prefix,
      },
    });
    const openbotBin = join(prefix, "bin", "openbot");
    execFileSync(openbotBin, ["--version"], { stdio: "inherit" });
  } finally {
    rmSync(prefix, { recursive: true, force: true });
  }
}

function main() {
  checkPublishableDependencies();
  checkAorCoreNotExternalized();
  checkPackManifestHasNoAorCore();

  const tarballPath = packTarball();
  try {
    checkGlobalInstallFromTarball(tarballPath);
  } finally {
    try {
      unlinkSync(tarballPath);
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("release-install-check: npm pack + isolated global install OK.");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main();
}
