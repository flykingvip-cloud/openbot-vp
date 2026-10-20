import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { matchesGlob, normalizeRepoPath } from "./architecture/glob-match.js";

type ManifestRule = {
  name: string;
  from: string;
  denyImportsFrom: string[];
  description: string;
  exemptFiles?: string[];
};

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST_PATH = path.join(REPO_ROOT, "scripts/architecture/manifest.json");

const IMPORT_PATTERN =
  /\b(?:import|export)\s+(?:type\s+)?(?:[^'";]*?\s+from\s+)?["']([^"']+)["']|import\s*\(\s*["']([^"']+)["']\s*\)/g;

function gitLsFilesAll(): string[] {
  const stdout = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  });
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts") || line.endsWith(".tsx"));
}

function loadManifest(): ManifestRule[] {
  const raw = fs.readFileSync(MANIFEST_PATH, "utf8");
  return JSON.parse(raw) as ManifestRule[];
}

function resolveImportSpecifier(params: { fromFile: string; specifier: string }): string | null {
  const { fromFile, specifier } = params;
  if (!specifier.startsWith(".")) {
    return null;
  }
  const fromDir = path.dirname(fromFile);
  const withoutSuffix = specifier.replace(/\.(js|mjs|cjs|ts|tsx)$/, "");
  const candidates = [
    `${withoutSuffix}.ts`,
    `${withoutSuffix}.tsx`,
    path.join(withoutSuffix, "index.ts"),
    path.join(withoutSuffix, "index.tsx"),
  ];
  for (const candidate of candidates) {
    const abs = path.resolve(fromDir, candidate);
    if (fs.existsSync(abs)) {
      return normalizeRepoPath(path.relative(REPO_ROOT, abs));
    }
  }
  return normalizeRepoPath(path.relative(REPO_ROOT, path.resolve(fromDir, withoutSuffix)));
}

function collectImports(filePath: string): string[] {
  const abs = path.join(REPO_ROOT, filePath);
  const content = fs.readFileSync(abs, "utf8");
  const imports: string[] = [];
  for (const match of content.matchAll(IMPORT_PATTERN)) {
    const spec = match[1] ?? match[2];
    if (spec) {
      imports.push(spec);
    }
  }
  return imports;
}

function main(): void {
  const rules = loadManifest();
  const files = gitLsFilesAll();
  const violations: string[] = [];

  for (const rule of rules) {
    const exempt = new Set((rule.exemptFiles ?? []).map(normalizeRepoPath));
    const scopedFiles = files.filter((file) => matchesGlob(file, rule.from) && !exempt.has(file));

    for (const file of scopedFiles) {
      for (const specifier of collectImports(file)) {
        const resolved = resolveImportSpecifier({ fromFile: file, specifier });
        if (!resolved) {
          continue;
        }
        for (const deny of rule.denyImportsFrom) {
          if (matchesGlob(resolved, deny)) {
            violations.push(
              `${rule.name}: ${file} imports ${specifier} → ${resolved} (denied by ${deny})`,
            );
          }
        }
      }
    }
  }

  if (violations.length > 0) {
    console.error("Architecture manifest violations:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exit(1);
  }

  console.log(
    `Architecture manifest passed (${rules.length} rules, ${files.length} files scanned).`,
  );
}

main();
