import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  evaluateShadowConformance as evaluateFromContracts,
  reportPathGap as reportPathGapFromContracts,
} from "@openbot/constitutional-contracts";
import { describe, expect, it } from "vitest";
import {
  CONFORMANCE_SCAFFOLD_BOUNDARY,
  LEGAL_CONSTITUTIONAL_PATHS,
  NO_VALID_PATH,
  evaluateShadowConformance,
  isValidConstitutionalPath,
  reportPathGap,
  samplePathGapInput,
} from "./index.js";

const PACKAGE_SPECIFIERS = [
  "@openbot/constitutional-registry",
  "@openbot/constitutional-conformance",
  "@openbot/constitutional-runtime",
] as const;

function listRepoSourceFiles(root: string): string[] {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist") {
        continue;
      }
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile() && /\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  }
  return out;
}

describe("@openbot/constitutional-conformance scaffold", () => {
  it("re-exports the evaluator and path-gap report without forking them", () => {
    expect(evaluateShadowConformance).toBe(evaluateFromContracts);
    expect(reportPathGap).toBe(reportPathGapFromContracts);
  });

  it("does not enforce, live-invoke, open Fabric, or select a Path", () => {
    expect(CONFORMANCE_SCAFFOLD_BOUNDARY).toMatchObject({
      scope: "phase_d_product_split_scaffold",
      product: "conformance",
      scaffoldOnly: true,
      independentlyDeployable: false,
      deployBoundaryProven: false,
      ownershipProven: false,
      lifecycleProven: false,
      phaseCClaimedGo: false,
      enforce: false,
      liveInvoke: false,
      fabricDefaultOn: false,
      selectsPath: false,
      p8bAuthorized: false,
      p8cAuthorized: false,
      readyToTighten: false,
    });
    expect(LEGAL_CONSTITUTIONAL_PATHS).toEqual([]);
    expect(isValidConstitutionalPath("painted-workflow")).toBe(false);

    const view = {
      schemaVersion: 1 as const,
      kind: "constitutional_ledger_view" as const,
      writeThrough: false as const,
      enforce: false as const,
      liveInvoke: false as const,
      identities: [],
      contracts: [],
      evidence: [],
      sourceLedgers: [],
    };
    const report = evaluateShadowConformance(view, { enforce: true });
    expect(report.mode).toBe("shadow");
    expect(report.enforce).toBe(false);
    expect(report.enforced).toBe(false);
    expect(report.liveInvoke).toBe(false);
    expect(report.fabricDefaultOn).toBe(false);
    expect(report.mutated).toBe(false);
    expect(report.findings.some((finding) => finding.code === "enforce_requested_ignored")).toBe(
      true,
    );

    const inert = reportPathGap(samplePathGapInput);
    expect(inert.invoked).toBe(false);
    expect(inert.gapCode).toBeNull();
    expect(inert.selectedPath).toBeNull();
    expect(inert.executed).toBe(false);

    const named = reportPathGap(samplePathGapInput, { report: true });
    expect(named.gapCode).toBe(NO_VALID_PATH);
    expect(named.selectedPath).toBeNull();
    expect(named.candidateAccepted).toBe(false);
    expect(named.legalPathSelectable).toBe(false);
    expect(named.readyToTighten).toBe(false);
    expect(named.pathUnsetIsTighteningGate).toBe(false);
    expect(named.executed).toBe(false);
    expect(named.enforce).toBe(false);
    expect(named.liveInvoke).toBe(false);
    expect(named.fabricDefaultOn).toBe(false);
    expect(named.paintedAliasUsedAsPath).toBe(false);
  });

  it("is not imported from the product hot path", () => {
    const srcRoot = fileURLToPath(new URL("../../../src", import.meta.url));
    const hits = listRepoSourceFiles(srcRoot).filter((file) => {
      const text = readFileSync(file, "utf8");
      return PACKAGE_SPECIFIERS.some((specifier) => text.includes(specifier));
    });
    expect(hits).toEqual([]);
  });
});
