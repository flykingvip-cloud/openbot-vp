/**
 * Source-scan wiring locks for the Constitutional runtime shadow deps
 * (Checkpoint C2) and the attempt call site (Checkpoint C3). Frozen test plan
 * cases B-18, B-20, B-24, B-28, B-36 and B-37.
 *
 * Reads source text and the TypeScript syntax tree only: this file never
 * imports or calls the embedded attempt runner. Every detector is first run on
 * known-bad synthetic sources, so a passing lock is not a vacuous one.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
// Assembled from parts so a plain text grep for the runner call or for the flag
// read still finds only the real sites, never this scanner.
const RUNNER = ["runEmbedded", "Attempt"].join("");
const FLAG_KEY = ["OPENBOT", "CONSTITUTIONAL", "RUNTIME", "SHADOW"].join("_");
const DEPS_FIELD = "constitutionalRuntimeShadowDeps";
const DEPS_TYPE = "ConstitutionalRuntimeShadowDeps";
const DEPS_KEYS = ["now", "runtimeShadowEnabled", "sink"];
const BOUND_METHODS = new Set(["apply", "bind", "call"]);
const TEST_FILE = /\.test\.[cm]?tsx?$/;

const P = "src/agents/pi-embedded-runner";
const E = "src/agents/execution-preflight";
const RUN_TS = "src/agent-runtime/execution/runner/embedded-run.ts";
const TYPES_TS = `${P}/run/types.ts`;
const PARAMS_TS = `${P}/run/params.ts`;
const ATTEMPT_TS = "src/agent-runtime/execution/runner/embedded-attempt.ts";
const ATTEMPT_MODULE = "src/agent-runtime/execution/runner/embedded-attempt";
const CALLER_TESTS = [
  `${P}/run/attempt.context-assemble-pairing.runner.test.ts`,
  `${P}/run/attempt.spawn-workspace.test.ts`,
  `${P}/run/execution-router-shadow.test.ts`,
];
const CALLER_ALLOWLIST = [RUN_TS, ...CALLER_TESTS].toSorted();
const SHADOW_MODULES = ["deps", "gate", "observe", "projection", "sink"].map(
  (name) => `${E}/constitutional-runtime-shadow-${name}.ts`,
);
const SHADOW_TESTS = ["gate", "projection", "sink", "observe", "wiring"].map(
  (name) => `${E}/constitutional-runtime-shadow-${name}.test.ts`,
);
const FACADE_TS = `${E}/constitutional-runtime-facade.ts`;
const GATE_FN = "isConstitutionalRuntimeShadowEnabled";
const OBSERVE_FN = "observeConstitutionalRuntimeShadow";
const GATE_SPECIFIER = "../../../agents/execution-preflight/constitutional-runtime-shadow-gate.js";
const OBSERVE_SPECIFIER =
  "../../../agents/execution-preflight/constitutional-runtime-shadow-observe.js";
/** B-18: everything a shadow module may import. */
const SHADOW_IMPORT_ALLOWLIST = new Set([
  "./constitutional-runtime-facade.js",
  "./types.js",
  ...["deps", "gate", "observe", "projection", "sink"].map(
    (name) => `./constitutional-runtime-shadow-${name}.js`,
  ),
]);
/** B-18: the façade's two pre-existing imports (report-only contracts entry, row types). */
const FACADE_IMPORTS = ["../../../packages/constitutional-contracts/src/index.js", "./types.js"];

function read(relPath: string): string {
  return readFileSync(path.join(REPO_ROOT, relPath), "utf8");
}

function parse(fileName: string, text: string = read(fileName)): ts.SourceFile {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, kind);
}

/** Runs git grep over tracked and untracked (not ignored) TypeScript files. */
function gitGrep(args: string[]): string {
  try {
    return execFileSync(
      "git",
      ["grep", "--untracked", ...args, "--", "*.ts", "*.tsx", "*.mts", "*.cts"],
      { cwd: REPO_ROOT, encoding: "utf8" },
    );
  } catch (error) {
    // git grep exits 1 when nothing matches.
    if ((error as { status?: number }).status === 1) {
      return "";
    }
    throw error;
  }
}

function filesContaining(needle: string): string[] {
  return gitGrep(["-l", "-F", "-e", needle]).split("\n").filter(Boolean).toSorted();
}

function walk(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
}

function where(source: ts.SourceFile, node: ts.Node): string {
  const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
  return `${source.fileName}:${line + 1}`;
}

function nameText(node: ts.Node | undefined): string | undefined {
  return node && (ts.isIdentifier(node) || ts.isStringLiteralLike(node)) ? node.text : undefined;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isTypeAssertionExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

/** `runner`, `module.runner` or `module["runner"]`. */
function isRunnerRef(expression: ts.Expression): boolean {
  const target = unwrap(expression);
  if (ts.isIdentifier(target)) {
    return target.text === RUNNER;
  }
  if (ts.isPropertyAccessExpression(target)) {
    return target.name.text === RUNNER;
  }
  return ts.isElementAccessExpression(target) && nameText(target.argumentExpression) === RUNNER;
}

function directCalls(source: ts.SourceFile): ts.CallExpression[] {
  const calls: ts.CallExpression[] = [];
  walk(source, (node) => {
    if (ts.isCallExpression(node) && isRunnerRef(node.expression)) {
      calls.push(node);
    }
  });
  return calls;
}

function literalKeys(literal: ts.ObjectLiteralExpression): (string | undefined)[] {
  return literal.properties.map((property) =>
    ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)
      ? nameText(property.name)
      : undefined,
  );
}

