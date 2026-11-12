import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import { findUnguardedProcessBuiltinReads } from "../../scripts/assert-control-ui-no-unguarded-process.mjs";
import { resolveNodeRequireFromMeta } from "./node-require.ts";

const sourceUrl = new URL("./node-require.ts", import.meta.url);
const source = readFileSync(sourceUrl, "utf8");

function evaluateResolver(sandbox) {
  let js = stripTypeScriptTypes(source, { mode: "strip" });
  js = js.replace(/^export function /m, "function ");
  js += '\nglobalThis.__resolved = resolveNodeRequireFromMeta("file:///browser/app.mjs");\n';
  vm.createContext(sandbox);
  vm.runInContext(js, sandbox, { filename: "node-require.realm.js" });
  return sandbox.__resolved;
}

void test("Node process.getBuiltinModule returns a working require", () => {
  const require = resolveNodeRequireFromMeta(import.meta.url);
  assert.equal(typeof require, "function");
  const fs = require("node:fs");
  assert.equal(typeof fs.readFileSync, "function");
});

void test("browser realm without process returns null and does not throw", () => {
  const resolved = evaluateResolver({});
  assert.equal(resolved, null);
});

void test("missing getBuiltinModule returns null", () => {
  const resolved = evaluateResolver({
    process: {},
  });
  assert.equal(resolved, null);
});

void test("getBuiltinModule throwing returns null", () => {
  const resolved = evaluateResolver({
    process: {
      getBuiltinModule() {
        throw new Error("builtin lookup failed");
      },
    },
  });
  assert.equal(resolved, null);
});

void test("module namespace without createRequire returns null", () => {
  const resolved = evaluateResolver({
    process: {
      getBuiltinModule() {
        return {};
      },
    },
  });
  assert.equal(resolved, null);
});

void test("source uses globalThis.process?.getBuiltinModule and has no bare read", () => {
  assert.match(
    source,
    /globalThis\.process\?\.getBuiltinModule|globalThis\.process as[\s\S]*\?\.getBuiltinModule/,
  );
  assert.deepEqual(findUnguardedProcessBuiltinReads(source), []);
  assert.deepEqual(findUnguardedProcessBuiltinReads("const x = process.getBuiltinModule;"), [1]);
  assert.deepEqual(
    findUnguardedProcessBuiltinReads("const x = globalThis.process?.getBuiltinModule;"),
    [],
  );
});
