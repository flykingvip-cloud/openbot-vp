import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export const SCAN_ROOTS = ["src", "extensions", "scripts"];
export const SCAN_EXTS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs"]);
export const HELPER_NAME = /^(?:__resolve[A-Za-z0-9]+|resolve\w*WorkspaceDir)$/;
export const SYNTHESIS_SYMBOLS = new Set([
  "createEmptyWorkspaceCatalog",
  "buildUserOwnedWorkspaceCatalogEntry",
]);

export const SYMBOLS = {
  P1: ["resolveAgentWorkspaceDir"],
  P2: ["resolveMemoryWorkspaceDir"],
  P3: ["resolveAgentWorkspaceDirForClient"],
  P4: [
    "resolveAuthorizedAgentToolWorkspaceCwd",
    "buildUserOwnedWorkspaceCatalogEntry",
    "createEmptyWorkspaceCatalog",
  ],
  P5: [
    "resolveEmployeeBuiltinStewardWorkspaceDir",
    "resolveEmployeeStewardWritableWorkspaceDir",
    "resolveEmployeeStewardSourceWorkspaceDir",
    "resolveEmployeeStewardTargetWorkspaceDir",
  ],
  P6: [
    "writeGroupWorkspaceRelativeFile",
    "ensureGroupWorkspaceWriteRoot",
    "upsertGroupWorkspaceDeliverableCanonical",
    "upsertGroupWorkspaceDeliverableDraft",
  ],
  P7: ["__resolveMemoryWorkspaceDir"],
  P8: ["resolveStorePath", "syncMemoryFiles"],
};

export const ALL_NAMES = new Set(Object.values(SYMBOLS).flat());
export const NAME_TO_PATH = new Map();
for (const [pathId, names] of Object.entries(SYMBOLS)) {
  for (const name of names) {
    NAME_TO_PATH.set(name, pathId);
  }
}

const WRITE_HINTS =
  /ensureAgentWorkspace|syncMemoryFiles|watch|writeFile|continuity|checkpoint|prune|DELETE FROM|ForClient|createEmptyWorkspaceCatalog|buildUserOwnedWorkspaceCatalogEntry/;
const INDEX_HINTS = /syncMemory|reindex|indexFile|memory index|onSearch|onSessionStart/;
const WATCH_HINTS = /watch|chokidar|watcher/;

export function classifyLane(rel) {
  if (
    /\.test\.[cm]?[jt]sx?$|\.e2e\.[cm]?[jt]sx?$|\/test-harness\.ts$|get-reply\.test-mocks\.ts$/.test(
      rel,
    )
  ) {
    return "test";
  }
  return "production";
}

export function classifyDeploymentProfile(rel) {
  if (rel.startsWith("extensions/") || rel.startsWith("scripts/")) {
    return "unknown";
  }
  if (
    /tenant-context|workspace-resolver|workspace-ownership|workspace-cutover|employee-workbench|managed/.test(
      rel,
    )
  ) {
    return "ManagedEnterprise";
  }
  if (/resolveAgentWorkspaceDir|workspace-bot-|PersonalLocal|canonical/.test(rel)) {
    return "PersonalLocal";
  }
  return "unknown";
}

export function classifyOp(rel, snippet) {
  const text = `${rel}\n${snippet}`;
  if (WATCH_HINTS.test(text)) {
    return "watch";
  }
  if (INDEX_HINTS.test(text) || rel.includes("src/memory/")) {
    return "index";
  }
  if (WRITE_HINTS.test(text) || /get-reply|session-continuity|steward-write|agents\.ts/.test(rel)) {
    return "write";
  }
  return "read";
}

function isImportCall(node) {
  return ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
}

function unwrapAwait(node) {
  return ts.isAwaitExpression(node) ? node.expression : node;
}

function callIdent(node) {
  if (ts.isIdentifier(node.expression)) {
    return node.expression.text;
  }
  if (ts.isPropertyAccessExpression(node.expression) && ts.isIdentifier(node.expression.name)) {
    return node.expression.name.text;
  }
  return null;
}