function hasExactlyDepsKeys(literal: ts.ObjectLiteralExpression): boolean {
  // A spread, method or computed key has no plain name and can never match.
  const keys = literalKeys(literal).map((key) => key ?? "<not a plain property>");
  return JSON.stringify(keys.toSorted()) === JSON.stringify(DEPS_KEYS);
}

/** The literal of `Object.freeze({ now, runtimeShadowEnabled, sink })`: exactly those keys, no spread. */
function frozenLiteralOf(
  expression: ts.Expression | undefined,
): ts.ObjectLiteralExpression | undefined {
  const call = expression ? unwrap(expression) : undefined;
  if (
    !call ||
    !ts.isCallExpression(call) ||
    !ts.isPropertyAccessExpression(call.expression) ||
    nameText(call.expression.expression) !== "Object" ||
    call.expression.name.text !== "freeze" ||
    call.arguments.length !== 1
  ) {
    return undefined;
  }
  const [literal] = call.arguments;
  return literal && ts.isObjectLiteralExpression(literal) && hasExactlyDepsKeys(literal)
    ? literal
    : undefined;
}

function frozenDepsLiteral(expression: ts.Expression | undefined): boolean {
  return frozenLiteralOf(expression) !== undefined;
}

function depsValue(property: ts.ObjectLiteralElementLike | undefined): ts.Expression | undefined {
  if (property && ts.isPropertyAssignment(property)) {
    return unwrap(property.initializer);
  }
  return property && ts.isShorthandPropertyAssignment(property) ? property.name : undefined;
}

/** The value a call passes as its deps property, if its argument is an object literal. */
function depsArgumentValue(call: ts.CallExpression): ts.Expression | undefined {
  const [argument] = call.arguments;
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return undefined;
  }
  return depsValue(argument.properties[literalKeys(argument).indexOf(DEPS_FIELD)]);
}

function declarationsNamed(source: ts.SourceFile, name: string): ts.VariableDeclaration[] {
  const found: ts.VariableDeclaration[] = [];
  walk(source, (node) => {
    if (ts.isVariableDeclaration(node) && nameText(node.name) === name) {
      found.push(node);
    }
  });
  return found;
}

function isConst(declaration: ts.VariableDeclaration): boolean {
  const list = declaration.parent;
  return ts.isVariableDeclarationList(list) && (list.flags & ts.NodeFlags.Const) !== 0;
}

/** The nearest enclosing function, or the source file for module scope. */
function enclosingFunction(node: ts.Node): ts.Node {
  let current = node.parent;
  while (!ts.isFunctionLike(current) && !ts.isSourceFile(current)) {
    current = current.parent;
  }
  return current;
}

/** B-36: why a direct call fails to pass the deps explicitly, after every spread. */
function depsInjectionProblem(call: ts.CallExpression): string | undefined {
  const [argument] = call.arguments;
  if (!argument || !ts.isObjectLiteralExpression(argument)) {
    return "argument is not an object literal";
  }
  const keys = literalKeys(argument);
  const depsIndexes = keys.flatMap((key, index) => (key === DEPS_FIELD ? [index] : []));
  if (depsIndexes.length !== 1) {
    return `expected one explicit ${DEPS_FIELD} property, found ${depsIndexes.length}`;
  }
  const depsIndex = depsIndexes[0] ?? -1;
  const lastSpread = argument.properties.findLastIndex((property) =>
    ts.isSpreadAssignment(property),
  );
  if (lastSpread > depsIndex) {
    return `${DEPS_FIELD} is written before a spread`;
  }
  const value = depsArgumentValue(call);
  const empty =
    !value ||
    value.kind === ts.SyntaxKind.NullKeyword ||
    ts.isVoidExpression(value) ||
    nameText(value) === "undefined";
  return empty ? `${DEPS_FIELD} is empty` : undefined;
}

/** B-28: a direct-caller test passes a frozen deps literal, inline or through one same-file const. */
function callerDepsProblems(source: ts.SourceFile): string[] {
  return directCalls(source).flatMap((call) => {
    const value = depsArgumentValue(call);
    if (frozenDepsLiteral(value)) {
      return [];
    }
    const declarations =
      value && ts.isIdentifier(value) ? declarationsNamed(source, value.text) : [];
    const [declaration] = declarations;
    const ok =
      declarations.length === 1 &&
      declaration !== undefined &&
      isConst(declaration) &&
      frozenDepsLiteral(declaration.initializer);
    return ok ? [] : [`${where(source, call)} does not pass a frozen deps literal`];
  });
}

/** Repo path (no extension) of a relative module specifier. */
function resolveSpecifier(fromFile: string, specifier: string): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const joined = path.posix.join(path.posix.dirname(fromFile), specifier);
  return path.posix.normalize(joined).replace(/\.[cm]?[jt]sx?$/, "");
}

