#!/usr/bin/env node
/**
 * Floor Runtime v2.1 §2.3 — lint:collab:runtime-authority (MUST 1, second line of defense).
 *
 * Hard rule (no allowlist) for:
 *   - collaboration-dispatch/** / *runtime*.ts (glob *runtime*.ts under dispatch)  (D.3: *runtime* catches round-runtime.ts /
 *     task-runtime.ts; Owner's literal `runtime*.ts` matches nothing today)
 *   - plus future episode-*, beat-*, floor-*, router-*, admission-*, facilitator-*,
 *     handoff-*, legacy-beat-* files
 * Forbidden:
 *   - importing CollaborationDispatchScope / GatewayCollaborationGroupOperatingState
 *     (type or value)
 *   - property access `.operatingState` / `.collaborationPolicy`
 *
 * Composition-root whitelist (skipped):
 *   - runtime-authority.ts
 *   - round-policy-snapshot.ts
 *   - resolve-effective-policy.ts
 *   - policy-compiler*.ts
 *   - runtime-namespace*.ts (P0.0a path infra; not an Episode/beat runtime)
 *   - chat.ts buildGroupRuntimeAuthority (enforced by name check in chat separately;
 *     chat.ts is not under the hard glob)
 *
 * Ratchet (P1-A5 final gate): count of legacyReads / facts.legacyReads accesses
 * across collaboration-dispatch MUST stay at 0 (dot, optional-chain, bracket
 * literal key, object/param/nested destructure). Counts are de-duplicated by
 * AST position. The LegacyPolicyReads type and facts.legacyReads field are
 * deleted; any reintroduction fails this lint.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectTypeScriptFilesFromRoots,
  resolveRepoRoot,
  runAsScript,
  toLine,
} from "./lib/ts-guard-utils.mjs";

export const DISPATCH_ROOT = "src/gateway/collaboration-dispatch";

/** Composition-root / infra files excluded from the hard rule. */
export const HARD_RULE_WHITELIST = new Set([
  "runtime-authority.ts",
  "round-policy-snapshot.ts",
  "resolve-effective-policy.ts",
]);

const HARD_BASENAME_RE =
  /(?:^|\/)(?:[^/]*runtime[^/]*|episode-[^/]+|beat-[^/]+|floor-[^/]+|router-[^/]+|admission-[^/]+|facilitator-[^/]+|handoff-[^/]+|legacy-beat-[^/]+)\.tsx?$/i;

const FORBIDDEN_TYPE_NAMES = new Set([
  "CollaborationDispatchScope",
  "GatewayCollaborationGroupOperatingState",
]);

const FORBIDDEN_PROP_NAMES = new Set(["operatingState", "collaborationPolicy"]);

/**
 * D.3 glob fixture: which basenames under collaboration-dispatch match *runtime*.ts.
 * Used by the self-test so the Owner's `runtime*.ts` typo cannot silently match nothing.
 */
export function listRuntimeGlobMatches(basenames) {
  const re = /^.*runtime.*\.tsx?$/i;
  return basenames.filter((name) => re.test(name)).toSorted();
}

export function isHardRuleTarget(relPath) {
  const normalized = relPath.split(path.sep).join("/");
  if (!normalized.startsWith(`${DISPATCH_ROOT}/`)) {
    return false;
  }
  if (
    normalized.includes(".test.") ||
    normalized.includes(".scan-fixture.") ||
    normalized.includes("/__fixtures__/")
  ) {
    return false;
  }
  const base = path.basename(normalized);
  if (HARD_RULE_WHITELIST.has(base)) {
    return false;
  }
  // P0.0a namespace / migration infra — not Episode/beat runtime modules.
  if (base.startsWith("runtime-namespace")) {
    return false;
  }
  if (base === "runtime-lifecycle.ts") {
    return false;
  }
  // policy-compiler*.ts is composition-root whitelist.
  if (/^policy-compiler.*\.tsx?$/i.test(base)) {
    return false;
  }
  return HARD_BASENAME_RE.test(normalized);
}

/**
 * @param {string} content
 * @param {string} fileName
 * @returns {Array<{ line: number; rule: string; detail: string }>}
 */
