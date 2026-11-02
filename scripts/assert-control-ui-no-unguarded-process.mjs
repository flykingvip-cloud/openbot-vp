#!/usr/bin/env node
/**
 * Fail when Control UI source bare-reads `process.getBuiltinModule`.
 *
 * Browsers have no `process` binding, so `process.getBuiltinModule` throws
 * "process is not defined" (including `(process as …).getBuiltinModule` and
 * `process?.getBuiltinModule`). The safe form is `globalThis.process?.getBuiltinModule`
 * (missing process → undefined → null). Non-optional `globalThis.process.getBuiltinModule`
 * still throws in the browser when `process` is missing.
 *
 * Usage: node scripts/assert-control-ui-no-unguarded-process.mjs <dir-or-file> [...]
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".mjs", ".cjs"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);

const UNGUARDED_SAMPLE = `
const getBuiltinModule = (
  process as NodeJS.Process & {
    getBuiltinModule?: (id: string) => unknown;
  }
).getBuiltinModule;
const also = process.getBuiltinModule;
const optionalBare = process?.getBuiltinModule;
const nonOptionalGlobal = globalThis.process.getBuiltinModule;
`;

const GUARDED_SAMPLE = `
const getBuiltinModule = (
  globalThis.process as
    | (NodeJS.Process & {
        getBuiltinModule?: (id: string) => unknown;
      })
    | undefined
)?.getBuiltinModule;
const direct = globalThis.process?.getBuiltinModule;
const comment = ""; // process.getBuiltinModule
const text = "process.getBuiltinModule";
`;

function maskNonCode(source) {
  const chars = source.split("");
  let i = 0;
  const blank = (start, end) => {
    for (let j = start; j < end; j += 1) {
      if (chars[j] !== "\n") {
        chars[j] = " ";
      }
    }
  };
  while (i < chars.length) {
    const c = chars[i];
    const next = chars[i + 1];
    if (c === "/" && next === "/") {
      const start = i;
      i += 2;
      while (i < chars.length && chars[i] !== "\n") {
        i += 1;
      }
      blank(start, i);
      continue;
    }
    if (c === "/" && next === "*") {
      const start = i;
      i += 2;
      while (i < chars.length && !(chars[i] === "*" && chars[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(chars.length, i + 2);
      blank(start, i);
      continue;
    }
    if (c === "'" || c === '"' || c === "`") {
      const quote = c;
      const start = i;
      i += 1;
      while (i < chars.length) {
        if (chars[i] === "\\") {
          i += 2;
          continue;
        }
        if (chars[i] === quote) {
          i += 1;
          break;
        }
        if (chars[i] === "\n" && quote !== "`") {
          break;
        }
        i += 1;
      }
      blank(start, i);
      continue;
    }
    i += 1;
  }
  return chars.join("");
}

function lineOf(source, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (source[i] === "\n") {
      line += 1;
    }
  }
  return line;
}

function isIdentChar(ch) {
  return Boolean(ch) && /[A-Za-z0-9_$]/.test(ch);
}

function skipWsLeft(code, index) {
  let i = index;
  while (i >= 0 && /\s/.test(code[i])) {
    i -= 1;
  }
  return i;
}

function matchParenLeft(code, closeIndex) {
  let depth = 0;
  for (let i = closeIndex; i >= 0; i -= 1) {
    if (code[i] === ")") {
      depth += 1;
    } else if (code[i] === "(") {
      depth -= 1;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}

function readReceiver(code, endIndex) {
  let i = skipWsLeft(code, endIndex);
  if (i < 0) {
    return "";
  }
  if (code[i] === ")") {
    const open = matchParenLeft(code, i);
    if (open < 0) {
      return code.slice(0, i + 1);
    }
    return code.slice(open + 1, i);
  }
  const end = i;
  while (i >= 0) {
    i = skipWsLeft(code, i);
    if (!isIdentChar(code[i])) {
      break;
    }
    while (i >= 0 && isIdentChar(code[i])) {
      i -= 1;
    }
    const dot = skipWsLeft(code, i);
    if (code[dot] === ".") {
      i = dot - 1;
      if (code[i] === "?") {
        i -= 1;
      }
      continue;
    }
    break;
  }
  return code.slice(i + 1, end + 1);
}

function expressionBeforeAs(expr) {
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const c = expr[i];
    if (c === "(" || c === "{" || c === "[" || c === "<") {
      depth += 1;
    } else if (c === ")" || c === "}" || c === "]" || c === ">") {
      depth = Math.max(0, depth - 1);
    } else if (depth === 0 && expr.startsWith(" as ", i)) {
      return expr.slice(0, i).trim();
    }
  }
  return expr.trim();
}

function classifyReceiver(receiver) {
  const compact = expressionBeforeAs(receiver).replace(/\s+/g, "");
  if (compact === "globalThis.process" || compact === "globalThis?.process") {
    return "globalThis";
  }
  if (compact === "process") {
    return "bare";
  }
  return "other";
}

/**
 * Line numbers of unguarded `process.getBuiltinModule` reads.
 * `globalThis.process?.getBuiltinModule` is not a hit.
 * @param {string} source
 * @returns {number[]}
 */
