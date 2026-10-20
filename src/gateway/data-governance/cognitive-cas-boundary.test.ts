import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as catalogStore from "./catalog-store.js";
import * as cognitiveProvenanceStore from "./cognitive-provenance-store.js";
import * as cognitiveRecommendationAuth from "./cognitive-recommendation-auth.js";
import * as cognitiveRetrievalPolicy from "./cognitive-retrieval-policy.js";
import * as cognitiveRetrieval from "./cognitive-retrieval.js";
import * as cognitiveUpdate from "./cognitive-update.js";
import * as dataGovernanceBarrel from "./index.js";

const SRC_ROOT = path.resolve(import.meta.dirname, "../..");

const PRIVILEGED_CAS_TOKENS = [
  "compareAndPutCognitiveMutation",
  "runPrivilegedCognitiveCatalogCas",
  "attachPrivilegedCognitiveCatalogCas",
  "cognitive-cas-internal",
] as const;

const FAULT_HOOK_TOKENS = [
  "installCognitiveMutationFaultHookForTests",
  "cognitive-fault-slot",
  "cognitive-update.test-harness",
  "CognitiveMutationFaultHook",
] as const;

const ALLOWED_RELATIVE_PATHS = new Set([
  "gateway/data-governance/cognitive-cas-internal.ts",
  "gateway/data-governance/catalog-store.ts",
  "gateway/data-governance/cognitive-update.ts",
  "gateway/data-governance/cognitive-merge-fencing.ts",
  "gateway/data-governance/cognitive-cas-boundary.test.ts",
]);

const FAULT_HOOK_ALLOWED_RELATIVE_PATHS = new Set([
  "gateway/data-governance/cognitive-fault-slot.ts",
  "gateway/data-governance/cognitive-update.ts",
  "gateway/data-governance/cognitive-update.test-harness.ts",
  "gateway/data-governance/cognitive-p3a-r1.test.ts",
  "gateway/data-governance/cognitive-p3d.test.ts",
  "gateway/data-governance/cognitive-cas-boundary.test.ts",
]);

const POLICY_EVALUATOR_INSTALL_TOKENS = [
  "installRetrievalPolicyEvaluatorForTests",
  "decideConstrainedRetrievalForTests",
  "cognitive-retrieval.test-harness",
  "installedEvaluator",
] as const;

const CALL_MINT_TOKENS = ["mintGovernanceAuthenticatedCallForTests"] as const;

const PROVENANCE_CREATE_TOKENS = [
  "createCognitiveProvenanceBindingUnique",
  "cognitive-provenance-internal",
] as const;

const PROVENANCE_CREATE_ALLOWED_RELATIVE_PATHS = new Set([
  "gateway/data-governance/cognitive-provenance-internal.ts",
  "gateway/data-governance/cognitive-update.ts",
  "gateway/data-governance/cognitive-cas-boundary.test.ts",
  "gateway/data-governance/cognitive-p3d.test.ts",
]);

const FLEET_OPS_ISSUE_TOKENS = [
  "writeEnvelopeV2DualReadReceipt",
  "writeEnvelopeV2WriteUnlockReceipt",
  "issueEnvelopeV2DualReadReceipt",
  "issueEnvelopeV2WriteUnlockReceipt",
  "authenticateCognitiveFleetOps",
  "installCognitiveFleetOpsAuthority",
  "cognitive-fleet-ops-internal",
] as const;

const FLEET_OPS_ISSUE_ALLOWED_RELATIVE_PATHS = new Set([
  "gateway/data-governance/cognitive-fleet-ops-internal.ts",
  "gateway/data-governance/cognitive-write-unlock.test-harness.ts",
  "gateway/data-governance/cognitive-write-unlock.test.ts",
  "gateway/data-governance/cognitive-cas-boundary.test.ts",
]);

function walkTsFiles(dir: string, acc: string[]): void {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === "node_modules" || ent.name === "dist") {
      continue;
    }
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkTsFiles(full, acc);
      continue;
    }
    if (ent.name.endsWith(".ts") || ent.name.endsWith(".tsx") || ent.name.endsWith(".mts")) {
      acc.push(full);
    }
  }
}

