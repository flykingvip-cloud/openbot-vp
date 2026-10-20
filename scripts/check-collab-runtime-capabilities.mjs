#!/usr/bin/env node
/**
 * Floor Runtime v2.1 §2.2 red line, mechanical check (a) — CI blocking (N4/I1).
 *
 * In `src/gateway/collaboration-dispatch/**` (non-test sources) and
 * `src/gateway/server-methods/chat.ts` there must be no:
 *   - `new KeyedAsyncQueue(...)`   (chat.ts keeps its two existing queues:
 *                                   groupDiscussionQueue / groupBotQueue — I2)
 *   - `setInterval(...)`           (R3 periodic timers)
 *   - `worker_threads` / `child_process` imports or requires
 *   - `new Worker(...)`
 *   - `new AbortController()`      (only chat.ts's existing locations: the
 *                                   `abortController` ×2 and `parentAbortController` ×1
 *                                   run controllers registered in chatAbortControllers)
 * No allowlist / skip switch: the chat.ts baseline above is the spec's own exception.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import {
  collectTypeScriptFilesFromRoots,
  resolveRepoRoot,
  runAsScript,
  toLine,
  unwrapExpression,
} from "./lib/ts-guard-utils.mjs";

export const DISPATCH_ROOT = "src/gateway/collaboration-dispatch";
export const CHAT_FILE = "src/gateway/server-methods/chat.ts";
const CHAT_QUEUE_NAMES = new Set(["groupDiscussionQueue", "groupBotQueue"]);
/** chat.ts existing `new AbortController()` sites (§2.2 (a)), by declared name → max count. */
export const CHAT_ABORT_CONTROLLER_BASELINE = { abortController: 2, parentAbortController: 1 };
const FORBIDDEN_MODULES = new Set([
  "worker_threads",
  "node:worker_threads",
  "child_process",
  "node:child_process",
]);

function calleeName(expression) {
  const callee = unwrapExpression(expression);
  if (ts.isIdentifier(callee)) {
    return callee.text;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }
  return null;
}

function declaredName(node) {
  let parent = node.parent;
  while (parent && (ts.isParenthesizedExpression(parent) || ts.isAsExpression(parent))) {
    parent = parent.parent;
  }
  return parent && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)
    ? parent.name.text
    : null;
}

function isTopLevelDeclaration(declaration) {
  const statement = declaration?.parent?.parent;
  return Boolean(
    statement && ts.isVariableStatement(statement) && ts.isSourceFile(statement.parent),
  );
}

/**
 * @param {string} content
 * @param {string} fileName
 * @param {{ isChat?: boolean }} [options]
 * @returns {Array<{ line: number; rule: string; detail: string }>}
 */
export function findCollabRuntimeCapabilityViolations(
  content,
  fileName = "source.ts",
  options = {},
) {
  const isChat = options.isChat === true;
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const violations = [];
  const abortControllerCounts = new Map();
  const report = (node, rule, detail) =>
    violations.push({ line: toLine(sourceFile, node), rule, detail });

  const visit = (node) => {
    if (ts.isNewExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "KeyedAsyncQueue") {
        const declared = declaredName(node);
        const allowed =
          isChat &&
          declared &&
          CHAT_QUEUE_NAMES.has(declared) &&
          isTopLevelDeclaration(node.parent);
        if (!allowed) {
          report(
            node,
            "no-new-keyed-async-queue",
            "new KeyedAsyncQueue (I2: no second orchestration pipe)",
          );
        }
      } else if (name === "Worker") {
        report(node, "no-worker", "new Worker");
      } else if (name === "AbortController") {
        const declared = declaredName(node);
        const max = isChat && declared ? (CHAT_ABORT_CONTROLLER_BASELINE[declared] ?? 0) : 0;
        const count = (abortControllerCounts.get(declared) ?? 0) + 1;
        abortControllerCounts.set(declared, count);
        if (count > max) {
          report(
            node,
            "no-new-abort-controller",
            "new AbortController outside chat.ts existing sites (use the parent AbortSignal)",
          );
        }
      }
    } else if (ts.isCallExpression(node)) {
      const name = calleeName(node.expression);
      if (name === "setInterval") {
        report(node, "no-set-interval", "setInterval (R3 periodic timer)");
      }
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const [arg] = node.arguments;
      if (
        (isRequire || isDynamicImport) &&
        arg &&
        ts.isStringLiteralLike(arg) &&
        FORBIDDEN_MODULES.has(arg.text)
      ) {
        report(node, "no-process-or-thread", `${isRequire ? "require" : "import"}("${arg.text}")`);
      }
    } else if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier) &&
      FORBIDDEN_MODULES.has(node.moduleSpecifier.text)
    ) {
      report(node, "no-process-or-thread", `import from "${node.moduleSpecifier.text}"`);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const ref = node.moduleReference;
      if (
        ts.isExternalModuleReference(ref) &&
        ts.isStringLiteralLike(ref.expression) &&
        FORBIDDEN_MODULES.has(ref.expression.text)
      ) {
        report(node, "no-process-or-thread", `import = require("${ref.expression.text}")`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return violations;
}

export async function collectCollabRuntimeCapabilityViolations(repoRoot) {
  const files = [
    ...(await collectTypeScriptFilesFromRoots([path.join(repoRoot, DISPATCH_ROOT)])),
    path.join(repoRoot, CHAT_FILE),
  ];
  const out = [];
  for (const file of files) {
    const rel = path.relative(repoRoot, file).split(path.sep).join("/");
    const content = await fs.readFile(file, "utf8");
    for (const v of findCollabRuntimeCapabilityViolations(content, file, {
      isChat: rel === CHAT_FILE,
    })) {
      out.push({ path: rel, ...v });
    }
  }
  return { files: files.length, violations: out };
}

export async function main() {
  const repoRoot = resolveRepoRoot(import.meta.url);
  const { files, violations } = await collectCollabRuntimeCapabilityViolations(repoRoot);
  if (violations.length > 0) {
    console.error(
      "Collaboration runtime capability red line violated (Floor Runtime v2.1 §2.2 (a)):",
    );
    for (const v of violations) {
      console.error(`- ${v.path}:${v.line} [${v.rule}] ${v.detail}`);
    }
    process.exit(1);
  }
  console.log(`lint:collab:runtime-capabilities ok (${files} files)`);
}

runAsScript(import.meta.url, main);