export function findUnguardedProcessBuiltinReads(source) {
  const code = maskNonCode(source);
  const lines = [];
  const re = /\bgetBuiltinModule\b/g;
  let match = re.exec(code);
  while (match) {
    let i = skipWsLeft(code, match.index - 1);
    let optional = false;
    let isAccess = false;
    if (code[i] === ".") {
      isAccess = true;
      if (code[i - 1] === "?") {
        optional = true;
        i -= 2;
      } else {
        i -= 1;
      }
    }
    if (isAccess) {
      const kind = classifyReceiver(readReceiver(code, i));
      const unguarded = kind === "bare" || (kind === "globalThis" && !optional);
      if (unguarded) {
        lines.push(lineOf(source, match.index));
      }
    }
    match = re.exec(code);
  }
  return lines;
}

function assertDetectorContract() {
  const rejected = findUnguardedProcessBuiltinReads(UNGUARDED_SAMPLE);
  const accepted = findUnguardedProcessBuiltinReads(GUARDED_SAMPLE);
  if (rejected.length < 4 || accepted.length !== 0) {
    console.error(
      "assert-control-ui-no-unguarded-process: detector contract failed " +
        `(rejected ${rejected.length} lines, accepted ${accepted.length} lines). ` +
        "Expected to reject process.getBuiltinModule and accept globalThis.process?.getBuiltinModule.",
    );
    process.exit(1);
  }
}

async function collectFiles(targetPath) {
  const stat = await fs.stat(targetPath);
  if (stat.isFile()) {
    return SOURCE_EXTENSIONS.has(path.extname(targetPath)) ? [targetPath] : [];
  }
  const files = [];
  const entries = await fs.readdir(targetPath, { withFileTypes: true });
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const fullPath = path.join(targetPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && SOURCE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

export async function findViolations(roots) {
  const violations = [];
  for (const root of roots) {
    const files = await collectFiles(root);
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      for (const line of findUnguardedProcessBuiltinReads(content)) {
        violations.push(`${path.relative(process.cwd(), filePath)}:${line}`);
      }
    }
  }
  return violations;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

async function main() {
  assertDetectorContract();
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error(
      "Usage: node scripts/assert-control-ui-no-unguarded-process.mjs <dir-or-file> [...]",
    );
    process.exit(2);
  }
  const violations = await findViolations(args.map((arg) => path.resolve(arg)));
  if (violations.length === 0) {
    return;
  }
  console.error(
    "Unguarded process.getBuiltinModule reads (browser throws 'process is not defined'):",
  );
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error("Use globalThis.process?.getBuiltinModule so a browser evaluates to null.");
  process.exit(1);
}

if (isDirectRun()) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