function resolveCanon(ident, localToCanon, wrappers) {
  if (!ident) {
    return null;
  }
  return localToCanon.get(ident) ?? wrappers.get(ident) ?? (ALL_NAMES.has(ident) ? ident : null);
}

export function analyzeSource(rel, text, extraBindings = new Map()) {
  const source = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const localToCanon = new Map(extraBindings);
  const namespaceLocals = new Set();
  const wrappers = new Map();
  const exportedWrappers = new Map();

  const bindName = (importedName, localName) => {
    if (ALL_NAMES.has(importedName)) {
      localToCanon.set(localName, importedName);
    }
  };

  const visitBindings = (node) => {
    if (
      ts.isImportDeclaration(node) &&
      node.importClause &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const clause = node.importClause;
      if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const el of clause.namedBindings.elements) {
          bindName(el.propertyName?.text ?? el.name.text, el.name.text);
        }
      }
    }
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      for (const el of node.exportClause.elements) {
        bindName(el.propertyName?.text ?? el.name.text, el.name.text);
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      const init = unwrapAwait(node.initializer);
      if (isImportCall(init)) {
        if (ts.isIdentifier(node.name)) {
          namespaceLocals.add(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          for (const el of node.name.elements) {
            if (ts.isIdentifier(el.name)) {
              bindName(el.propertyName?.text ?? el.name.text, el.name.text);
            }
          }
        }
      }
      if (ts.isIdentifier(node.initializer) && ts.isIdentifier(node.name)) {
        const canon = resolveCanon(node.initializer.text, localToCanon, wrappers);
        if (canon) {
          localToCanon.set(node.name.text, canon);
        }
      }
    }
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "then" &&
      isImportCall(node.expression.expression) &&
      node.arguments[0]
    ) {
      const cb = node.arguments[0];
      if (
        (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
        cb.parameters[0] &&
        ts.isObjectBindingPattern(cb.parameters[0].name)
      ) {
        for (const el of cb.parameters[0].name.elements) {
          if (ts.isIdentifier(el.name)) {
            bindName(el.propertyName?.text ?? el.name.text, el.name.text);
          }
        }
      }
      if (
        (ts.isArrowFunction(cb) || ts.isFunctionExpression(cb)) &&
        cb.parameters[0] &&
        ts.isIdentifier(cb.parameters[0].name)
      ) {
        namespaceLocals.add(cb.parameters[0].name.text);
      }
    }
    ts.forEachChild(node, visitBindings);
  };
  visitBindings(source);

  const wrapperFns = [];
  const visitWrappers = (node, exported) => {
    const exportedHere =
      exported || Boolean(node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword));
    if (ts.isVariableStatement(node)) {
      const vsExported =
        exportedHere ||
        Boolean(node.modifiers?.some((mod) => mod.kind === ts.SyntaxKind.ExportKeyword));
      ts.forEachChild(node, (child) => visitWrappers(child, vsExported));
      return;
    }
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      wrapperFns.push({
        name: node.name.text,
        body: node.body,
        spanNode: node,
        exported: exportedHere,
      });
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      wrapperFns.push({
        name: node.name.text,
        body: node.initializer.body,
        spanNode: node.initializer,
        exported: exportedHere,
      });
    }
    ts.forEachChild(node, (child) => visitWrappers(child, exportedHere));
  };
  visitWrappers(source, false);
  let wrapperChanged = true;
  while (wrapperChanged) {
    wrapperChanged = false;
    for (const fn of wrapperFns) {
      if (wrappers.has(fn.name)) {
        continue;
      }
      if (!isThinWrapperCandidate(fn.spanNode, fn.body, source)) {
        continue;
      }
      const canon = findCanonCall(fn.body, localToCanon, wrappers);
      if (!canon) {
        continue;
      }
      wrappers.set(fn.name, canon);
      if (fn.exported) {
        exportedWrappers.set(fn.name, canon);
      }
      wrapperChanged = true;
    }
  }
  const visitExports = (node) => {
    if (
      ts.isExportDeclaration(node) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      !node.moduleSpecifier
    ) {
      for (const el of node.exportClause.elements) {
        const local = el.propertyName?.text ?? el.name.text;
        const canon = wrappers.get(local) ?? localToCanon.get(local);
        if (canon) {
          exportedWrappers.set(el.name.text, canon);
        }
      }
    }
    ts.forEachChild(node, visitExports);
  };
  visitExports(source);

  const rows = [];
  const helpers = [];
  const visitUses = (node) => {
    if (ts.isCallExpression(node)) {
      let canon = null;
      if (
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        namespaceLocals.has(node.expression.expression.text)
      ) {
        const name = node.expression.name.text;
        canon = ALL_NAMES.has(name) ? name : null;
      } else {
        canon = resolveCanon(callIdent(node), localToCanon, wrappers);
      }
      if (canon === "resolveStorePath" && rel !== "src/agents/memory-search.ts") {
        canon = null;
      }
      if (canon) {
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        const snippet = text.split("\n")[line] ?? "";
        rows.push({
          pathId: NAME_TO_PATH.get(canon),
          symbol: canon,
          file: rel,
          line: line + 1,
          op: classifyOp(rel, snippet),
          profile: classifyLane(rel),
          deploymentProfile: classifyDeploymentProfile(rel),
          snippet: snippet.trim().slice(0, 180),
        });
      }
    }
    if (ts.isFunctionDeclaration(node) && node.name) {
      maybeHelper(node.name.text, node);
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      maybeHelper(node.name.text, node);
    }
    ts.forEachChild(node, visitUses);
  };

  function maybeHelper(name, node) {
    if (!HELPER_NAME.test(name) && !SYNTHESIS_SYMBOLS.has(name)) {
      return;
    }
    const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
    helpers.push({
      name,
      file: rel,
      line: line + 1,
      kind: ALL_NAMES.has(name) ? "known-symbol" : "new-helper",
      profile: classifyLane(rel),
    });
  }

  visitUses(source);
  return { rows, helpers, wrappers, exportedWrappers };
}