/** B-37: indirect invocations, re-exports and re-bindings of the runner. */
function runnerIndirections(source: ts.SourceFile): string[] {
  const problems: string[] = [];
  const definitionFile = source.fileName.replace(/\.ts$/, "") === ATTEMPT_MODULE;
  walk(source, (node) => {
    // Position is computed only for a hit; most nodes are not one.
    const flag = (label: string) => problems.push(`${where(source, node)} ${label}`);
    if (ts.isPropertyAccessExpression(node) && BOUND_METHODS.has(node.name.text)) {
      if (isRunnerRef(node.expression)) {
        flag(`.${node.name.text}`);
      }
    } else if (ts.isElementAccessExpression(node) && isRunnerRef(node.expression)) {
      if (BOUND_METHODS.has(nameText(node.argumentExpression) ?? "")) {
        flag(`[${nameText(node.argumentExpression)}]`);
      }
    } else if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const [first] = node.arguments;
      if (nameText(node.expression.expression) === "Reflect" && first && isRunnerRef(first)) {
        flag(`Reflect.${node.expression.name.text}`);
      }
    } else if (ts.isExportSpecifier(node)) {
      if (!definitionFile && (nameText(node.propertyName) ?? nameText(node.name)) === RUNNER) {
        flag("re-export");
      }
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      const star = !node.exportClause || ts.isNamespaceExport(node.exportClause);
      const target = resolveSpecifier(source.fileName, nameText(node.moduleSpecifier) ?? "");
      if (star && target === ATTEMPT_MODULE) {
        flag("star re-export of the attempt module");
      }
    } else if (ts.isImportSpecifier(node) || ts.isBindingElement(node)) {
      if (nameText(node.propertyName) === RUNNER && nameText(node.name) !== RUNNER) {
        flag("renamed binding");
      }
    } else if (
      ts.isVariableDeclaration(node) &&
      node.initializer &&
      isRunnerRef(node.initializer)
    ) {
      flag("alias");
    } else if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      if (isRunnerRef(node.right)) {
        flag("assignment");
      }
    }
  });
  return problems;
}

/** `process`, `globalThis.process` or `global.process`. */
function isProcessRef(expression: ts.Expression): boolean {
  const target = unwrap(expression);
  return (
    (ts.isIdentifier(target) && target.text === "process") ||
    (ts.isPropertyAccessExpression(target) && target.name.text === "process")
  );
}

/** `process.env` / `process["env"]` as syntax; strings and comments do not count. */
function envObjectRefs(source: ts.SourceFile): ts.Expression[] {
  const found: ts.Expression[] = [];
  walk(source, (node) => {
    const member =
      (ts.isPropertyAccessExpression(node) && node.name.text === "env") ||
      (ts.isElementAccessExpression(node) && nameText(node.argumentExpression) === "env");
    if (member && isProcessRef(node.expression)) {
      found.push(node);
    }
  });
  return found;
}

function identifiersNamed(source: ts.SourceFile, names: readonly string[]): string[] {
  const found: string[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && names.includes(node.text)) {
      found.push(`${where(source, node)} ${node.text}`);
    }
  });
  return found;
}

/** Specifiers passed to `vi.mock` / `vi.doMock`, plus any `vi.stubEnv` / `vi.stubGlobal` use. */
function testDoubles(source: ts.SourceFile): { mocked: string[]; stubs: string[] } {
  const mocked: string[] = [];
  const stubs: string[] = [];
  walk(source, (node) => {
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) {
      return;
    }
    if (nameText(node.expression.expression) !== "vi") {
      return;
    }
    const method = node.expression.name.text;
    if (method === "mock" || method === "doMock") {
      mocked.push(nameText(node.arguments[0]) ?? "<dynamic>");
    } else if (method === "stubEnv" || method === "stubGlobal") {
      stubs.push(`${where(source, node)} vi.${method}`);
    }
  });
  return { mocked, stubs };
}

function countOf(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

/** Initializer text per key of a frozen deps literal, whitespace and trailing commas removed. */
function initializerTexts(
  literal: ts.ObjectLiteralExpression | undefined,
  source: ts.SourceFile,
): Record<string, string> {
  return Object.fromEntries(
    (literal?.properties ?? []).map((property) => {
      const key = ts.isPropertyAssignment(property) ? nameText(property.name) : undefined;
      const text = ts.isPropertyAssignment(property)
        ? property.initializer.getText(source).replace(/\s+/g, "").replace(/,\)/g, ")")
        : "<not a key: value property>";
      return [key ?? "<unnamed>", text];
    }),
  );
}

/** B-18: static import/export-from specifiers, plus any dynamic `import()` or `require()`. */
function moduleSpecifiers(source: ts.SourceFile): { static: string[]; dynamic: string[] } {
  const found = { static: [] as string[], dynamic: [] as string[] };
  walk(source, (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      found.static.push(nameText(node.moduleSpecifier) ?? "<computed>");
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const dynamic =
        callee.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(callee) && callee.text === "require");
      if (dynamic) {
        found.dynamic.push(`${where(source, node)} ${nameText(node.arguments[0]) ?? "<computed>"}`);
      }
    }
  });
  return found;
}

/** Identifiers with this name, other than the import binding itself. */
function referencesTo(source: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  walk(source, (node) => {
    if (ts.isIdentifier(node) && node.text === name && !ts.isImportSpecifier(node.parent)) {
      found.push(node);
    }
  });
  return found;
}

