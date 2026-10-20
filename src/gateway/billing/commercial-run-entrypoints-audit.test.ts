// @vitest-environment node

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMERCIAL_RUN_ENTRYPOINTS,
  type CommercialRunEntrypoint,
} from "./commercial-run-entrypoints.registry.js";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

function assertEntrypointGates(entry: CommercialRunEntrypoint): string[] {
  const failures: string[] = [];
  for (const relativePath of entry.paths) {
    const abs = path.join(repoRoot, relativePath);
    if (!fs.existsSync(abs)) {
      failures.push(`[${entry.id}] missing entry file ${relativePath}`);
      continue;
    }
  }
  const ownerPaths = entry.gateOwnerPaths?.length ? entry.gateOwnerPaths : entry.paths;
  const sources = ownerPaths.map((relativePath) => {
    const abs = path.join(repoRoot, relativePath);
    if (!fs.existsSync(abs)) {
      failures.push(`[${entry.id}] missing gate owner ${relativePath}`);
      return "";
    }
    return fs.readFileSync(abs, "utf8");
  });
  if (failures.length > 0) {
    return failures;
  }
  const combined = sources.join("\n");
  // For delegation chains: entry file must mention the service/symbol that owns the gate
  // OR the owner file must contain a required gate symbol.
  if (entry.gateOwnerPaths?.length) {
    const entrySources = entry.paths.map((p) => fs.readFileSync(path.join(repoRoot, p), "utf8"));
    const entryCombined = entrySources.join("\n");
    const delegates = entry.gateOwnerPaths.some((ownerPath) => {
      const base = path.basename(ownerPath).replace(/\.ts$/, "");
      // path import or createSupervisedTask-style symbol
      return (
        entryCombined.includes(base) ||
        entry.requiredGateSymbols.some((sym) => entryCombined.includes(sym))
      );
    });
    if (!delegates) {
      failures.push(
        `[${entry.id}] entry does not delegate to gate owners ${entry.gateOwnerPaths.join(", ")}`,
      );
    }
    const ownerHasGate = entry.requiredGateSymbols.some((symbol) => combined.includes(symbol));
    if (!ownerHasGate) {
      failures.push(`[${entry.id}] gate owners missing ${entry.requiredGateSymbols.join(" | ")}`);
    }
  } else {
    const hasGate = entry.requiredGateSymbols.some((symbol) => combined.includes(symbol));
    if (!hasGate) {
      failures.push(
        `[${entry.id}] ${entry.paths.join(",")}: missing ${entry.requiredGateSymbols.join(" | ")}`,
      );
    }
  }
  return failures;
}

describe("commercial run entrypoints audit", () => {
  it("every registered entrypoint reaches a real commercial gate (delegation-aware)", () => {
    const failures: string[] = [];
    for (const entry of COMMERCIAL_RUN_ENTRYPOINTS) {
      failures.push(...assertEntrypointGates(entry));
    }
    expect(failures).toEqual([]);
  });

  it("fails when a gate owner symbol is removed (negative)", () => {
    const entry: CommercialRunEntrypoint = {
      id: "negative_fixture",
      label: "negative",
      paths: ["src/gateway/server-methods/supervisor.ts"],
      gateOwnerPaths: ["src/gateway/supervisor/task-create-service.ts"],
      requiredGateSymbols: ["THIS_SYMBOL_DOES_NOT_EXIST_ANYWHERE_ZZZ"],
    };
    const failures = assertEntrypointGates(entry);
    expect(failures.length).toBeGreaterThan(0);
  });
});
