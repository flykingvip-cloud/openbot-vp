#!/usr/bin/env bun
/**
 * 静态审计：Commercial Runtime AI 执行入口是否仍包含登记闸口符号。
 *
 * Usage: bun scripts/audit-commercial-run-entrypoints.ts
 */

import fs from "node:fs";
import path from "node:path";
import { COMMERCIAL_RUN_ENTRYPOINTS } from "../src/gateway/billing/commercial-run-entrypoints.registry.ts";

const repoRoot = path.resolve(import.meta.dir, "..");

type Finding = { entryId: string; file: string; missing: string[] };

const findings: Finding[] = [];

for (const entry of COMMERCIAL_RUN_ENTRYPOINTS) {
  for (const relativePath of entry.paths) {
    const abs = path.join(repoRoot, relativePath);
    if (!fs.existsSync(abs)) {
      findings.push({
        entryId: entry.id,
        file: relativePath,
        missing: ["<file missing>"],
      });
      continue;
    }
    const source = fs.readFileSync(abs, "utf8");
    const missing = entry.requiredGateSymbols.filter((symbol) => !source.includes(symbol));
    if (missing.length === entry.requiredGateSymbols.length) {
      findings.push({ entryId: entry.id, file: relativePath, missing });
    }
  }
}

if (findings.length > 0) {
  console.error("Commercial run entrypoint audit FAILED:\n");
  for (const finding of findings) {
    console.error(
      `- [${finding.entryId}] ${finding.file}: missing gate symbols: ${finding.missing.join(", ")}`,
    );
  }
  process.exit(1);
}

console.log(
  `Commercial run entrypoint audit OK (${COMMERCIAL_RUN_ENTRYPOINTS.length} entries checked).`,
);
