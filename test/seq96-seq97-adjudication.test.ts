import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const evidencePath =
  "docs/design/evidence/delivery-seq96-seq97-regression-adjudication-2026-09-24.json";
const changedPath = "docs/design/evidence/delivery-seq96-seq97-changed-files-2026-09-24.json";
const invariantsPath =
  "docs/design/evidence/delivery-seq96-seq97-capability-invariants-2026-09-24.json";
const reviewDir = ".kiro/specs/delivery-seq96-seq97-adjudication-evidence/reviews";
const acceptorReviewPath =
  ".kiro/specs/delivery-seq96-seq97-adjudication-evidence/independent-acceptor-review.md";
const tasksPath = ".kiro/specs/delivery-seq96-seq97-adjudication-evidence/tasks.md";
const closeoutPlanPath = ".kiro/specs/delivery-seq96-seq97-adjudication-evidence/closeout-plan.md";
const minutesPath = ".kiro/specs/delivery-seq96-seq97-adjudication-evidence/review-minutes.md";
const sha = /^[0-9a-f]{40}$/;
// The OHBE ledger URL is the historical pointer for the removed openbot-vp copy.
// Any other URL stays forbidden, along with secret-shaped words.
const forbidden =
  /cookie|token|secret|credential|https?:\/\/(?!github\.com\/(?:upbeyond\/openbot\.git|flykingvip-cloud\/harness-Benchmark-Engine\/blob\/main\/deploy\/production\/releases\.jsonl))/i;

type Evidence = {
  decision: string;
  ledgerMutationAuthorized: boolean;
  ancestryResult: string;
  mergeBase: string | null;
  historyRelationship: string;
  ancestryExitCodes: {
    mergeBase: number;
    seq96AncestorOfSeq97: number;
    seq97AncestorOfSeq96: number;
  };
  signatureMode: string;
  proxyReviewer: string;
  domainOwnerReviews: Array<{
    reviewer: string;
    signatureMode: string;
    decision: string;
    restorationRequired: boolean;
  }>;
  meeting: { held: boolean };
  meetingHeld: boolean;
  allRequiredOwnersSigned: boolean;
  deliveryOwnerDecision: string;
  productionProven: boolean;
  closeGateMet: boolean;
  containerLedgerAligned: boolean;
  currentContainerSha: string;
  runningContainerSha: string;
  productionDeletionCount: number;
  requiredReviewers: string[];
  completedReviewers: string[];
  seq96: { gatewaySha: string; liveFrom: string; liveTo: string; artifactDigest: string };
  seq96AncestorOfSeq97: boolean;
  seq97AncestorOfSeq96: boolean;
  seq97ParentDiagnosis: {
    repositoryShallow: boolean;
    replaceRefs: string[];
    partialClone: boolean;
    rawObjectParent: string;
    revisionWalkParents: string[];
    parentParsingExplanation: string;
    confidence: string;
  };
  seq97: { gatewaySha: string; parents: string[]; liveFrom: string; artifactDigest: string };
  productionCodeDeletions: Array<{ status: string; path: string }>;
  capabilityInvariants: Array<{ status: string; ownerDecision: string }>;
};

type ChangedFile = {
  path: string;
  status: string;
  category: string;
  addedLines: number;
  deletedLines: number;
  hasProductionDeletion: boolean;
  semanticStatus: string;
  reviewStatus: string;
};

type ChangedDoc = {
  summary: {
    changedFileCount: number;
    addedFileCount: number;
    modifiedFileCount: number;
    deletedFileCount: number;
    productionFilesWithDeletedLines: number;
    testFilesWithDeletedLines: number;
    docsFilesWithDeletedLines: number;
    ledgerFilesChanged: number;
    unreviewedProductionDeletionCount: number;
    unknownSemanticCount: number;
  };
  files: ChangedFile[];
};

type Invariants = {
  propositions: Array<{
    id: string;
    domain: string;
    statement: string;
    status: string;
    domainOwner: string;
    domainOwnerDecision: string;
    domainOwnerSignedAt: string;
  }>;
};

function exitMeansAncestor(code: number): boolean {
  return code === 0;
}

function reviewSlug(path: string): string {
  return path.replaceAll("/", "__");
}

function load(): Evidence {
  return JSON.parse(readFileSync(evidencePath, "utf8")) as Evidence;
}

