#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const EXIT_ALLOW = 0;
const EXIT_NEW_DIAGNOSTICS = 1;
const EXIT_INFRASTRUCTURE_FAILURE = 2;
const DEPENDENCY_PATHS = ["node_modules", "ui/node_modules"];
const ANSI_ESCAPE_CODE = 27;
const TSGO_LOCATION_RE = /^(.*)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s*(.*)$/;
const TSGO_GLOBAL_RE = /^(error|warning)\s+(TS\d+):\s*(.*)$/;

function stripAnsiSgr(value) {
  let output = "";
  for (let index = 0; index < value.length; ) {
    if (value.charCodeAt(index) === ANSI_ESCAPE_CODE && value[index + 1] === "[") {
      let cursor = index + 2;
      while (cursor < value.length && /[0-9;]/.test(value[cursor])) {
        cursor += 1;
      }
      if (value[cursor] === "m") {
        index = cursor + 1;
        continue;
      }
    }
    output += value[index];
    index += 1;
  }
  return output;
}

function normalizeWhitespace(value) {
  return stripAnsiSgr(value).replace(/\s+/g, " ").trim();
}

function normalizeMessage(value, root) {
  if (!root) {
    return normalizeWhitespace(value);
  }
  const absoluteRoot = resolve(root);
  return normalizeWhitespace(
    value
      .replaceAll(absoluteRoot, "<repo>")
      .replaceAll(absoluteRoot.replaceAll("\\", "/"), "<repo>"),
  );
}

function normalizePath(value, root) {
  let normalized = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (root && isAbsolute(value)) {
    const candidate = relative(resolve(root), resolve(value));
    if (candidate && !candidate.startsWith("..")) {
      normalized = candidate.replaceAll("\\", "/");
    }
  }
  return normalized;
}

function finishTsgoDiagnostic(current, diagnostics, root) {
  if (!current) {
    return;
  }
  diagnostics.push({
    tool: "tsgo",
    path: normalizePath(current.path, root),
    code: current.code,
    severity: current.severity,
    message: normalizeMessage(current.parts.join(" "), root),
    line: current.line,
    column: current.column,
  });
}

/** Parse tsgo's plain output while deliberately excluding line and column from identity. */
export function parseTsgoDiagnostics(output, options = {}) {
  const diagnostics = [];
  let current = null;
  for (const rawLine of output.split(/\r?\n/)) {
    const line = stripAnsiSgr(rawLine);
    const located = line.match(TSGO_LOCATION_RE);
    const global = located ? null : line.match(TSGO_GLOBAL_RE);
    if (located || global) {
      finishTsgoDiagnostic(current, diagnostics, options.root);
      current = located
        ? {
            path: located[1],
            line: Number(located[2]),
            column: Number(located[3]),
            severity: located[4],
            code: located[5],
            parts: [located[6]],
          }
        : {
            path: "<global>",
            severity: global[1],
            code: global[2],
            parts: [global[3]],
          };
      continue;
    }

    const continuation = normalizeWhitespace(line);
    if (
      current &&
      continuation &&
      !/^Found \d+ errors?\b/.test(continuation) &&
      !continuation.includes("ELIFECYCLE")
    ) {
      current.parts.push(continuation);
    }
  }
  finishTsgoDiagnostic(current, diagnostics, options.root);
  return diagnostics;
}

/** Parse oxlint JSON and ignore labels/spans so moving code does not create a new finding. */
export function parseOxlintDiagnostics(output, options = {}) {
  const jsonStart = output.indexOf("{");
  if (jsonStart < 0) {
    throw new Error("oxlint produced no JSON payload");
  }
  const payload = JSON.parse(output.slice(jsonStart));
  if (!Array.isArray(payload.diagnostics)) {
    throw new Error("oxlint JSON payload has no diagnostics array");
  }
  return payload.diagnostics
    .filter((diagnostic) => (diagnostic.severity ?? "error") === "error")
    .map((diagnostic) => {
      const span = diagnostic.labels?.[0]?.span;
      const help = normalizeMessage(diagnostic.help ?? "", options.root);
      return {
        tool: "oxlint",
        path: normalizePath(diagnostic.filename ?? "<global>", options.root),
        code: diagnostic.code ?? "unknown",
        severity: diagnostic.severity ?? "error",
        message: `${normalizeMessage(diagnostic.message ?? "unknown diagnostic", options.root)}${help ? ` Help: ${help}` : ""}`,
        line: span?.line,
        column: span?.column,
      };
    });
}

export function diagnosticIdentity(diagnostic) {
  return [
    diagnostic.tool,
    diagnostic.path,
    diagnostic.code,
    diagnostic.severity,
    diagnostic.message,
  ].join("\u0000");
}

