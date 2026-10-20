import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runRuntimeFacadeShadow as runFromContracts } from "@openbot/constitutional-contracts";
import { describe, expect, it } from "vitest";
import {
  CONSTITUTIONAL_CONTRACTS_ENFORCE,
  CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON,
  CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE,
  PHASE_D_RUNTIME_FACADE_SCOPE,
  RUNTIME_SCAFFOLD_BOUNDARY,
  runRuntimeFacadeShadow,
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

describe("@openbot/constitutional-runtime scaffold", () => {
  it("re-exports the default-off façade without forking it", () => {
    expect(runRuntimeFacadeShadow).toBe(runFromContracts);
    expect(PHASE_D_RUNTIME_FACADE_SCOPE).toBe("phase_d_runtime_facade_shadow_only");
    expect(CONSTITUTIONAL_CONTRACTS_ENFORCE).toBe(false);
    expect(CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE).toBe(false);
    expect(CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON).toBe(false);
  });

  it("stays inert by default and stays report-only when shadow is opted in", () => {
    expect(RUNTIME_SCAFFOLD_BOUNDARY).toMatchObject({
      scope: "phase_d_product_split_scaffold",
      product: "runtime",
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
      fifthExecutionStory: false,
      crossDomainWriter: false,
    });

    const inert = runRuntimeFacadeShadow();
    expect(inert.mode).toBe("inert");
    expect(inert.invoked).toBe(false);
    expect(inert.report).toBeNull();
    expect(inert.selectedPath).toBeNull();
    expect(inert.executed).toBe(false);
    expect(inert.enforce).toBe(false);
    expect(inert.liveInvoke).toBe(false);
    expect(inert.fabricDefaultOn).toBe(false);

    const shadow = runRuntimeFacadeShadow(
      {},
      { shadow: true, enforce: true, candidatePath: "painted", workflowRef: "lobster" },
    );
    expect(shadow.mode).toBe("shadow");
    expect(shadow.invoked).toBe(true);
    expect(shadow.selectedPath).toBeNull();
    expect(shadow.candidatePathDiscarded).toBe(true);
    expect(shadow.legalPathSelectable).toBe(false);
    expect(shadow.readyToTighten).toBe(false);
    expect(shadow.executed).toBe(false);
    expect(shadow.blocked).toBe(false);
    expect(shadow.wroteLedger).toBe(false);
    expect(shadow.enforce).toBe(false);
    expect(shadow.enforced).toBe(false);
    expect(shadow.liveInvoke).toBe(false);
    expect(shadow.fabricDefaultOn).toBe(false);
    expect(shadow.report?.enforce).toBe(false);
    expect(shadow.report?.enforced).toBe(false);
    expect(shadow.report?.liveInvoke).toBe(false);
    expect(shadow.report?.fabricDefaultOn).toBe(false);
  });

  it("is not imported from gateway chat, tool invoke, ACP, AOR, or dispatch", () => {
    const srcRoot = fileURLToPath(new URL("../../../src", import.meta.url));
    const hits = listRepoSourceFiles(srcRoot).filter((file) => {
      const text = readFileSync(file, "utf8");
      return PACKAGE_SPECIFIERS.some((specifier) => text.includes(specifier));
    });
    expect(hits).toEqual([]);
  });
});
