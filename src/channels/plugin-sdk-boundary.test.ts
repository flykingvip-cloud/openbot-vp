import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_ROOT = path.resolve(import.meta.dirname, "..");

function listTypeScriptFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTypeScriptFiles(full));
      continue;
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

const IMPORT_SPECIFIER = /(?:from|import)\s*\(?\s*["']([^"']+)["']/g;

function importSpecifiers(file: string): string[] {
  const text = fs.readFileSync(file, "utf8");
  return [...text.matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? "");
}

describe("channel / plugin-sdk boundary", () => {
  it("does not let src/channels import the plugin-sdk facade", () => {
    const offenders: string[] = [];
    for (const file of listTypeScriptFiles(path.join(SRC_ROOT, "channels"))) {
      for (const specifier of importSpecifiers(file)) {
        if (specifier.includes("/plugin-sdk/") || specifier.endsWith("/plugin-sdk")) {
          offenders.push(`${path.relative(SRC_ROOT, file)} -> ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps package matrix off the gateway billing module", () => {
    const text = fs.readFileSync(path.join(SRC_ROOT, "shared/package-matrix.ts"), "utf8");
    expect(text.includes("gateway/billing")).toBe(false);
    expect(text.includes("./seat-role.js")).toBe(true);
  });

  it("keeps usage formatting off agents and config", () => {
    const text = fs.readFileSync(path.join(SRC_ROOT, "utils/usage-format.ts"), "utf8");
    expect(text.includes("../agents/")).toBe(false);
    expect(text.includes("../config/")).toBe(false);
  });
});
