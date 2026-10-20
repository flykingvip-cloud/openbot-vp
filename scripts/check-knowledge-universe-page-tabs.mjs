#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";

const CONTRACT_PATH = "ui/src/ui/ports/employee/views/home-page-contracts.ts";
const ROUTER_PATH = "ui/src/ui/views/knowledge-universe-page.ts";
const DEFAULT_TAB = "workbench";
const TEST_FILE_RE = /(?:^|\/)(?:__tests__|__fixtures__)(?:\/|$)|\.(?:test|spec)\.(?:ts|tsx)$/;

function createSourceFile(path, source) {
  const scriptKind = path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
}

function walk(node, visit) {
  visit(node);
  node.forEachChild((child) => walk(child, visit));
}

export function extractPageTabContract(source, path = CONTRACT_PATH) {
  const sourceFile = createSourceFile(path, source);
  let declaration;
  walk(sourceFile, (node) => {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "KnowledgeUniversePageTab") {
      declaration = node;
    }
  });
  if (!declaration) {
    throw new Error(`${path}: KnowledgeUniversePageTab type alias was not found`);
  }

  const nodes = ts.isUnionTypeNode(declaration.type) ? declaration.type.types : [declaration.type];
  const values = nodes.map((node) => {
    if (!ts.isLiteralTypeNode(node) || !ts.isStringLiteral(node.literal)) {
      throw new Error(`${path}: KnowledgeUniversePageTab must contain only string literals`);
    }
    return node.literal.text;
  });
  return new Set(values);
}

function unwrapExpression(expression) {
  let current = expression;
  while (
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function calledMemberName(expression) {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text;
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text;
  }
  if (
    ts.isElementAccessExpression(unwrapped) &&
    unwrapped.argumentExpression &&
    (ts.isStringLiteral(unwrapped.argumentExpression) ||
      ts.isNoSubstitutionTemplateLiteral(unwrapped.argumentExpression))
  ) {
    return unwrapped.argumentExpression.text;
  }
  return undefined;
}

export function extractPageTabCalls(source, path) {
  const sourceFile = createSourceFile(path, source);
  const calls = [];
  walk(sourceFile, (node) => {
    if (!ts.isCallExpression(node) || calledMemberName(node.expression) !== "onPageTabChange") {
      return;
    }
    const argument = node.arguments[0];
    if (!argument) {
      return;
    }
    const literal = unwrapExpression(argument);
    if (!ts.isStringLiteral(literal) && !ts.isNoSubstitutionTemplateLiteral(literal)) {
      return;
    }
    const location = sourceFile.getLineAndCharacterOfPosition(literal.getStart(sourceFile));
    calls.push({
      value: literal.text,
      path,
      line: location.line + 1,
      column: location.character + 1,
    });
  });
  return calls;
}

export function extractPageTabRouter(source, path = ROUTER_PATH) {
  const sourceFile = createSourceFile(path, source);
  const switches = [];
  walk(sourceFile, (node) => {
    if (
      ts.isSwitchStatement(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(sourceFile) === "surface" &&
      node.expression.name.text === "pageTab"
    ) {
      switches.push(node);
    }
  });

  const cases = new Set();
  let hasDefault = false;
  const nonLiteralCases = [];
  for (const statement of switches) {
    for (const clause of statement.caseBlock.clauses) {
      if (ts.isDefaultClause(clause)) {
        hasDefault = true;
      } else if (ts.isStringLiteral(clause.expression)) {
        cases.add(clause.expression.text);
      } else {
        nonLiteralCases.push(clause.expression.getText(sourceFile));
      }
    }
  }
  return { cases, hasDefault, switchCount: switches.length, nonLiteralCases };
}

export function auditPageTabRouting({
  contractSource,
  routerSource,
  callSources,
  defaultTab = DEFAULT_TAB,
}) {
  const contract = extractPageTabContract(contractSource);
  const router = extractPageTabRouter(routerSource);
  const calls = callSources.flatMap(({ path, source }) => extractPageTabCalls(source, path));
  const issues = [];

  if (!contract.has(defaultTab)) {
    issues.push({ kind: "missing-default-contract", value: defaultTab });
  }
  if (router.switchCount !== 1) {
    issues.push({ kind: "router-switch-count", count: router.switchCount });
  }
  if (!router.hasDefault) {
    issues.push({ kind: "missing-default-route", value: defaultTab });
  }
  for (const expression of router.nonLiteralCases) {
    issues.push({ kind: "non-literal-route", expression });
  }
  for (const tab of contract) {
    if (tab !== defaultTab && !router.cases.has(tab)) {
      issues.push({ kind: "missing-route", value: tab });
    }
  }
  for (const route of router.cases) {
    if (!contract.has(route)) {
      issues.push({ kind: "unknown-route", value: route });
    }
  }
  for (const call of calls) {
    if (!contract.has(call.value)) {
      issues.push({ kind: "unknown-call", ...call });
    }
  }

  return { ok: issues.length === 0, contract, router, calls, issues };
}

function listCallerPaths(repo) {
  const output = execFileSync("git", ["ls-files", "-z", "--", "ui/src/ui"], {
    cwd: repo,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "pipe"],
  }).toString("utf8");
  return output
    .split("\0")
    .filter((path) => /\.(?:ts|tsx)$/.test(path) && !TEST_FILE_RE.test(path));
}

export function auditRepository(repo = process.cwd()) {
  const root = resolve(repo);
  const read = (path) => readFileSync(resolve(root, path), "utf8");
  return auditPageTabRouting({
    contractSource: read(CONTRACT_PATH),
    routerSource: read(ROUTER_PATH),
    callSources: listCallerPaths(root).map((path) => ({ path, source: read(path) })),
  });
}

function describeIssue(issue) {
  switch (issue.kind) {
    case "missing-default-contract":
      return `default page '${issue.value}' is absent from KnowledgeUniversePageTab`;
    case "router-switch-count":
      return `expected exactly one switch (surface.pageTab), found ${issue.count}`;
    case "missing-default-route":
      return `switch (surface.pageTab) has no default for '${issue.value}'`;
    case "non-literal-route":
      return `router case must be a string literal, found ${issue.expression}`;
    case "missing-route":
      return `KnowledgeUniversePageTab member '${issue.value}' has no router case`;
    case "unknown-route":
      return `router case '${issue.value}' is absent from KnowledgeUniversePageTab`;
    case "unknown-call":
      return `${issue.path}:${issue.line}:${issue.column} calls onPageTabChange('${issue.value}') outside KnowledgeUniversePageTab`;
    default:
      return JSON.stringify(issue);
  }
}

function isDirectRun() {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href);
}

if (isDirectRun()) {
  try {
    const result = auditRepository();
    process.stdout.write(
      `Knowledge Universe page-tab integrity: contract=${result.contract.size} routes=${result.router.cases.size} literalCalls=${result.calls.length}\n`,
    );
    if (!result.ok) {
      for (const issue of result.issues) {
        process.stderr.write(`- ${describeIssue(issue)}\n`);
      }
      process.exitCode = 1;
    }
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
