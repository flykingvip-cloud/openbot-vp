import { describe, expect, it } from "vitest";
import {
  CONSTITUTIONAL_CONTRACTS_ENFORCE,
  CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON,
  CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE,
  ConstitutionalEvidenceSchema,
  ConstitutionalIdentitySchema,
  NON_EQUIVALENCE,
  PHASE_D_FIRST_KNIFE_SCOPE,
  PLUGIN_REGISTRY_LEDGER,
  adaptCapabilityGrant,
  adaptEvolutionLedgerEvent,
  adaptPluginInstall,
  adaptValidationReceipt,
  evaluateShadowConformance,
  isConstitutionalShadowEnabled,
  projectConstitutionalViewFromSources,
  sampleSourceSnapshot,
  type PluginInstallSource,
} from "./index.js";

describe("@openbot/constitutional-contracts", () => {
  it("keeps enforce, live invoke, fabric, and the shadow flag off by default", () => {
    expect(PHASE_D_FIRST_KNIFE_SCOPE).toBe("phase_d_first_knife_contracts");
    expect(CONSTITUTIONAL_CONTRACTS_ENFORCE).toBe(false);
    expect(CONSTITUTIONAL_CONTRACTS_LIVE_INVOKE).toBe(false);
    expect(CONSTITUTIONAL_CONTRACTS_FABRIC_DEFAULT_ON).toBe(false);
    expect(NON_EQUIVALENCE).toEqual({
      workflowIsNotPath: true,
      receiptIsNotProof: true,
      pluginInstalledIsNotCapabilityAuthorized: true,
    });
    expect(isConstitutionalShadowEnabled({})).toBe(false);
    expect(isConstitutionalShadowEnabled({ OPENBOT_CONSTITUTIONAL_SHADOW: "true" })).toBe(true);
  });

  it("validates sample fixtures and rejects a receipt marked as proof", () => {
    const view = projectConstitutionalViewFromSources(sampleSourceSnapshot);
    for (const identity of view.identities) {
      expect(ConstitutionalIdentitySchema.parse(identity)).toEqual(identity);
    }
    for (const item of view.evidence) {
      expect(ConstitutionalEvidenceSchema.parse(item)).toEqual(item);
    }
    const receipt = view.evidence.find((item) => item.receiptOnly);
    expect(receipt).toBeDefined();
    const rejected = ConstitutionalEvidenceSchema.safeParse({
      ...receipt,
      grade: "proof",
      proofGrade: "verified",
    });
    expect(rejected.success).toBe(false);
  });

  it("maps a loaded plugin to installed=true without authorizing it", () => {
    const source: PluginInstallSource & { capabilityAuthorized: boolean } = {
      id: "plugin.demo",
      name: "Demo",
      enabled: true,
      status: "loaded",
      source: "npm",
      capabilityAuthorized: true,
    };
    const before = structuredClone(source);
    const identity = adaptPluginInstall(source);
    expect(source).toEqual(before);
    expect(identity.installed).toBe(true);
    expect(identity.capabilityAuthorized).toBe(false);
    expect(identity.authorizationSourceLedger).toBeNull();
    expect(identity.selectedPath).toBeNull();
    expect(identity.sourceLedger).toBe(PLUGIN_REGISTRY_LEDGER);
  });

  it("refuses a capability grant whose source ledger is the plugin registry", () => {
    expect(() =>
      adaptCapabilityGrant({
        grantId: "grant-plugin",
        capabilityId: "web_read",
        principalRef: "principal-1",
        tenantScope: null,
        status: "granted",
        sourceLedger: PLUGIN_REGISTRY_LEDGER,
      }),
    ).toThrow(/plugin registry/);
  });

  it("keeps a passed validation receipt and an applied evolution event as receipts", () => {
    const receipt = adaptValidationReceipt(sampleSourceSnapshot.validationReceipts[0]);
    expect(receipt.grade).toBe("receipt");
    expect(receipt.receiptOnly).toBe(true);
    expect(receipt.proofGrade).toBe("none");
    expect(receipt.sourceEventType).toBe("validation.passed");

    const applied = adaptEvolutionLedgerEvent(sampleSourceSnapshot.evolutionEvents[0]);
    expect(applied.grade).toBe("receipt");
    expect(applied.proofGrade).toBe("none");
    expect(applied.receiptOnly).toBe(true);

    const verified = adaptEvolutionLedgerEvent(sampleSourceSnapshot.evolutionEvents[1]);
    expect(verified.grade).toBe("proof");
    expect(verified.receiptOnly).toBe(false);
    expect(verified.proofGrade).toBe("verified");
  });

  it("rejects painting a session key as a selected path", () => {
    const parsed = ConstitutionalIdentitySchema.safeParse({
      schemaVersion: 1,
      identityId: "route-1",
      kind: "session_route",
      principalRef: "principal-1",
      tenantScope: null,
      sourceLedger: "routing",
      workflowRef: "lobster",
      selectedPath: "session-key",
      installed: null,
      capabilityAuthorized: false,
      authorizationSourceLedger: null,
      claimLevel: "unknown",
    });
    expect(parsed.success).toBe(false);
  });

  it("projects a view that keeps source ledgers distinct and does not mutate inputs", () => {
    const sources = structuredClone(sampleSourceSnapshot);
    const before = JSON.stringify(sources);
    const view = projectConstitutionalViewFromSources(sources);
    expect(JSON.stringify(sources)).toBe(before);
    expect(view.kind).toBe("constitutional_ledger_view");
    expect(view.writeThrough).toBe(false);
    expect(view.enforce).toBe(false);
    expect(view.liveInvoke).toBe(false);
    expect(view.sourceLedgers).toEqual([
      "plugin-registry",
      "capability-grants",
      "execution-preflight-validation-receipt",
      "evolution-ledger",
      "execution-preflight-trace",
    ]);
    expect(new Set(view.sourceLedgers).size).toBe(view.sourceLedgers.length);
  });

  it("returns a shadow report and leaves enforce off without mutating the view", () => {
    const view = projectConstitutionalViewFromSources(sampleSourceSnapshot);
    const before = JSON.stringify(view);
    const report = evaluateShadowConformance(view, { enforce: true });
    expect(JSON.stringify(view)).toBe(before);
    expect(report.mode).toBe("shadow");
    expect(report.enforce).toBe(false);
    expect(report.enforced).toBe(false);
    expect(report.liveInvoke).toBe(false);
    expect(report.fabricDefaultOn).toBe(false);
    expect(report.mutated).toBe(false);
    expect(report.findings.map((item) => item.code)).toEqual(["enforce_requested_ignored"]);

    const quiet = evaluateShadowConformance(view);
    expect(quiet.findings).toEqual([]);
    expect(quiet.enforce).toBe(false);
    expect(quiet.enforced).toBe(false);
    expect(JSON.stringify(view)).toBe(before);
  });
});