function isNestedFunctionLike(node) {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isMethodDeclaration(node)
  );
}

function findCanonCall(body, localToCanon, wrappers) {
  let found = null;
  const visit = (node) => {
    if (node !== body && isNestedFunctionLike(node)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      const canon = resolveCanon(callIdent(node), localToCanon, wrappers);
      if (canon) {
        found = canon;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return found;
}

function isThinWrapperCandidate(spanNode, body, source) {
  const start = source.getLineAndCharacterOfPosition(spanNode.getStart(source)).line;
  const end = source.getLineAndCharacterOfPosition(spanNode.end).line;
  if (end - start + 1 > 10) {
    return false;
  }
  let calls = 0;
  const visit = (node) => {
    if (node !== body && isNestedFunctionLike(node)) {
      return;
    }
    if (ts.isCallExpression(node)) {
      calls += 1;
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return calls > 0 && calls <= 3;
}

export function resolveSpecifier(fromFile, spec) {
  if (!spec.startsWith(".")) {
    return null;
  }
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const candidate of [
    `${base}.ts`,
    `${base}.js`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  if (base.endsWith(".js")) {
    const tsPath = `${base.slice(0, -3)}.ts`;
    if (fs.existsSync(tsPath)) {
      return tsPath;
    }
  }
  return null;
}

export function collectImportedNames(fromFile, spec, named) {
  const target = resolveSpecifier(fromFile, spec);
  if (!target) {
    return named;
  }
  const source = ts.createSourceFile(
    target,
    fs.readFileSync(target, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const resolved = new Set(named);
  const visit = (node) => {
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      const reexported = [];
      if (node.exportClause && ts.isNamedExports(node.exportClause)) {
        for (const el of node.exportClause.elements) {
          const exported = el.name.text;
          const orig = el.propertyName?.text ?? exported;
          if (named.includes(exported) || named.includes(orig)) {
            reexported.push(orig);
          }
        }
      }
      if (reexported.length > 0) {
        for (const name of collectImportedNames(target, node.moduleSpecifier.text, reexported)) {
          resolved.add(name);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return [...resolved];
}
