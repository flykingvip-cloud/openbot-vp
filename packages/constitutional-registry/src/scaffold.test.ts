import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptPluginInstall as adaptPluginInstallFromContracts,
  projectConstitutionalViewFromSources as projectFromContracts,
} from "@openbot/constitutional-contracts";
import { describe, expect, it } from "vitest";
import {
  EVOLUTION_LEDGER,
  EXECUTION_TRACE_LEDGER,
  NON_EQUIVALENCE,
  PLUGIN_REGISTRY_LEDGER,
  REGISTRY_SCAFFOLD_BOUNDARY,
  VALIDATION_RECEIPT_LEDGER,
  adaptPluginInstall,
  projectConstitutionalViewFromSources,
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

describe("@openbot/constitutional-registry scaffold", () => {
  it("re-exports adapter and read-model functions without forking them", () => {
    expect(adaptPluginInstall).toBe(adaptPluginInstallFromContracts);
    expect(projectConstitutionalViewFromSources).toBe(projectFromContracts);
  });

  it("keeps source ledgers distinct and does not authorize an installed plugin", () => {
    expect(REGISTRY_SCAFFOLD_BOUNDARY).toMatchObject({
      scope: "phase_d_product_split_scaffold",
      product: "registry",
      scaffoldOnly: true,
      independentlyDeployable: false,
      deployBoundaryProven: false,
      ownershipProven: false,
      lifecycleProven: false,
      physicalLedgerMerge: false,
      profileMerge: false,
      pluginInstalledEqualsAuthorized: false,
      receiptEqualsProof: false,
      phaseCClaimedGo: false,
      enforce: false,
      liveInvoke: false,
      fabricDefaultOn: false,
      selectsPath: false,
    });
    expect(NON_EQUIVALENCE.pluginInstalledIsNotCapabilityAuthorized).toBe(true);
    expect(NON_EQUIVALENCE.receiptIsNotProof).toBe(true);
    expect(
      new Set([
        PLUGIN_REGISTRY_LEDGER,
        EVOLUTION_LEDGER,
        VALIDATION_RECEIPT_LEDGER,
        EXECUTION_TRACE_LEDGER,
      ]).size,
    ).toBe(4);

    const source = {
      id: "plugin.demo",
      name: "Demo",
      enabled: true,
      status: "loaded" as const,
      source: "npm",
    };
    const identity = adaptPluginInstall(source);
    expect(identity.installed).toBe(true);
    expect(identity.capabilityAuthorized).toBe(false);
    expect(identity.selectedPath).toBeNull();
    expect(identity.sourceLedger).toBe(PLUGIN_REGISTRY_LEDGER);

    const view = projectConstitutionalViewFromSources({ pluginInstalls: [source] });
    expect(view.kind).toBe("constitutional_ledger_view");
    expect(view.writeThrough).toBe(false);
    expect(view.enforce).toBe(false);
    expect(view.liveInvoke).toBe(false);
    expect(view.sourceLedgers).toEqual([PLUGIN_REGISTRY_LEDGER]);
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
