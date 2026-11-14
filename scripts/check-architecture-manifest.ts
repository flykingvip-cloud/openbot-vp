import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { matchesGlob, normalizeRepoPath } from "./architecture/glob-match.js";

export type ManifestRule = {
  name: string;
  from: string;
  /**
   * Suppress a deny hit only when BOTH the importer and the resolved target
   * match the same glob. This allows intra-component internal references
   * (e.g. files under one rule-adaptation tree importing each other) without
   * taking that tree out of the rule. Imports of any other component's
   * internals are still checked. Unconfigured rules keep prior behavior.
   */
  exceptFrom?: string[];
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
  return (
    stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".ts") || line.endsWith(".tsx"))
      // git ls-files includes tracked deletions until staging; audit the current source tree.
      .filter((line) => fs.existsSync(path.join(REPO_ROOT, line)))
  );
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

/** True only when importer and target both sit in the same exceptFrom glob. */
export function isSameComponentInternal(
  fromFile: string,
  resolved: string,
  exceptFrom: string[] | undefined,
): boolean {
  return (exceptFrom ?? []).some(
    (glob) => matchesGlob(fromFile, glob) && matchesGlob(resolved, glob),
  );
}

export type ResolvedImport = {
  specifier: string;
  resolved: string | null;
};

/**
 * Evaluate architecture rules against a provided file list and import resolver.
 * `exceptFrom` does not remove the importer from scope; it only suppresses a
 * deny hit when both ends of the edge belong to the same listed component.
 */
export function collectArchitectureViolations(params: {
  rules: ManifestRule[];
  files: string[];
  importsOf: (file: string) => ResolvedImport[];
}): string[] {
  const violations: string[] = [];

  for (const rule of params.rules) {
    const exempt = new Set((rule.exemptFiles ?? []).map(normalizeRepoPath));
    const scopedFiles = params.files.filter(
      (file) => matchesGlob(file, rule.from) && !exempt.has(file),
    );

    for (const file of scopedFiles) {
      for (const { specifier, resolved } of params.importsOf(file)) {
        if (!resolved) {
          continue;
        }
        const normalizedResolved = normalizeRepoPath(resolved);
        for (const deny of rule.denyImportsFrom) {
          if (!matchesGlob(normalizedResolved, deny)) {
            continue;
          }
          if (isSameComponentInternal(file, normalizedResolved, rule.exceptFrom)) {
            continue;
          }
          violations.push(
            `${rule.name}: ${file} imports ${specifier} → ${normalizedResolved} (denied by ${deny})`,
          );
        }
      }
    }
  }

  return violations;
}

function main(): void {
  const rules = loadManifest();
  const files = gitLsFilesAll();
  const violations = collectArchitectureViolations({
    rules,
    files,
    importsOf: (file) =>
      collectImports(file).map((specifier) => ({
        specifier,
        resolved: resolveImportSpecifier({ fromFile: file, specifier }),
      })),
  });

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

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main();
}