export function findCollabRuntimeAuthorityViolations(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const violations = [];
  const report = (node, rule, detail) =>
    violations.push({ line: toLine(sourceFile, node), rule, detail });

  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.importClause) {
      const { name, namedBindings } = node.importClause;
      if (name && FORBIDDEN_TYPE_NAMES.has(name.text)) {
        report(name, "no-scope-or-operating-state-import", `import ${name.text}`);
      }
      if (namedBindings && ts.isNamedImports(namedBindings)) {
        for (const el of namedBindings.elements) {
          const imported = el.propertyName?.text ?? el.name.text;
          if (FORBIDDEN_TYPE_NAMES.has(imported)) {
            report(el, "no-scope-or-operating-state-import", `import type/value { ${imported} }`);
          }
        }
      }
    } else if (ts.isImportEqualsDeclaration(node) && ts.isIdentifier(node.name)) {
      if (FORBIDDEN_TYPE_NAMES.has(node.name.text)) {
        report(node.name, "no-scope-or-operating-state-import", `import = ${node.name.text}`);
      }
    } else if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
      if (FORBIDDEN_PROP_NAMES.has(node.name.text)) {
        report(
          node.name,
          "no-operating-state-or-collaboration-policy-access",
          `.${node.name.text}`,
        );
      }
    } else if (ts.isElementAccessExpression(node) && node.argumentExpression) {
      const arg = node.argumentExpression;
      if (ts.isStringLiteralLike(arg) && FORBIDDEN_PROP_NAMES.has(arg.text)) {
        report(arg, "no-operating-state-or-collaboration-policy-access", `["${arg.text}"]`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

/** True when node is `.legacyReads` or `["legacyReads"]` / `['legacyReads']` (literal key). */
function isLegacyReadsAccess(node) {
  if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.name)) {
    return node.name.text === "legacyReads";
  }
  if (
    ts.isElementAccessExpression(node) &&
    ts.isStringLiteralLike(node.argumentExpression) &&
    node.argumentExpression.text === "legacyReads"
  ) {
    return true;
  }
  return false;
}

/**
 * True when a binding/assignment property name is the literal `legacyReads`
 * (identifier, string literal, or computed string literal like `['legacyReads']`).
 * @param {ts.PropertyName | ts.BindingName} key
 */
function isLegacyReadsPropertyName(key) {
  if (ts.isIdentifier(key) || ts.isStringLiteralLike(key)) {
    return key.text === "legacyReads";
  }
  if (ts.isComputedPropertyName(key) && ts.isStringLiteralLike(key.expression)) {
    return key.expression.text === "legacyReads";
  }
  return false;
}

/**
 * Walk an object binding pattern (and nested object patterns inside arrays)
 * and collect every binding element whose *property name* is the literal
 * `legacyReads`. Array *positional* names like `const [legacyReads] = arr`
 * are NOT hits — they do not read a `.legacyReads` field.
 * @param {ts.ObjectBindingPattern | ts.ArrayBindingPattern} pattern
 * @param {(el: ts.BindingElement) => void} onHit
 */
function visitBindingPatternForLegacyReads(pattern, onHit) {
  if (ts.isArrayBindingPattern(pattern)) {
    for (const el of pattern.elements) {
      if (!ts.isBindingElement(el)) {
        continue; // OmittedExpression
      }
      // Only recurse into nested object/array patterns; do not treat the
      // element binding name as a property key (false positive otherwise).
      if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) {
        visitBindingPatternForLegacyReads(el.name, onHit);
      }
    }
    return;
  }
  for (const el of pattern.elements) {
    if (!ts.isBindingElement(el)) {
      continue;
    }
    const key = el.propertyName ?? el.name;
    if (isLegacyReadsPropertyName(key)) {
      onHit(el);
    }
    if (ts.isObjectBindingPattern(el.name) || ts.isArrayBindingPattern(el.name)) {
      visitBindingPatternForLegacyReads(el.name, onHit);
    }
  }
}

/**
 * Destructuring *assignment* LHS uses ObjectLiteralExpression / ArrayLiteralExpression
 * (not BindingPattern): `({ legacyReads: x } = facts)`.
 * @param {ts.ObjectLiteralExpression | ts.ArrayLiteralExpression} literal
 * @param {(node: ts.Node) => void} onHit
 */