function firstCallTo(source: ts.SourceFile, name: string): ts.CallExpression | undefined {
  let call: ts.CallExpression | undefined;
  walk(source, (node) => {
    if (!call && ts.isCallExpression(node) && nameText(node.expression) === name) {
      call = node;
    }
  });
  return call;
}

/**
 * B-20: why the attempt's Constitutional call site is not one gated, contained,
 * result-free block after the filtered tool set. Reverting it then means removing
 * two imports and one if-statement, and nothing else in the file depends on it.
 */
function attemptCallSiteProblems(source: ts.SourceFile): string[] {
  const problems: string[] = [];
  const shadowImports = source.statements
    .filter(ts.isImportDeclaration)
    .filter((statement) =>
      /constitutional-runtime-(shadow|facade)/.test(nameText(statement.moduleSpecifier) ?? ""),
    )
    .map((statement) => {
      const named = statement.importClause?.namedBindings;
      const names =
        named && ts.isNamedImports(named)
          ? named.elements.map((element) => element.name.text)
          : ["<default or namespace>"];
      const typeOnly = statement.importClause?.isTypeOnly ? "type " : "";
      return `${typeOnly}${nameText(statement.moduleSpecifier)}:${names.join(",")}`;
    })
    .toSorted();
  const expectedImports = [`${GATE_SPECIFIER}:${GATE_FN}`, `${OBSERVE_SPECIFIER}:${OBSERVE_FN}`];
  if (JSON.stringify(shadowImports) !== JSON.stringify(expectedImports)) {
    problems.push(`shadow imports are ${JSON.stringify(shadowImports)}`);
  }

  const gateRefs = referencesTo(source, GATE_FN);
  const observeRefs = referencesTo(source, OBSERVE_FN);
  if (gateRefs.length !== 1 || observeRefs.length !== 1) {
    problems.push(
      `expected one gate and one observe reference, found ${gateRefs.length} and ${observeRefs.length}`,
    );
    return problems;
  }
  const gateCall = gateRefs[0]?.parent;
  const observeCall = observeRefs[0]?.parent;
  if (
    !gateCall ||
    !ts.isCallExpression(gateCall) ||
    !observeCall ||
    !ts.isCallExpression(observeCall)
  ) {
    problems.push("the gate and observe references are not plain calls");
    return problems;
  }
  const gateArgs = gateCall.arguments.map((arg) => arg.getText(source));
  if (JSON.stringify(gateArgs) !== JSON.stringify([`params.${DEPS_FIELD}.runtimeShadowEnabled`])) {
    problems.push(`gate arguments are ${JSON.stringify(gateArgs)}`);
  }
  const observeArgs = observeCall.arguments.map((arg) => arg.getText(source));
  if (
    JSON.stringify(observeArgs) !== JSON.stringify([`params.${DEPS_FIELD}`, "executionPreflight"])
  ) {
    problems.push(`observe arguments are ${JSON.stringify(observeArgs)}`);
  }

  const gateIf = gateCall.parent;
  if (!ts.isIfStatement(gateIf) || gateIf.expression !== gateCall || gateIf.elseStatement) {
    problems.push("the gate call is not the whole condition of an if without else");
    return problems;
  }
  const thenStatements = ts.isBlock(gateIf.thenStatement) ? gateIf.thenStatement.statements : [];
  const [tryStatement] = thenStatements;
  if (thenStatements.length !== 1 || !tryStatement || !ts.isTryStatement(tryStatement)) {
    problems.push("the gated block is not a single try statement");
    return problems;
  }
  const [observeStatement] = tryStatement.tryBlock.statements;
  if (
    tryStatement.tryBlock.statements.length !== 1 ||
    !observeStatement ||
    !ts.isExpressionStatement(observeStatement) ||
    observeStatement.expression !== observeCall
  ) {
    problems.push("the try block is not the observe call alone, as a statement");
  }
  if (!tryStatement.catchClause || tryStatement.catchClause.block.statements.length > 0) {
    problems.push("the catch block is missing or does something");
  }
  if (tryStatement.finallyBlock) {
    problems.push("the try statement has a finally block");
  }

  const buildCall = firstCallTo(source, "buildExecutionPreflight");
  const toolsCall = firstCallTo(source, "applyPreflightToTools");
  if (!buildCall || !toolsCall) {
    problems.push("the preflight build or the tool filter is missing");
  } else {
    if (
      gateIf.getStart(source) < toolsCall.getEnd() ||
      gateIf.getStart(source) < buildCall.getEnd()
    ) {
      problems.push("the call site runs before the preflight result or the filtered tools exist");
    }
    const owner = enclosingFunction(gateIf);
    if (enclosingFunction(toolsCall) !== owner || enclosingFunction(buildCall) !== owner) {
      problems.push("the call site is not in the function that builds the preflight");
    }
  }
  return problems;
}

/** Production files (tests excluded) whose source names this module path. */
function productionImporters(moduleBasename: string): string[] {
  return filesContaining(`/${moduleBasename}.js"`).filter(
    (file) => file.startsWith("src/") && !TEST_FILE.test(file),
  );
}

