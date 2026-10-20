/**
 * Browser-safe evolution-core imports for the UI.
 *
 * `@openbot/evolution-core` has no browser build: its package entry points at
 * an unbuilt `dist/`, and the source root barrel (`src/index.ts`) re-exports
 * Node-only modules. Code that runs in the browser (UI sources and
 * `*.browser.test.ts`) takes runtime values from evolution-core only through a
 * relative path to a module whose own imports stay clear of Node builtins and
 * the root barrel. The UI Vite and Vitest configs do not alias the package
 * root either, so the build and the browser runner resolve the same modules.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

const PACKAGE = "@openbot/evolution-core";
const PACKAGE_SRC = "packages/evolution-core/src/";
const ROOT_BARREL = "packages/evolution-core/src/index.ts";
const UI_CONFIGS = ["ui/vite.config.ts", "ui/vitest.config.ts"];

type ImportStatement = { specifier: string; typeOnly: boolean };

function read(file: string): string {
  return readFileSync(join(process.cwd(), file), "utf8");
}

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(process.cwd(), dir), { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listTsFiles(path));
    } else if (entry.isFile() && path.endsWith(".ts") && !path.endsWith(".d.ts")) {
      out.push(path);
    }
  }
  return out;
}

/** UI sources and browser tests run in the browser; the other tests run in Node. */
function runsInBrowser(file: string): boolean {
  return file.endsWith(".browser.test.ts") || !file.endsWith(".test.ts");
}

/** Code only: block and line comments removed. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/** Only `import type` / `export type` statements are erased by the build. */
function importStatements(source: string): ImportStatement[] {
  const code = withoutComments(source);
  const statements: ImportStatement[] = [];
  for (const match of code.matchAll(
    /\b(?:import|export)\s+(type\s+)?[\w*${}\s,]*?\s*from\s*["']([^"']+)["']/g,
  )) {
    statements.push({ specifier: match[2] ?? "", typeOnly: Boolean(match[1]) });
  }
  for (const match of code.matchAll(/\bimport\s*(?:\(\s*)?["']([^"']+)["']/g)) {
    statements.push({ specifier: match[1] ?? "", typeOnly: false });
  }
  return statements;
}

/** Repo-relative target of a relative specifier, before any file lookup. */
function relativeTarget(fromFile: string, specifier: string): string {
  return normalize(join(dirname(fromFile), specifier));
}

/** Repo-relative `.ts` file a relative specifier loads, or null when there is none. */
function resolveTs(fromFile: string, specifier: string): string | null {
  const base = relativeTarget(fromFile, specifier);
  for (const candidate of [
    base,
    base.replace(/\.js$/, ".ts"),
    `${base}.ts`,
    join(base, "index.ts"),
  ]) {
    if (candidate.endsWith(".ts") && existsSync(join(process.cwd(), candidate))) {
      return candidate;
    }
  }
  return null;
}

/** The package root in any form: bare specifier, package directory, dist, or root barrel. */
function isPackageRoot(fromFile: string, specifier: string): boolean {
  if (specifier === PACKAGE || specifier.startsWith(`${PACKAGE}/`)) {
    return true;
  }
  if (!specifier.startsWith(".")) {
    return false;
  }
  const target = relativeTarget(fromFile, specifier);
  return (
    /^packages\/evolution-core(\/src)?\/?$/.test(target) ||
    target.startsWith("packages/evolution-core/dist/") ||
    resolveTs(fromFile, specifier) === ROOT_BARREL
  );
}

/** Runtime imports of browser code that mention evolution-core. */
function browserRuntimeImports(): { file: string; specifier: string }[] {
  const out: { file: string; specifier: string }[] = [];
  for (const file of listTsFiles("ui/src").filter(runsInBrowser)) {
    const source = read(file);
    if (!source.includes("evolution-core")) {
      continue;
    }
    for (const statement of importStatements(source)) {
      if (!statement.typeOnly) {
        out.push({ file, specifier: statement.specifier });
      }
    }
  }
  return out;
}

describe("browser-safe evolution-core imports", () => {
  it("keeps browser code off the evolution-core package root", () => {
    const offenders = browserRuntimeImports()
      .filter(({ file, specifier }) => isPackageRoot(file, specifier))
      .map(({ file, specifier }) => `${file} -> ${specifier}`);
    expect(offenders).toEqual([]);
  });

  it("reaches only evolution-core modules that import no Node builtin or root barrel", () => {
    const entries = new Set<string>();
    for (const { file, specifier } of browserRuntimeImports()) {
      const target = specifier.startsWith(".") ? resolveTs(file, specifier) : null;
      if (target?.startsWith(PACKAGE_SRC)) {
        entries.add(target);
      }
    }
    expect(entries.size).toBeGreaterThan(0);

    const queue = [...entries];
    const seen = new Set<string>();
    const unsafe: string[] = [];
    while (queue.length > 0) {
      const file = queue.shift() ?? "";
      if (seen.has(file)) {
        continue;
      }
      seen.add(file);
      if (file === ROOT_BARREL) {
        unsafe.push(`${file} (root barrel)`);
        continue;
      }
      for (const statement of importStatements(read(file))) {
        if (statement.typeOnly) {
          continue;
        }
        if (
          statement.specifier.startsWith("node:") ||
          builtinModules.includes(statement.specifier)
        ) {
          unsafe.push(`${file} -> ${statement.specifier}`);
          continue;
        }
        const target = statement.specifier.startsWith(".")
          ? resolveTs(file, statement.specifier)
          : null;
        if (target?.startsWith("packages/")) {
          queue.push(target);
        }
      }
    }
    expect(unsafe).toEqual([]);
  });

  it("does not alias the evolution-core root in the UI Vite or Vitest config", () => {
    for (const config of UI_CONFIGS) {
      const code = withoutComments(read(config));
      // The package name, as a plain string or regex-escaped.
      expect([config, /@openbot\\?\/evolution-core/.test(code)]).toEqual([config, false]);
      // A path to the root barrel, written as one string or as path segments.
      expect([config, /evolution-core["'`\s,\\/]+src["'`\s,\\/]+index/.test(code)]).toEqual([
        config,
        false,
      ]);
    }
  });
});