function visitAssignmentPatternForLegacyReads(literal, onHit) {
  if (ts.isArrayLiteralExpression(literal)) {
    for (const el of literal.elements) {
      if (ts.isObjectLiteralExpression(el) || ts.isArrayLiteralExpression(el)) {
        visitAssignmentPatternForLegacyReads(el, onHit);
      } else if (
        ts.isSpreadElement(el) &&
        (ts.isObjectLiteralExpression(el.expression) || ts.isArrayLiteralExpression(el.expression))
      ) {
        visitAssignmentPatternForLegacyReads(el.expression, onHit);
      }
    }
    return;
  }
  for (const prop of literal.properties) {
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === "legacyReads") {
      onHit(prop);
    } else if (ts.isPropertyAssignment(prop) && isLegacyReadsPropertyName(prop.name)) {
      onHit(prop);
    } else if (ts.isPropertyAssignment(prop)) {
      const init = prop.initializer;
      if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) {
        visitAssignmentPatternForLegacyReads(init, onHit);
      }
    }
  }
}

/**
 * Count distinct AST sites that read the retired `legacyReads` bypass field.
 * Sites are de-duplicated by node position so `facts.legacyReads.x` counts as
 * one field access (not also the parent `.legacyReads` whole-object access).
 */
export function countLegacyReadsAccesses(content, fileName = "source.ts") {
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  /** @type {Set<number>} */
  const hits = new Set();
  const mark = (node) => {
    hits.add(node.getStart(sourceFile));
  };

  const visit = (node) => {
    // facts.legacyReads.field / facts["legacyReads"].field — count the field
    // access once (do not also mark the parent legacyReads receiver).
    if (
      (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) &&
      isLegacyReadsAccess(node.expression)
    ) {
      mark(node);
    } else if (isLegacyReadsAccess(node)) {
      // Whole-object read only when it is NOT the receiver of a further member access
      // (that case is already counted above as a field access).
      const parent = node.parent;
      const isReceiverOfMember =
        parent &&
        (ts.isPropertyAccessExpression(parent) || ts.isElementAccessExpression(parent)) &&
        parent.expression === node;
      if (!isReceiverOfMember) {
        mark(node);
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      node.name &&
      (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name))
    ) {
      visitBindingPatternForLegacyReads(node.name, mark);
    } else if (ts.isParameter(node) && node.name) {
      // function f({ legacyReads }) / ({ nested: { legacyReads: x } }) => …
      if (ts.isObjectBindingPattern(node.name) || ts.isArrayBindingPattern(node.name)) {
        visitBindingPatternForLegacyReads(node.name, mark);
      }
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      // ({ legacyReads: x } = facts) / [{ legacyReads }] = arr
      let left = node.left;
      if (ts.isParenthesizedExpression(left)) {
        left = left.expression;
      }
      if (ts.isObjectLiteralExpression(left) || ts.isArrayLiteralExpression(left)) {
        visitAssignmentPatternForLegacyReads(left, mark);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return hits.size;
}

export async function collectCollabRuntimeAuthorityViolations(repoRoot) {
  const files = await collectTypeScriptFilesFromRoots([path.join(repoRoot, DISPATCH_ROOT)]);
  const out = [];
  let legacyReadsTotal = 0;
  const hardTargets = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const content = await fs.readFile(file, "utf8");
    if (!rel.includes(".test.") && !rel.includes(".scan-fixture.")) {
      legacyReadsTotal += countLegacyReadsAccesses(content, file);
    }
    if (!isHardRuleTarget(rel)) {
      continue;
    }
    hardTargets.push(rel);
    for (const v of findCollabRuntimeAuthorityViolations(content, file)) {
      out.push({ path: rel, ...v });
    }
  }
  return {
    files: files.length,
    hardTargets,
    legacyReadsTotal,
    violations: out,
  };
}

export async function main() {
  const repoRoot = resolveRepoRoot(import.meta.url);
  const { files, hardTargets, legacyReadsTotal, violations } =
    await collectCollabRuntimeAuthorityViolations(repoRoot);
  if (violations.length > 0) {
    console.error("Collaboration runtime authority hard rule violated (Floor Runtime v2.1 §2.3):");
    for (const v of violations) {
      console.error(`- ${v.path}:${v.line} [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }
  if (legacyReadsTotal > 0) {
    console.error(
      `Collaboration runtime-authority ratchet failed: legacyReads accesses=${legacyReadsTotal} (must be 0 after P1-A5 final gate)`,
    );
    process.exit(1);
  }
  console.log(
    `lint:collab:runtime-authority ok (${files} files, ${hardTargets.length} hard-rule targets, legacyReads accesses=${legacyReadsTotal})`,
  );
}

runAsScript(import.meta.url, main);