describe("P3-a privileged cognitive CAS source boundary", () => {
  it("does not export privileged CAS from catalog-store, command module, or barrel", () => {
    expect("compareAndPutCognitiveMutation" in catalogStore).toBe(false);
    expect("runPrivilegedCognitiveCatalogCas" in catalogStore).toBe(false);
    expect("attachPrivilegedCognitiveCatalogCas" in catalogStore).toBe(false);
    expect("compareAndPutCognitiveMutation" in cognitiveUpdate).toBe(false);
    expect("runPrivilegedCognitiveCatalogCas" in cognitiveUpdate).toBe(false);
    expect("attachPrivilegedCognitiveCatalogCas" in cognitiveUpdate).toBe(false);
    expect("compareAndPutCognitiveMutation" in dataGovernanceBarrel).toBe(false);
    expect("runPrivilegedCognitiveCatalogCas" in dataGovernanceBarrel).toBe(false);
    expect("attachPrivilegedCognitiveCatalogCas" in dataGovernanceBarrel).toBe(false);
    expect("applyPreparedCognitiveMutationCas" in dataGovernanceBarrel).toBe(false);
    expect("CognitiveMutationFaultHook" in cognitiveUpdate).toBe(false);
    expect("installCognitiveMutationFaultHookForTests" in cognitiveUpdate).toBe(false);
    expect("CognitiveMutationFaultHook" in dataGovernanceBarrel).toBe(false);
    expect("installCognitiveMutationFaultHookForTests" in dataGovernanceBarrel).toBe(false);
    expect("updateCognitiveGovernanceForTests" in dataGovernanceBarrel).toBe(false);
    expect("createCognitiveRecommendationAuth" in dataGovernanceBarrel).toBe(false);
    expect("CognitiveRecommendationSession" in dataGovernanceBarrel).toBe(false);
    expect("mintGovernanceAuthenticatedCallForTests" in dataGovernanceBarrel).toBe(false);
    expect("mintGovernanceAuthenticatedCallForTests" in cognitiveRecommendationAuth).toBe(false);
    expect("installRetrievalPolicyEvaluatorForTests" in dataGovernanceBarrel).toBe(false);
    expect("decideConstrainedRetrievalForTests" in dataGovernanceBarrel).toBe(false);
    expect("getRetrievalPolicyEvaluator" in dataGovernanceBarrel).toBe(false);
    expect("installRetrievalPolicyEvaluatorForTests" in cognitiveRetrieval).toBe(false);
    expect("decideConstrainedRetrievalForTests" in cognitiveRetrieval).toBe(false);
    expect("getRetrievalPolicyEvaluator" in cognitiveRetrieval).toBe(false);
    expect("installRetrievalPolicyEvaluatorForTests" in cognitiveRetrievalPolicy).toBe(false);
    expect(cognitiveRetrievalPolicy.getRetrievalPolicyEvaluator()).toBeUndefined();
    expect(cognitiveRetrieval.decideConstrainedRetrieval.length).toBe(1);
    expect("issueCognitiveRecommendationDelegation" in dataGovernanceBarrel).toBe(false);
    expect("putCognitiveRecommendationMembership" in dataGovernanceBarrel).toBe(false);
    expect("putCognitiveRecommendationOwnershipBinding" in dataGovernanceBarrel).toBe(false);
    expect("putCognitiveRecommendationDelegationReceipt" in dataGovernanceBarrel).toBe(false);
    expect(cognitiveUpdate.updateCognitiveGovernance.length).toBe(1);
    expect("createCognitiveProvenanceBindingUnique" in catalogStore).toBe(false);
    expect("createCognitiveProvenanceBindingUnique" in cognitiveProvenanceStore).toBe(false);
    expect("createCognitiveProvenanceBindingUnique" in cognitiveUpdate).toBe(false);
    expect("createCognitiveProvenanceBindingUnique" in dataGovernanceBarrel).toBe(false);
    expect("writeEnvelopeV2DualReadReceipt" in dataGovernanceBarrel).toBe(false);
    expect("writeEnvelopeV2WriteUnlockReceipt" in dataGovernanceBarrel).toBe(false);
    expect("issueEnvelopeV2DualReadReceipt" in dataGovernanceBarrel).toBe(false);
    expect("issueEnvelopeV2WriteUnlockReceipt" in dataGovernanceBarrel).toBe(false);
    expect("authenticateCognitiveFleetOps" in dataGovernanceBarrel).toBe(false);
    expect("installCognitiveFleetOpsAuthority" in dataGovernanceBarrel).toBe(false);
    expect("isCognitiveWriteUnlocked" in dataGovernanceBarrel).toBe(true);
    expect("installCognitiveMergeFaultHookForTests" in dataGovernanceBarrel).toBe(false);
    expect("writeGovernanceApprovalGrantAtDeployBoundary" in dataGovernanceBarrel).toBe(false);
    expect("runPrivilegedCognitiveCatalogCreate" in dataGovernanceBarrel).toBe(false);
    expect("acquireMergeReservation" in dataGovernanceBarrel).toBe(false);
    expect("releaseMergeReservation" in dataGovernanceBarrel).toBe(false);
    expect("renewMergeReservation" in dataGovernanceBarrel).toBe(false);
    expect("runConflictGraphTakeover" in dataGovernanceBarrel).toBe(false);
    expect("recoverCognitiveMerge" in dataGovernanceBarrel).toBe(false);
    expect("reclaimMergeOrphans" in dataGovernanceBarrel).toBe(false);
    expect("reclaimManifestPointerOrphans" in dataGovernanceBarrel).toBe(false);
    expect("reclaimAnchorPointerOrphans" in dataGovernanceBarrel).toBe(false);
    expect("uniqueCreateAgentAssetManifest" in dataGovernanceBarrel).toBe(false);
    expect("compareAndPutManifestPointer" in dataGovernanceBarrel).toBe(false);
    expect("uniqueCreateHumanVerifiedAnchor" in dataGovernanceBarrel).toBe(false);
    expect("compareAndPutAnchorPointer" in dataGovernanceBarrel).toBe(false);
    expect("withManifestOperation" in dataGovernanceBarrel).toBe(false);
    expect("withAnchorOperation" in dataGovernanceBarrel).toBe(false);
    expect("bindUserProposalSubject" in dataGovernanceBarrel).toBe(false);
    expect("bindApprovalSubject" in dataGovernanceBarrel).toBe(false);
    expect("runPinnedCognitiveThresholds" in dataGovernanceBarrel).toBe(false);
    expect("detectAndRecordCognitiveConflict" in dataGovernanceBarrel).toBe(false);
    expect("classifyCognitiveClaimPair" in dataGovernanceBarrel).toBe(false);
    expect("decideShadowPromotion" in dataGovernanceBarrel).toBe(false);
    expect("shadowPromotionAllows" in dataGovernanceBarrel).toBe(false);
    expect("prepareCognitivePromotionApply" in dataGovernanceBarrel).toBe(true);
    expect("getCognitivePromotionReceipt" in dataGovernanceBarrel).toBe(true);
    expect("uniqueCreatePreparedPromotionReceipt" in dataGovernanceBarrel).toBe(false);
    expect("markGovernanceApprovalGrantConsumed" in dataGovernanceBarrel).toBe(false);
    expect("compareAndConsumeGovernanceApprovalGrantUnlocked" in dataGovernanceBarrel).toBe(false);
    expect("installCognitiveTakeoverFenceHookForTests" in dataGovernanceBarrel).toBe(false);
    expect("isMergeReservationHolder" in dataGovernanceBarrel).toBe(false);
    expect("markReservationDerivedCreated" in dataGovernanceBarrel).toBe(false);
    expect("readConflictGraphHead" in dataGovernanceBarrel).toBe(true);
  });

  it("forbids privileged cognitive CAS references outside the governance command boundary", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      const source = fs.readFileSync(file, "utf8");
      const hits = PRIVILEGED_CAS_TOKENS.filter((token) => source.includes(token));
      if (hits.length === 0) {
        continue;
      }
      if (!ALLOWED_RELATIVE_PATHS.has(rel)) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps fault-hook installation out of production command modules except the slot", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      const source = fs.readFileSync(file, "utf8");
      const hits = FAULT_HOOK_TOKENS.filter((token) => source.includes(token));
      if (hits.length === 0) {
        continue;
      }
      if (!FAULT_HOOK_ALLOWED_RELATIVE_PATHS.has(rel)) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forbids retrieval policy evaluator installation in every non-test production file", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) {
        continue;
      }
      const source = fs.readFileSync(file, "utf8");
      const hits = POLICY_EVALUATOR_INSTALL_TOKENS.filter((token) => source.includes(token));
      if (hits.length > 0) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forbids provenance binding create outside the supersede command boundary", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      const source = fs.readFileSync(file, "utf8");
      const hits = PROVENANCE_CREATE_TOKENS.filter((token) => source.includes(token));
      if (hits.length === 0) {
        continue;
      }
      if (!PROVENANCE_CREATE_ALLOWED_RELATIVE_PATHS.has(rel)) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forbids fleet receipt issuance outside the deploy-ops boundary", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      const source = fs.readFileSync(file, "utf8");
      const hits = FLEET_OPS_ISSUE_TOKENS.filter((token) => source.includes(token));
      if (hits.length === 0) {
        continue;
      }
      if (!FLEET_OPS_ISSUE_ALLOWED_RELATIVE_PATHS.has(rel)) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("forbids test call minting in every non-test production file", () => {
    const files: string[] = [];
    walkTsFiles(SRC_ROOT, files);
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC_ROOT, file).split(path.sep).join("/");
      if (rel.endsWith(".test.ts") || rel.endsWith(".test.tsx")) {
        continue;
      }
      const source = fs.readFileSync(file, "utf8");
      const hits = CALL_MINT_TOKENS.filter((token) => source.includes(token));
      if (hits.length > 0) {
        offenders.push(`${rel}: ${hits.join(", ")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