describe("seq 96 to seq 97 regression adjudication", () => {
  const evidence = load();
  const changed = JSON.parse(readFileSync(changedPath, "utf8")) as ChangedDoc;
  const invariants = JSON.parse(readFileSync(invariantsPath, "utf8")) as Invariants;

  it("records the proxy meeting without authorizing the ledger", () => {
    expect(evidence.decision).toBe("insufficient_evidence");
    expect(evidence.ledgerMutationAuthorized).toBe(false);
    expect(evidence.meeting.held).toBe(true);
    expect(evidence.meetingHeld).toBe(true);
    expect(evidence.allRequiredOwnersSigned).toBe(true);
    expect(evidence.signatureMode).toBe("operator_authorized_proxy");
    expect(evidence.proxyReviewer).toBe("cursor-independent-acceptor");
    expect(evidence.domainOwnerReviews).toHaveLength(6);
    expect(evidence.completedReviewers).toEqual([
      "Delivery Owner",
      "Evolution Owner",
      "Enterprise Capability Owner",
      "Steward Owner",
      "Diagnosis Owner",
      "independent acceptor",
    ]);
    expect(evidence.requiredReviewers).toEqual(evidence.completedReviewers);
    expect(evidence.deliveryOwnerDecision).toBe("insufficient_evidence");
    for (const review of evidence.domainOwnerReviews) {
      expect(review.reviewer).toBe("cursor-independent-acceptor");
      expect(review.signatureMode).toBe("operator_authorized_proxy");
      expect(review.decision).toBe("insufficient_evidence");
      expect(review.restorationRequired).toBe(false);
    }
    expect(evidence.ancestryResult).toBe("seq96_not_ancestor_of_seq97");
    expect(evidence.mergeBase).toBeNull();
    expect(evidence.historyRelationship).toBe("unrelated_or_disconnected");
    expect(evidence.ancestryExitCodes).toEqual({
      mergeBase: 1,
      seq96AncestorOfSeq97: 1,
      seq97AncestorOfSeq96: 1,
    });
  });

  it("keeps the frozen release identities", () => {
    expect(evidence.seq96.gatewaySha).toBe("1617926868e64b3d65e1b2f37e488ba6e8fb08f0");
    expect(evidence.seq96.gatewaySha).toMatch(sha);
    expect(evidence.seq96.liveFrom).toBe("2026-09-22T07:12:37.955Z");
    expect(evidence.seq96.liveTo).toBe("2026-09-22T23:37:05.235Z");
    expect(evidence.seq96.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(evidence.seq97.gatewaySha).toBe("f1c7efece96d68375bf4b7fb57e77908fedfdd6c");
    expect(evidence.seq97.gatewaySha).toMatch(sha);
    expect(evidence.seq97.parents).toEqual([]);
    expect(evidence.seq97.liveFrom).toBe("2026-09-22T23:37:05.235Z");
    expect(evidence.seq97.artifactDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("does not treat unsigned deletions as preserved", () => {
    expect(evidence.productionDeletionCount).toBe(changed.summary.productionFilesWithDeletedLines);
    expect(evidence.productionCodeDeletions.length).toBe(evidence.productionDeletionCount);
    expect(evidence.productionDeletionCount).toBeGreaterThan(0);
    const preserved = new Set([
      "src/agents/tools/diagnose-tool.ts",
      "src/diagnosis/diagnose-tick.ts",
      "src/diagnosis/report-query-gateway.ts",
    ]);
    for (const row of evidence.productionCodeDeletions) {
      expect(row.status).toBe(preserved.has(row.path) ? "preserved" : "insufficient_evidence");
    }
    for (const capability of evidence.capabilityInvariants) {
      expect(capability.status).toBe("insufficient_evidence");
      expect(capability.ownerDecision).toBe("insufficient_evidence");
    }
    expect(invariants.propositions.length).toBeGreaterThan(0);
    for (const proposition of invariants.propositions) {
      expect(proposition.status).toBe("insufficient_evidence");
      expect(proposition.domainOwner).toContain("cursor-independent-acceptor");
      expect(proposition.domainOwnerDecision).toBe("insufficient_evidence");
      expect(proposition.domainOwnerSignedAt).toBe("2026-09-25T07:45:00Z");
    }
    expect(changed.summary.unknownSemanticCount).toBeGreaterThan(0);
  });

  it("keeps the changed-file inventory consistent with its summary", () => {
    const files = changed.files;
    expect(files.length).toBe(changed.summary.changedFileCount);
    expect(files.filter((file) => file.status === "added").length).toBe(
      changed.summary.addedFileCount,
    );
    expect(files.filter((file) => file.status === "modified").length).toBe(
      changed.summary.modifiedFileCount,
    );
    expect(files.filter((file) => file.status === "deleted").length).toBe(
      changed.summary.deletedFileCount,
    );
    const productionDeletions = files.filter((file) => file.hasProductionDeletion);
    expect(productionDeletions.length).toBe(changed.summary.productionFilesWithDeletedLines);
    expect(productionDeletions.filter((file) => file.reviewStatus === "unreviewed").length).toBe(
      changed.summary.unreviewedProductionDeletionCount,
    );
    expect(files.filter((file) => file.category === "test" && file.deletedLines > 0).length).toBe(
      changed.summary.testFilesWithDeletedLines,
    );
    expect(files.filter((file) => file.category === "docs" && file.deletedLines > 0).length).toBe(
      changed.summary.docsFilesWithDeletedLines,
    );
    expect(files.filter((file) => file.category === "ledger").length).toBe(
      changed.summary.ledgerFilesChanged,
    );
    expect(files.filter((file) => file.semanticStatus === "unknown").length).toBe(
      changed.summary.unknownSemanticCount,
    );
    const reviews = readdirSync(reviewDir).filter((name) => name.endsWith(".md"));
    expect(reviews.length).toBe(changed.summary.productionFilesWithDeletedLines);
  });

  it("does not authorize ledger mutation or production proof", () => {
    const raw = [evidencePath, changedPath, invariantsPath]
      .map((path) => readFileSync(path, "utf8"))
      .join("\n");
    expect(raw).not.toMatch(forbidden);
    expect(raw).not.toMatch(/regressionAcknowledged/);
    expect(raw).not.toMatch(/"seq"\s*:\s*98/);
    expect(raw).not.toMatch(/ledger-aligned/);
    expect(evidence.productionProven).toBe(false);
    expect(evidence.closeGateMet).toBe(false);
    expect(evidence.containerLedgerAligned).toBe(false);
    expect(evidence.currentContainerSha).not.toBe(evidence.seq97.gatewaySha);
    expect(evidence.runningContainerSha).toBe(evidence.currentContainerSha);
  });

  it("keeps ancestry booleans consistent with exit codes", () => {
    expect(evidence.seq96AncestorOfSeq97).toBe(
      exitMeansAncestor(evidence.ancestryExitCodes.seq96AncestorOfSeq97),
    );
    expect(evidence.seq97AncestorOfSeq96).toBe(
      exitMeansAncestor(evidence.ancestryExitCodes.seq97AncestorOfSeq96),
    );
    expect(evidence.mergeBase === null).toBe(evidence.ancestryExitCodes.mergeBase !== 0);
    expect(evidence.seq96AncestorOfSeq97).toBe(false);
    expect(evidence.seq97AncestorOfSeq96).toBe(false);
  });

  it("records the seq 97 parent parsing anomaly without raising the decision", () => {
    const diagnosis = evidence.seq97ParentDiagnosis;
    expect(diagnosis.repositoryShallow).toBe(true);
    expect(diagnosis.partialClone).toBe(false);
    expect(diagnosis.replaceRefs).toEqual([]);
    expect(diagnosis.rawObjectParent).toMatch(sha);
    expect(diagnosis.revisionWalkParents).toEqual([]);
    expect(diagnosis.parentParsingExplanation.length).toBeGreaterThan(0);
    expect(["high", "low"]).toContain(diagnosis.confidence);
    if (diagnosis.parentParsingExplanation === "unresolved" || diagnosis.confidence === "low") {
      expect(evidence.decision).toBe("insufficient_evidence");
    }
    expect(evidence.decision).toBe("insufficient_evidence");
  });

  it("keeps proxy signatures from authorizing a ledger change", () => {
    expect(evidence.allRequiredOwnersSigned).toBe(true);
    expect(evidence.meetingHeld).toBe(true);
    expect(evidence.completedReviewers).toHaveLength(evidence.requiredReviewers.length);
    expect(evidence.ledgerMutationAuthorized).toBe(false);
    expect(evidence.decision).toBe("insufficient_evidence");
  });

  it("matches each production deletion review to the inventory", () => {
    const productionDeletions = changed.files.filter((file) => file.hasProductionDeletion);
    expect(productionDeletions).toHaveLength(28);
    const reviews = readdirSync(reviewDir).filter((name) => name.endsWith(".md"));
    expect(reviews).toHaveLength(productionDeletions.length);
    for (const file of productionDeletions) {
      const reviewPath = `${reviewDir}/${reviewSlug(file.path)}.md`;
      const text = readFileSync(reviewPath, "utf8");
      expect(text).toContain(`文件路径：\`${file.path}\``);
      expect(text).toContain(`删除行数：${file.deletedLines}`);
      expect(text).toContain(`增加行数：${file.addedLines}`);
      expect(text).toMatch(/seq 96 blob SHA：`[0-9a-f]{40}`/);
      expect(text).toMatch(/seq 97 blob SHA：`[0-9a-f]{40}`/);
      expect(text).toContain(`当前判断：${file.semanticStatus}`);
      expect(text).toContain("operator_authorized_proxy");
    }
  });

  it("keeps capability propositions unique and unsigned", () => {
    const ids = invariants.propositions.map((proposition) => proposition.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(21);
    for (const proposition of invariants.propositions) {
      expect(proposition.domain.length).toBeGreaterThan(0);
      expect(proposition.statement.length).toBeGreaterThan(0);
      expect(proposition.status).toBe("insufficient_evidence");
      expect(proposition.domainOwnerDecision).toBe("insufficient_evidence");
    }
    expect(evidence.productionProven).toBe(false);
    expect(evidence.ledgerMutationAuthorized).toBe(false);
  });

  it("records the Codex proxy acceptance without closing the adjudication", () => {
    const review = readFileSync(acceptorReviewPath, "utf8");
    const tasks = readFileSync(tasksPath, "utf8");
    expect(review).toContain("cursor-independent-acceptor");
    expect(review).toContain("insufficient_evidence");
    expect(review).toContain("ledgerMutationAuthorized=false");
    expect(review).toContain("meetingHeld=false");
    expect(review).not.toMatch(forbidden);
    expect(tasks).toContain("- [x] Codex 独立复现 Vitest");
    expect(tasks).toContain("- [x] 独立验收人签字");
    expect(tasks).toContain("- [x] Delivery Owner 签字");
    expect(tasks).toContain("- [x] Evolution Owner 签字");
    expect(tasks).toContain("- [x] Enterprise Capability Owner 签字");
    expect(tasks).toContain("- [x] Steward Owner 签字");
    expect(tasks).toContain("- [x] Diagnosis Owner 签字");
    expect(tasks).toContain("- [x] 召开裁决会议并写入会议纪要");
    expect(evidence.decision).toBe("insufficient_evidence");
    expect(evidence.completedReviewers).toHaveLength(6);
    expect(evidence.meetingHeld).toBe(true);
    expect(evidence.ledgerMutationAuthorized).toBe(false);
  });

  it("keeps the closeout plan on insufficient evidence", () => {
    const plan = readFileSync(closeoutPlanPath, "utf8");
    const minutes = readFileSync(minutesPath, "utf8");
    expect(plan).toContain("insufficient_evidence");
    expect(plan).toContain("ledgerMutationAuthorized=false");
    expect(plan).toContain("meetingHeld=true");
    expect(plan).toContain("ledgerMutationAuthorized=false");
    expect(plan).toContain("evo-shadow-read-project");
    expect(plan).toContain("ent-default-list-selection");
    expect(plan).toContain("stw-preview-locator-path");
    expect(plan).toContain("dia-live-request-scope");
    expect(plan).not.toMatch(forbidden);
    expect(minutes).toContain("independent-acceptor-review.md");
    expect(minutes).toContain("- [x] 会议已召开");
    expect(minutes).toContain("- [x] 独立验收人已给出意见");
    expect(minutes).toContain("meetingHeld 为 true");
    expect(minutes).toContain("operator_authorized_proxy");
    expect(evidence.decision).toBe("insufficient_evidence");
    expect(evidence.ledgerMutationAuthorized).toBe(false);
    expect(evidence.meetingHeld).toBe(true);
  });
});
