#!/usr/bin/env node
/**
 * Phase 0 read-only P1–P8 call-site inventory / freeze helper.
 *
 * stdout only. Does not write OPENBOT_STATE_DIR, LIVE, or Catalog SoT.
 *
 * Freeze must compare against a trusted git ref or blob, never the working-tree
 * baseline in the same change:
 *   node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs --mode freeze \
 *     --baseline-ref origin/main \
 *     --baseline docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json
 *
 * Covers named aliases, file-local wrappers, cross-file exported wrappers,
 * and dynamic import() callees. Owner/profile remain path heuristics.
 * This is not a required GitHub status check until branch protection enables it.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  ALL_NAMES,
  SCAN_EXTS,
  SCAN_ROOTS,
  SYMBOLS,
  SYNTHESIS_SYMBOLS,
  analyzeSource,
  collectImportedNames,
  resolveSpecifier,
} from "./memory-workspace-phase0-inventory-scan.mjs";

const ROOT = process.cwd();

function die(message, code = 2) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  let mode = "inventory";
  let baseline = "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json";
  let baselineRef = "";
  let baselineBlob = "";
  let allowUntrustedWorkingTree = false;
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--mode") {
      mode = argv[++i] ?? "";
    } else if (arg.startsWith("--mode=")) {
      mode = arg.slice("--mode=".length);
    } else if (arg === "--baseline") {
      baseline = argv[++i] ?? "";
    } else if (arg.startsWith("--baseline=")) {
      baseline = arg.slice("--baseline=".length);
    } else if (arg === "--baseline-ref") {
      baselineRef = argv[++i] ?? "";
    } else if (arg.startsWith("--baseline-ref=")) {
      baselineRef = arg.slice("--baseline-ref=".length);
    } else if (arg === "--baseline-blob") {
      baselineBlob = argv[++i] ?? "";
    } else if (arg.startsWith("--baseline-blob=")) {
      baselineBlob = arg.slice("--baseline-blob=".length);
    } else if (arg === "--allow-untrusted-working-tree-baseline") {
      allowUntrustedWorkingTree = true;
    } else if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Usage: node --import tsx docs/design/evidence/memory-workspace-phase0-inventory.mjs --mode inventory|freeze --baseline-ref origin/main [--baseline <json>]\n",
      );
      process.exit(0);
    } else {
      die(`unknown argument: ${arg}`);
    }
  }
  if (mode !== "inventory" && mode !== "freeze") {
    die(`--mode must be inventory or freeze (got ${mode})`);
  }
  return { mode, baseline, baselineRef, baselineBlob, allowUntrustedWorkingTree };
}

function walkScanFiles(dir, out = []) {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (
      entry.name === "node_modules" ||
      entry.name === "dist" ||
      entry.name === "coverage" ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkScanFiles(full, out);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".d.ts")) {
      continue;
    }
    if (SCAN_EXTS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

function extraBindingsFor(absPath, exportIndex) {
  const text = fs.readFileSync(absPath, "utf8");
  const source = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const extra = new Map();
  const visit = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const target = resolveSpecifier(absPath, node.moduleSpecifier.text);
      const exported = target ? exportIndex.get(target) : undefined;
      if (exported) {
        for (const el of node.importClause.namedBindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text;
          const canon = exported.get(imported);
          if (canon) {
            extra.set(el.name.text, canon);
          }
        }
      }
      for (const el of node.importClause.namedBindings.elements) {
        const imported = el.propertyName?.text ?? el.name.text;
        for (const name of collectImportedNames(absPath, node.moduleSpecifier.text, [imported])) {
          if (ALL_NAMES.has(name)) {
            extra.set(el.name.text, name);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return extra;
}

function ownerFor(rel) {
  if (rel.startsWith("src/gateway/workspace-resolver/")) {
    return "data-governance-v2-p0:cursor-data-governance";
  }
  if (
    rel.startsWith("src/memory/") ||
    rel.startsWith("src/agents/memory-search") ||
    rel.includes("get-reply")
  ) {
    return "unassigned:WS-C";
  }
  if (rel.startsWith("src/gateway/workspace-cutover/")) {
    return "data-governance-v2-p0:cursor-data-governance";
  }
  if (rel.startsWith("extensions/")) {
    return "unassigned:extension";
  }
  if (rel.startsWith("scripts/")) {
    return "unassigned:scripts";
  }
  return "unassigned";
}

function replacementFor(pathId) {
  switch (pathId) {
    case "P1":
    case "P2":
    case "P3":
      return "resolveWorkspaceResource handle + WorkspaceDataRole";
    case "P4":
      return "governance Catalog adapter; deny on miss after coverage";
    case "P5":
      return "employee_private Envelope + existing workspace-cutover";
    case "P6":
      return "group_shared handle (second authorized handle)";
    case "P7":
      return "retire overlay after Resolver+v2 same release";
    case "P8":
      return "derived index binding partitioned by resourceId; v1 multi-root refuse sync";
    default:
      return "Resolver handle";
  }
}

export function buildInventory(root = ROOT) {
  const files = SCAN_ROOTS.flatMap((rel) => walkScanFiles(path.join(root, rel)));
  const firstPass = files.map((file) => {
    const rel = path.relative(root, file).split(path.sep).join("/");
    const analyzed = analyzeSource(rel, fs.readFileSync(file, "utf8"));
    return { file, rel, analyzed };
  });
  const exportIndex = new Map();
  for (const item of firstPass) {
    if (item.analyzed.exportedWrappers.size > 0) {
      exportIndex.set(item.file, item.analyzed.exportedWrappers);
    }
  }
  const scanned = firstPass.map((item) => {
    const extra = extraBindingsFor(item.file, exportIndex);
    if (extra.size === 0) {
      return item.analyzed;
    }
    return analyzeSource(item.rel, fs.readFileSync(item.file, "utf8"), extra);
  });
  const callSites = scanned.flatMap((item) => item.rows);
  const helpers = scanned.flatMap((item) => item.helpers);
  callSites.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.symbol.localeCompare(b.symbol),
  );
  helpers.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.name.localeCompare(b.name),
  );
  const production = callSites.filter((row) => row.profile === "production");
  const counts = {};
  for (const pathId of Object.keys(SYMBOLS)) {
    counts[pathId] = {
      production: production.filter((row) => row.pathId === pathId).length,
      test: callSites.filter((row) => row.pathId === pathId && row.profile === "test").length,
    };
  }
  return {
    schema: "memory-workspace-phase0-call-sites/v3",
    generatedAt: new Date().toISOString(),
    roots: SCAN_ROOTS,
    extensions: [...SCAN_EXTS],
    method:
      "typescript-ast + relative-import-reexport-walk + file-local-wrappers + exported-wrappers + dynamic-import",
    limitations: [
      "computed-callee-names-incomplete",
      "fat-function-indirect-calls-not-wrappers",
      "owner-is-path-heuristic",
      "deployment-profile-is-path-heuristic",
      "no-live-root-classification",
    ],
    closesWorkstreams: [],
    counts,
    productionWriteWatchIndex: production.filter((row) => row.op !== "read").length,
    helpers,
    callSites: callSites.map((row) => ({
      ...row,
      owner: ownerFor(row.file),
      replacement: replacementFor(row.pathId),
      retirementPhase: row.profile === "test" ? "allowlist-test" : "freeze",
    })),
  };
}

export function freezeKey(row) {
  return `${row.pathId}|${row.symbol}|${row.file}|${row.line}|${row.op}|${row.profile}`;
}

export function evaluateFreeze(current, baseline) {
  const baseProd = new Set(
    (baseline.callSites ?? []).filter((row) => row.profile === "production").map(freezeKey),
  );
  const added = current.callSites.filter(
    (row) => row.profile === "production" && !baseProd.has(freezeKey(row)),
  );
  const baseHelpers = new Set(
    (baseline.helpers ?? []).map((row) => `${row.name}|${row.file}|${row.line}`),
  );
  const addedHelpers = (current.helpers ?? []).filter(
    (row) =>
      row.profile === "production" &&
      row.kind === "new-helper" &&
      !baseHelpers.has(`${row.name}|${row.file}|${row.line}`),
  );
  return {
    schema: "memory-workspace-phase0-freeze/v3",
    ok: added.length === 0 && addedHelpers.length === 0,
    addedProductionCallSites: added,
    addedProductionHelpers: addedHelpers,
    addedCatalogSynthesis: added.filter((row) => SYNTHESIS_SYMBOLS.has(row.symbol)),
  };
}

export function loadGitFile(spec, cwd = ROOT) {
  return execFileSync("git", ["show", spec], {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
}

export function resolveTrustedBaseline(args, cwd = ROOT) {
  const baselinePath =
    args.baselinePath ?? "docs/design/evidence/memory-workspace-phase0-20260814.call-sites.json";
  if (args.allowUntrustedWorkingTree) {
    const abs = path.resolve(cwd, baselinePath);
    return {
      trusted: false,
      source: "working-tree",
      baselinePath,
      baseline: JSON.parse(fs.readFileSync(abs, "utf8")),
    };
  }
  if (args.baselineBlob) {
    const content = execFileSync("git", ["cat-file", "-p", args.baselineBlob], {
      cwd,
      encoding: "utf8",
      maxBuffer: 20 * 1024 * 1024,
    });
    return {
      trusted: true,
      source: `blob:${args.baselineBlob}`,
      blob: args.baselineBlob,
      baselinePath,
      baseline: JSON.parse(content),
    };
  }
  if (args.baselineRef) {
    const spec = `${args.baselineRef}:${baselinePath}`;
    const content = loadGitFile(spec, cwd);
    const blob = execFileSync("git", ["rev-parse", spec], { cwd, encoding: "utf8" }).trim();
    return {
      trusted: true,
      source: spec,
      blob,
      baselinePath,
      baseline: JSON.parse(content),
    };
  }
  throw new Error(
    "freeze requires --baseline-ref origin/main or --baseline-blob <git-sha>; working-tree baseline is not trusted",
  );
}

function runFreeze(current, args) {
  let resolved;
  try {
    resolved = resolveTrustedBaseline(
      {
        baselinePath: args.baseline,
        baselineRef: args.baselineRef,
        baselineBlob: args.baselineBlob,
        allowUntrustedWorkingTree: args.allowUntrustedWorkingTree,
      },
      ROOT,
    );
  } catch (error) {
    die(error instanceof Error ? error.message : String(error));
  }
  const result = {
    ...evaluateFreeze(current, resolved.baseline),
    baseline: resolved.source,
    trusted: resolved.trusted,
    baselineBlob: resolved.blob ?? null,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) {
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  const args = parseArgs(process.argv);
  const inventory = buildInventory();
  if (args.mode === "inventory") {
    process.stdout.write(`${JSON.stringify(inventory, null, 2)}\n`);
  } else {
    runFreeze(inventory, args);
  }
}