const parsed = new Map<string, ts.SourceFile>();
function parseRepoFile(relPath: string): ts.SourceFile {
  let source = parsed.get(relPath);
  if (!source) {
    source = parse(relPath);
    parsed.set(relPath, source);
  }
  return source;
}

describe("Constitutional runtime shadow wiring locks", () => {
  it("self-check: the call and injection detectors flag known-bad sources", () => {
    const calls = parse(
      "synthetic/calls.ts",
      [
        `${RUNNER}({});`,
        `async function later() { await ${RUNNER}({}); }`,
        `(${RUNNER})({});`,
        `mod.${RUNNER}({});`,
        `mod["${RUNNER}"]({});`,
        `${RUNNER}!({});`,
        `vi.mocked(${RUNNER});`,
        `${RUNNER}.mockResolvedValue(1);`,
        `const text = "${RUNNER}({})";`,
        `// ${RUNNER}({}) in a comment`,
      ].join("\n"),
    );
    expect(directCalls(calls)).toHaveLength(6);

    const injection = parse(
      "synthetic/injection.ts",
      [
        `${RUNNER}({ ...params, ${DEPS_FIELD} });`,
        `${RUNNER}({ ...params });`,
        `${RUNNER}({ ${DEPS_FIELD}, ...params });`,
        `${RUNNER}({ ...params, ${DEPS_FIELD}: undefined });`,
        `${RUNNER}(params);`,
        `${RUNNER}({ ${DEPS_FIELD}, ${DEPS_FIELD} });`,
      ].join("\n"),
    );
    expect(directCalls(injection).map(depsInjectionProblem)).toEqual([
      undefined,
      expect.stringMatching(/found 0$/),
      expect.stringMatching(/before a spread$/),
      expect.stringMatching(/is empty$/),
      "argument is not an object literal",
      expect.stringMatching(/found 2$/),
    ]);

    const caller = parse(
      "synthetic/caller.test.ts",
      [
        "const good = Object.freeze({ runtimeShadowEnabled: false, sink, now });",
        "let mutable = Object.freeze({ runtimeShadowEnabled: false, sink, now });",
        "const loose = { runtimeShadowEnabled: false, sink, now };",
        "const extra = Object.freeze({ runtimeShadowEnabled: false, sink, now, env });",
        `${RUNNER}({ ${DEPS_FIELD}: good });`,
        `${RUNNER}({ ${DEPS_FIELD}: Object.freeze({ runtimeShadowEnabled: true, sink, now }) });`,
        `${RUNNER}({ ${DEPS_FIELD}: mutable });`,
        `${RUNNER}({ ${DEPS_FIELD}: loose });`,
        `${RUNNER}({ ${DEPS_FIELD}: extra });`,
      ].join("\n"),
    );
    expect(callerDepsProblems(caller)).toHaveLength(3);
  });

  it("self-check: the indirection, environment and test-double detectors flag known-bad sources", () => {
    const indirect = parse(
      "src/agent-runtime/execution/runner/synthetic-indirect.ts",
      [
        `${RUNNER}.call(null, {});`,
        `${RUNNER}.apply(null, [{}]);`,
        `const bound = ${RUNNER}.bind(null);`,
        `${RUNNER}["call"](null, {});`,
        `Reflect.apply(${RUNNER}, null, [{}]);`,
        `export { ${RUNNER} } from "./embedded-attempt.js";`,
        `export * from "./embedded-attempt.js";`,
        `export * as attemptModule from "./embedded-attempt.js";`,
        `import { ${RUNNER} as go } from "./embedded-attempt.js";`,
        `const { ${RUNNER}: viaDestructure } = mod;`,
        `const alias = ${RUNNER};`,
        `later = mod.${RUNNER};`,
      ].join("\n"),
    );
    expect(runnerIndirections(indirect)).toHaveLength(12);

    const env = parse(
      "synthetic/env.ts",
      [
        `const a = process.env.${FLAG_KEY};`,
        `const b = process["env"];`,
        "const c = globalThis.process.env;",
        "const d = { ...process.env };",
        "// process.env in a comment",
        'const e = "process.env";',
      ].join("\n"),
    );
    expect(envObjectRefs(env)).toHaveLength(4);

    const doubles = parse(
      "synthetic/doubles.test.ts",
      [
        'vi.mock("node:process", () => ({}));',
        `vi.stubEnv("${FLAG_KEY}", "1");`,
        'vi.stubGlobal("process", {});',
        'vi.mock("./constitutional-runtime-facade.js");',
      ].join("\n"),
    );
    const found = testDoubles(doubles);
    expect(found.mocked).toEqual(["node:process", "./constitutional-runtime-facade.js"]);
    expect(found.stubs).toHaveLength(2);
  });

  it("B-24: run.ts is the only reader of the flag, reading it once and before any loop", () => {
    // Production code under src/ names the key only in run.ts.
    const production = filesContaining(FLAG_KEY).filter(
      (file) => file.startsWith("src/") && !TEST_FILE.test(file),
    );
    expect(production).toEqual([RUN_TS]);

    // run.ts: its one environment access is the flag, parsed immediately, in the
    // body of runEmbeddedPiAgent itself (not a closure), ahead of every loop there.
    const run = parseRepoFile(RUN_TS);
    const reads = envObjectRefs(run);
    const [envRef] = reads;
    const member = envRef?.parent;
    const parserCall = member?.parent;
    const owner = envRef ? enclosingFunction(envRef) : undefined;
    const loopStarts: number[] = [];
    if (owner) {
      walk(owner, (node) => {
        if (ts.isIterationStatement(node, false)) {
          loopStarts.push(node.getStart(run));
        }
      });
    }
    expect({
      keyMentions: countOf(run.text, FLAG_KEY),
      envAccesses: reads.map((node) => where(run, node)).length,
      member: member && ts.isPropertyAccessExpression(member) ? member.name.text : undefined,
      parser:
        parserCall && ts.isCallExpression(parserCall) ? nameText(parserCall.expression) : undefined,
      soleArgument:
        parserCall !== undefined &&
        ts.isCallExpression(parserCall) &&
        parserCall.arguments.length === 1 &&
        parserCall.arguments[0] === member,
      owner: owner && ts.isFunctionDeclaration(owner) ? owner.name?.text : undefined,
      hasLoops: loopStarts.length > 0,
      beforeEveryLoop:
        envRef !== undefined && loopStarts.every((start) => envRef.getStart(run) < start),
    }).toEqual({
      keyMentions: 1,
      envAccesses: 1,
      member: FLAG_KEY,
      parser: "parseConstitutionalRuntimeShadowFlag",
      soleArgument: true,
      owner: "runEmbeddedPiAgent",
      hasLoops: true,
      beforeEveryLoop: true,
    });

    // The shadow modules never touch the environment or a global.
    for (const file of SHADOW_MODULES) {
      const source = parseRepoFile(file);
      expect({
        file,
        envAccesses: envObjectRefs(source).length,
        globals: identifiersNamed(source, ["process", "globalThis"]),
        namesFlag: source.text.includes(FLAG_KEY),
      }).toEqual({ file, envAccesses: 0, globals: [], namesFlag: false });
    }

    // attempt.ts keeps exactly its two unrelated baseline environment uses and
    // never names the flag.
    const attempt = parseRepoFile(ATTEMPT_TS);
    const envConsumers = envObjectRefs(attempt).map((node) => {
      const property = node.parent;
      const literal = property.parent;
      const call = literal.parent;
      if (
        ts.isPropertyAssignment(property) &&
        nameText(property.name) === "env" &&
        ts.isObjectLiteralExpression(literal) &&
        ts.isCallExpression(call) &&
        call.arguments[0] === literal
      ) {
        return nameText(call.expression) ?? "<computed callee>";
      }
      return `unexpected environment use at ${where(attempt, node)}`;
    });
    expect(attempt.text.includes(FLAG_KEY)).toBe(false);
    expect(envConsumers.toSorted()).toEqual(["createAnthropicPayloadLogger", "createCacheTrace"]);
  });

  it("B-28: deps are injected explicitly, with no setter, mutable module state, default or backdoor", () => {
    // run.ts: one const in runEmbeddedPiAgent, frozen, holding exactly the designed values.
    const run = parseRepoFile(RUN_TS);
    const declarations = declarationsNamed(run, DEPS_FIELD);
    const [declaration] = declarations;
    const owner = declaration ? enclosingFunction(declaration) : undefined;
    expect({
      declarations: declarations.length,
      isConst: declaration ? isConst(declaration) : false,
      owner: owner && ts.isFunctionDeclaration(owner) ? owner.name?.text : undefined,
      initializers: initializerTexts(frozenLiteralOf(declaration?.initializer), run),
    }).toEqual({
      declarations: 1,
      isConst: true,
      owner: "runEmbeddedPiAgent",
      initializers: {
        runtimeShadowEnabled: `parseConstitutionalRuntimeShadowFlag(process.env.${FLAG_KEY})`,
        sink: "NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK",
        now: "performance.now.bind(performance)",
      },
    });

    // RunEmbeddedPiAgentParams has no deps, env or flag field, so no upstream caller can supply one.
    const params = read(PARAMS_TS);
    for (const needle of [DEPS_FIELD, DEPS_TYPE, "runtimeShadowEnabled", FLAG_KEY]) {
      expect(params.includes(needle), needle).toBe(false);
    }

    // attempt.ts takes the deps from its params only: no factory, default or fallback.
    const attempt = parseRepoFile(ATTEMPT_TS);
    const defaultOperators = new Set([
      ts.SyntaxKind.QuestionQuestionToken,
      ts.SyntaxKind.BarBarToken,
      ts.SyntaxKind.QuestionQuestionEqualsToken,
      ts.SyntaxKind.BarBarEqualsToken,
    ]);
    const defaults: string[] = [];
    walk(attempt, (node) => {
      if (ts.isCallExpression(node) && frozenDepsLiteral(node)) {
        defaults.push(`${where(attempt, node)} builds deps`);
      } else if (ts.isBinaryExpression(node) && defaultOperators.has(node.operatorToken.kind)) {
        if (node.left.getText(attempt).includes(DEPS_FIELD)) {
          defaults.push(`${where(attempt, node)} defaults the deps`);
        }
      } else if (ts.isBindingElement(node) && node.initializer) {
        if ((nameText(node.propertyName) ?? nameText(node.name)) === DEPS_FIELD) {
          defaults.push(`${where(attempt, node)} defaults the deps in a destructuring`);
        }
      }
    });
    expect(defaults).toEqual([]);
    for (const factory of [
      "NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK",
      "parseConstitutionalRuntimeShadowFlag",
    ]) {
      expect(attempt.text.includes(factory), factory).toBe(false);
    }

    // Shadow modules: no reassignable module state, no setter-style export, no backdoor.
    for (const file of SHADOW_MODULES) {
      const source = parseRepoFile(file);
      const mutable = source.statements.filter(
        (statement) =>
          ts.isVariableStatement(statement) &&
          (statement.declarationList.flags & ts.NodeFlags.Const) === 0,
      );
      const setters = source.statements.flatMap((statement) =>
        ts.isFunctionDeclaration(statement) &&
        /^(set|configure|register|override|install|reset)[A-Z]/.test(statement.name?.text ?? "")
          ? [statement.name?.text]
          : [],
      );
      expect({
        file,
        mutable: mutable.length,
        setters,
        backdoors: identifiersNamed(source, ["globalThis", "__testHooks"]),
      }).toEqual({ file, mutable: 0, setters: [], backdoors: [] });
    }

    // Direct-caller tests inject a frozen deps literal and never reach for the flag.
    const isProcessModule = (specifier: string) => /^(node:)?process$/.test(specifier);
    for (const file of CALLER_TESTS) {
      const source = parseRepoFile(file);
      const { mocked, stubs } = testDoubles(source);
      expect({
        file,
        depsProblems: callerDepsProblems(source),
        namesFlag: source.text.includes(FLAG_KEY),
        processMocks: mocked.filter(isProcessModule),
        stubs,
        backdoors: identifiersNamed(source, ["globalThis", "__testHooks"]),
      }).toEqual({
        file,
        depsProblems: [],
        namesFlag: false,
        processMocks: [],
        stubs: [],
        backdoors: [],
      });
    }

    // Shadow tests hand deps to the helpers directly: no environment, no process mock.
    for (const file of SHADOW_TESTS) {
      const source = parseRepoFile(file);
      const { mocked, stubs } = testDoubles(source);
      expect({
        file,
        envAccesses: envObjectRefs(source).map((node) => where(source, node)),
        processMocks: mocked.filter(isProcessModule),
        stubs,
        backdoors: identifiersNamed(source, ["globalThis", "__testHooks"]),
      }).toEqual({ file, envAccesses: [], processMocks: [], stubs: [], backdoors: [] });
    }
  });

  it("B-36: every direct call passes the deps explicitly after every spread; the field is required", () => {
    const problems = CALLER_ALLOWLIST.flatMap((file) => {
      const source = parseRepoFile(file);
      const calls = directCalls(source);
      if (calls.length === 0) {
        return [`${file}: no direct call found`];
      }
      return calls.flatMap((call) => {
        const problem = depsInjectionProblem(call);
        return problem ? [`${where(source, call)} ${problem}`] : [];
      });
    });
    expect(problems).toEqual([]);

    // Required, non-optional and typed on EmbeddedRunAttemptParams, so omitting it
    // is also a type error; the deps type is imported as a type only.
    const types = parseRepoFile(TYPES_TS);
    const members: ts.PropertySignature[] = [];
    walk(types, (node) => {
      if (ts.isPropertySignature(node) && nameText(node.name) === DEPS_FIELD) {
        members.push(node);
      }
    });
    let alias: ts.Node | undefined = members[0];
    while (alias && !ts.isTypeAliasDeclaration(alias)) {
      alias = alias.parent;
    }
    const imports = types.statements.filter(
      (statement) =>
        ts.isImportDeclaration(statement) && statement.getText(types).includes(DEPS_TYPE),
    );
    expect({
      members: members.length,
      optional: members[0]?.questionToken !== undefined,
      type: members[0]?.type?.getText(types),
      owner: alias && ts.isTypeAliasDeclaration(alias) ? alias.name.text : undefined,
      imports: imports.length,
      typeOnlyImport: imports[0]?.getText(types).startsWith("import type ") ?? false,
    }).toEqual({
      members: 1,
      optional: false,
      type: DEPS_TYPE,
      owner: "EmbeddedRunAttemptParams",
      imports: 1,
      typeOnlyImport: true,
    });
  });

  it("B-37: the direct callers are exactly the reviewed allowlist, with no indirect call or re-export", () => {
    const candidates = filesContaining(RUNNER);
    expect(candidates).toContain(ATTEMPT_TS);
    const callers = candidates.filter((file) => directCalls(parseRepoFile(file)).length > 0);
    expect(callers).toEqual(CALLER_ALLOWLIST);

    // A star re-export never names the runner, so also scan every file that has
    // one and mentions an attempt module.
    const starExports = gitGrep([
      "-l",
      "--all-match",
      "-E",
      "-e",
      "export[[:space:]]*[*]",
      "-e",
      "attempt",
    ])
      .split("\n")
      .filter(Boolean);
    const scanned = [...new Set([...candidates, ...starExports])].toSorted();
    const problems = scanned.flatMap((file) => runnerIndirections(parseRepoFile(file)));
    expect(problems).toEqual([]);
  });

  it("self-check: the call-site and import detectors flag known-bad sources", () => {
    const goodLines = [
      `import { ${GATE_FN} } from "${GATE_SPECIFIER}";`,
      `import { ${OBSERVE_FN} } from "${OBSERVE_SPECIFIER}";`,
      "export async function runEmbeddedAttempt(params) {",
      "  const executionPreflight = buildExecutionPreflight({});",
      "  const tools = applyPreflightToTools([], executionPreflight, {});",
      `  if (${GATE_FN}(params.${DEPS_FIELD}.runtimeShadowEnabled)) {`,
      "    try {",
      `      ${OBSERVE_FN}(params.${DEPS_FIELD}, executionPreflight);`,
      "    } catch {}",
      "  }",
      "  return tools;",
      "}",
    ];
    const good = goodLines.join("\n");
    expect(attemptCallSiteProblems(parse("synthetic/good.ts", good))).toEqual([]);

    const gateLine = `if (${GATE_FN}(params.${DEPS_FIELD}.runtimeShadowEnabled)) {`;
    const variants: Record<string, string> = {
      ungated: good.replace(gateLine, "{"),
      beforeTools: [0, 1, 2, 3, 5, 6, 7, 8, 9, 4, 10, 11]
        .map((index) => goodLines[index])
        .join("\n"),
      rethrows: good.replace("} catch {}", "} catch (error) {\n      throw error;\n    }"),
      resultUsed: good.replace(`      ${OBSERVE_FN}(`, `      const observed = ${OBSERVE_FN}(`),
      extraReference: good.replace(
        "  return tools;",
        `  const gate = ${GATE_FN};\n  return tools;`,
      ),
      extraImport: `import { NOOP_CONSTITUTIONAL_RUNTIME_SHADOW_SINK } from "../../execution-preflight/constitutional-runtime-shadow-sink.js";\n${good}`,
      elseBranch: good.replace("    } catch {}\n  }", "    } catch {}\n  } else {\n  }"),
      constantGate: good.replace(gateLine, `if (${GATE_FN}(true)) {`),
      finallyBlock: good.replace("} catch {}", "} catch {} finally {}"),
      otherFunction: good.replace(
        "  return tools;\n}",
        `  return tools;\n}\nfunction later(params, executionPreflight) {\n  ${gateLine}\n  }\n}`,
      ),
    };
    for (const [name, text] of Object.entries(variants)) {
      expect(text, name).not.toBe(good);
      expect(attemptCallSiteProblems(parse(`synthetic/${name}.ts`, text)), name).not.toEqual([]);
    }

    const leaky = parse(
      "synthetic/leaky-shadow.ts",
      [
        'import fs from "node:fs";',
        'import type { ExecutionPreflight } from "./types.js";',
        "export async function load() {",
        '  await import("./ledger.js");',
        '  return require("./migrations.js");',
        "}",
      ].join("\n"),
    );
    const found = moduleSpecifiers(leaky);
    expect(found.static.filter((specifier) => !SHADOW_IMPORT_ALLOWLIST.has(specifier))).toEqual([
      "node:fs",
    ]);
    expect(found.dynamic).toHaveLength(2);
  });

  it("B-18: the shadow modules import only each other, the façade and preflight types", () => {
    for (const file of SHADOW_MODULES) {
      const found = moduleSpecifiers(parseRepoFile(file));
      expect({
        file,
        outside: found.static.filter((specifier) => !SHADOW_IMPORT_ALLOWLIST.has(specifier)),
        dynamic: found.dynamic,
      }).toEqual({ file, outside: [], dynamic: [] });
    }
    // The façade keeps its two pre-existing imports, so the observation reaches no
    // ledger, migration, trace or receipt writer through a new dependency.
    const facade = moduleSpecifiers(parseRepoFile(FACADE_TS));
    expect({ static: facade.static.toSorted(), dynamic: facade.dynamic }).toEqual({
      static: FACADE_IMPORTS.toSorted(),
      dynamic: [],
    });
    // No shadow module or the façade names a writer or a migration.
    const writerName = /ledger|migrat|recordExecution|writeFile|appendFile|mkdir/i;
    for (const file of [...SHADOW_MODULES, FACADE_TS]) {
      const source = parseRepoFile(file);
      const writers: string[] = [];
      walk(source, (node) => {
        if (ts.isIdentifier(node) && writerName.test(node.text)) {
          writers.push(`${where(source, node)} ${node.text}`);
        }
      });
      expect({ file, writers }).toEqual({ file, writers: [] });
    }
  });

  it("B-20: the attempt call site is one gated, contained block that a single revert removes", () => {
    expect(attemptCallSiteProblems(parseRepoFile(ATTEMPT_TS))).toEqual([]);
    // Nothing else on the hot path depends on the observation.
    expect(productionImporters("constitutional-runtime-shadow-observe")).toEqual([ATTEMPT_TS]);
    expect(productionImporters("constitutional-runtime-shadow-gate")).toEqual(
      [ATTEMPT_TS, RUN_TS].toSorted(),
    );
    expect(productionImporters("constitutional-runtime-facade")).toEqual(
      [
        `${E}/constitutional-runtime-shadow-observe.ts`,
        `${E}/constitutional-runtime-shadow-projection.ts`,
        // Phase D H1: one ACP hot-path hang of observePreflightRuntimeFacade.
        "src/auto-reply/reply/dispatch-acp.ts",
      ].toSorted(),
    );
  });
});