/** Multiset subtraction catches an added duplicate without treating line movement as new debt. */
export function diffDiagnostics(baseline, candidate) {
  const remaining = new Map();
  for (const diagnostic of baseline) {
    const key = diagnosticIdentity(diagnostic);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const added = [];
  for (const diagnostic of candidate) {
    const key = diagnosticIdentity(diagnostic);
    const count = remaining.get(key) ?? 0;
    if (count > 0) {
      remaining.set(key, count - 1);
    } else {
      added.push(diagnostic);
    }
  }
  return added;
}

function parseOptions(argv) {
  const options = { base: "", candidate: "", repo: process.cwd(), keepTemp: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (!next) {
        throw new Error(`${arg} requires a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case "--base":
        options.base = value();
        break;
      case "--candidate":
      case "--head":
        options.candidate = value();
        break;
      case "--repo":
        options.repo = value();
        break;
      case "--keep-temp":
        options.keepTemp = true;
        break;
      default:
        throw new Error(`unknown argument: ${arg}`);
    }
  }
  if (!options.base || !options.candidate) {
    throw new Error(
      "usage: ci-diagnostic-delta.mjs --base <sha> --candidate <sha> [--repo <path>]",
    );
  }
  return options;
}

function resolveCommit(repo, ref) {
  return execFileSync("git", ["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function archiveCommit(repo, sha, target, tempRoot) {
  mkdirSync(target, { recursive: true });
  const archive = join(tempRoot, `${sha}.tar`);
  execFileSync("git", ["archive", "--format=tar", `--output=${archive}`, sha], {
    cwd: repo,
    stdio: ["ignore", "ignore", "pipe"],
  });
  try {
    execFileSync("tar", ["-xf", archive, "-C", target], {
      stdio: ["ignore", "ignore", "pipe"],
    });
  } finally {
    rmSync(archive, { force: true });
  }
}

/**
 * Extension packages install their own `extensions/<id>/node_modules` (pnpm
 * symlinks into the root store). Those dirs are gitignored / untracked, so
 * `git archive` trees lack them. Link every live extension node_modules into
 * the archived tree the same way we link root + ui/node_modules, otherwise
 * tsgo on the candidate reports false-new missing-module diagnostics.
 */
function listExtensionNodeModulesPaths(repo) {
  const extensionsRoot = join(repo, "extensions");
  if (!existsSync(extensionsRoot)) {
    return [];
  }
  const paths = [];
  for (const entry of readdirSync(extensionsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      continue;
    }
    const rel = join("extensions", entry.name, "node_modules");
    const abs = join(repo, rel);
    if (existsSync(abs)) {
      paths.push(rel);
    }
  }
  return paths;
}

function dependencyPathsForRepo(repo) {
  return [...DEPENDENCY_PATHS, ...listExtensionNodeModulesPaths(repo)];
}

function linkDependencies(repo, tree) {
  for (const dependencyPath of dependencyPathsForRepo(repo)) {
    const source = join(repo, dependencyPath);
    if (!existsSync(source)) {
      throw new Error(`dependency directory is missing: ${source}`);
    }
    const destination = join(tree, dependencyPath);
    // Archive may have materialized tracked symlink *files* under
    // extensions/*/node_modules (legacy) or nothing at all (untracked). Replace
    // with a dir symlink to the live install so baseline and candidate share
    // the same resolved packages.
    if (existsSync(destination)) {
      rmSync(destination, { recursive: true, force: true });
    }
    mkdirSync(dirname(destination), { recursive: true });
    symlinkSync(
      realpathSync(source),
      destination,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
}

function runChecked(command, args, cwd, label) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  if (result.error || result.signal || result.status !== 0) {
    const detail = normalizeWhitespace(`${result.stdout ?? ""} ${result.stderr ?? ""}`);
    throw new Error(`${label} failed${detail ? `: ${detail}` : ""}`);
  }
}

function validateDiagnosticExit(status, diagnosticCount, diagnosticExitStatus, label) {
  if (status === 0) {
    return;
  }
  if (status !== diagnosticExitStatus) {
    throw new Error(`${label} exited unexpectedly with status ${status}`);
  }
  if (diagnosticCount === 0) {
    throw new Error(`${label} exited ${status} without a parseable diagnostic`);
  }
}

export { validateDiagnosticExit, listExtensionNodeModulesPaths, dependencyPathsForRepo };

function runDiagnostic(command, args, cwd, parser, label, diagnosticExitStatus) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "1" },
  });
  if (result.error || result.signal) {
    throw new Error(`${label} could not run: ${result.error?.message ?? result.signal}`);
  }
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  let diagnostics;
  try {
    diagnostics = parser(output, { root: cwd });
  } catch (error) {
    throw new Error(
      `${label} output was not parseable: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  validateDiagnosticExit(result.status, diagnostics.length, diagnosticExitStatus, label);
  return diagnostics;
}

function collectDiagnostics(tree) {
  const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  runChecked(pnpm, ["build:collaboration:packages"], tree, "collaboration package build");
  const tsgo = runDiagnostic(
    pnpm,
    ["exec", "tsgo", "--noEmit", "--pretty", "false"],
    tree,
    parseTsgoDiagnostics,
    "tsgo",
    2,
  );
  const oxlint = runDiagnostic(
    pnpm,
    ["exec", "oxlint", "--type-aware", "--format", "json"],
    tree,
    parseOxlintDiagnostics,
    "oxlint",
    1,
  );
  return [...tsgo, ...oxlint];
}

function countByTool(diagnostics, tool) {
  return diagnostics.filter((diagnostic) => diagnostic.tool === tool).length;
}

function escapeWorkflowValue(value) {
  return value.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
}

function escapeWorkflowProperty(value) {
  return escapeWorkflowValue(value).replaceAll(":", "%3A").replaceAll(",", "%2C");
}

function printReport(baseSha, candidateSha, baseline, candidate, added) {
  process.stdout.write(`Diagnostic delta: ${baseSha} -> ${candidateSha}\n`);
  for (const tool of ["tsgo", "oxlint"]) {
    process.stdout.write(
      `${tool}: baseline=${countByTool(baseline, tool)} candidate=${countByTool(candidate, tool)} new=${countByTool(added, tool)}\n`,
    );
  }

  if (added.length === 0) {
    process.stdout.write("No new tsgo or oxlint diagnostics.\n");
    return;
  }
  process.stderr.write(`Blocking ${added.length} new diagnostic(s):\n`);
  for (const diagnostic of added) {
    const location = diagnostic.line
      ? `:${diagnostic.line}${diagnostic.column ? `:${diagnostic.column}` : ""}`
      : "";
    process.stderr.write(
      `- ${diagnostic.tool} ${diagnostic.path}${location} ${diagnostic.code}: ${diagnostic.message}\n`,
    );
    if (process.env.GITHUB_ACTIONS === "true") {
      const properties = [`file=${escapeWorkflowProperty(diagnostic.path)}`];
      if (diagnostic.line) {
        properties.push(`line=${diagnostic.line}`);
      }
      if (diagnostic.column) {
        properties.push(`col=${diagnostic.column}`);
      }
      process.stderr.write(
        `::error ${properties.join(",")},title=${escapeWorkflowProperty(`New ${diagnostic.tool} ${diagnostic.code}`)}::${escapeWorkflowValue(diagnostic.message)}\n`,
      );
    }
  }
}

function unlinkDependencies(tree) {
  // Discover from the tree itself (symlinks we created), including extensions/*.
  const paths = [...dependencyPathsForRepo(tree)];
  for (const dependencyPath of paths.toReversed()) {
    const destination = join(tree, dependencyPath);
    if (existsSync(destination) && lstatSync(destination).isSymbolicLink()) {
      rmSync(destination, { force: true });
    }
  }
}

export function runDiagnosticDelta(options) {
  const repo = realpathSync(resolve(options.repo));
  const baseSha = resolveCommit(repo, options.base);
  const candidateSha = resolveCommit(repo, options.candidate);
  const tempRoot = mkdtempSync(join(tmpdir(), "openbot-diagnostic-delta-"));
  const baseTree = join(tempRoot, "baseline");
  const candidateTree = join(tempRoot, "candidate");

  try {
    archiveCommit(repo, baseSha, baseTree, tempRoot);
    archiveCommit(repo, candidateSha, candidateTree, tempRoot);
    linkDependencies(repo, baseTree);
    linkDependencies(repo, candidateTree);

    const baseline = collectDiagnostics(baseTree);
    const candidate = collectDiagnostics(candidateTree);
    const added = diffDiagnostics(baseline, candidate);
    printReport(baseSha, candidateSha, baseline, candidate, added);
    return {
      code: added.length === 0 ? EXIT_ALLOW : EXIT_NEW_DIAGNOSTICS,
      baseSha,
      candidateSha,
      baseline,
      candidate,
      added,
      tempRoot,
    };
  } finally {
    if (!options.keepTemp) {
      unlinkDependencies(baseTree);
      unlinkDependencies(candidateTree);
      rmSync(tempRoot, { recursive: true, force: true });
    } else {
      process.stdout.write(`Kept diagnostic trees at ${tempRoot}\n`);
    }
  }
}

function isDirectRun() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  try {
    const result = runDiagnosticDelta(parseOptions(process.argv.slice(2)));
    process.exitCode = result.code;
  } catch (error) {
    process.stderr.write(
      `Diagnostic delta infrastructure failure: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = EXIT_INFRASTRUCTURE_FAILURE;
  }
}
