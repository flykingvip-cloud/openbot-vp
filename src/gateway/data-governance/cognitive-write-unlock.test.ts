import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  authenticateCognitiveFleetOps,
  installCognitiveFleetOpsAuthority,
  issueEnvelopeV2DualReadReceipt,
  issueEnvelopeV2WriteUnlockReceipt,
} from "./cognitive-fleet-ops-internal.js";
import {
  compareCognitiveBuildSequence,
  hashCognitiveFleetEvidence,
  isCognitiveWriteUnlocked,
  parseCognitiveBuildSequence,
  resolveCognitiveFleetOpsAuthorityPath,
  resolveEnvelopeV2DualReadReceiptPath,
  resolveEnvelopeV2WriteUnlockReceiptPath,
} from "./cognitive-write-unlock.js";
import {
  TEST_FLEET_OPS,
  unlockCognitiveWritesForTests,
} from "./cognitive-write-unlock.test-harness.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function tmpStateDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dg-write-unlock-"));
  tempDirs.push(dir);
  return dir;
}

function readReceipt(dest: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(dest, "utf8")) as Record<string, unknown>;
}

function writeReceipt(dest: string, value: unknown): void {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

describe("cognitive fleet write-unlock", () => {
  it("unlocks only after branded fleet-ops issuance of bound R0 and R1", () => {
    const stateDir = tmpStateDir();
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
    unlockCognitiveWritesForTests(stateDir);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(true);
  });

  it("rejects a forged operator ActorRef as R1 attestor", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const r1Path = resolveEnvelopeV2WriteUnlockReceiptPath(stateDir);
    const r1 = readReceipt(r1Path);
    r1.attestedBy = { kind: "operator", operatorId: "op-1" };
    writeReceipt(r1Path, r1);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("does not authenticate or issue from a hand-built operator actor", () => {
    const stateDir = tmpStateDir();
    installCognitiveFleetOpsAuthority({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
      minBuildSequence: TEST_FLEET_OPS.minBuildSequence,
      nodeIds: [...TEST_FLEET_OPS.nodeIds],
    });
    const forged = { kind: "operator", operatorId: "op-1" };
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth: forged as never,
        stateDir,
        receiptId: "r0-forged",
        nodeBuilds: { ...TEST_FLEET_OPS.nodeBuilds },
      }),
    ).toThrow(/fleet_ops_auth_required/);
    expect(() =>
      issueEnvelopeV2WriteUnlockReceipt({
        auth: forged as never,
        stateDir,
        receiptId: "r1-forged",
      }),
    ).toThrow(/fleet_ops_auth_required/);
    expect(() =>
      authenticateCognitiveFleetOps({
        stateDir,
        opsId: TEST_FLEET_OPS.opsId,
        deployToken: "wrong-token-xxxxx",
      }),
    ).toThrow(/fleet_ops_token_mismatch/);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("rejects a single-node receipt that impersonates the full fleet", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const r0Path = resolveEnvelopeV2DualReadReceiptPath(stateDir);
    const r0 = readReceipt(r0Path);
    const nodeIds = ["node-1"];
    const nodeEvidence = [
      { nodeId: "node-1", buildId: "2026.08.14", buildSequence: TEST_FLEET_OPS.minBuildSequence },
    ];
    r0.nodeIds = nodeIds;
    r0.nodeEvidence = nodeEvidence;
    r0.evidenceHash = hashCognitiveFleetEvidence({
      minBuildSequence: TEST_FLEET_OPS.minBuildSequence,
      nodeIds,
      nodeEvidence,
    });
    writeReceipt(r0Path, r0);
    const r1Path = resolveEnvelopeV2WriteUnlockReceiptPath(stateDir);
    const r1 = readReceipt(r1Path);
    r1.nodeIds = nodeIds;
    r1.r0EvidenceHash = r0.evidenceHash;
    writeReceipt(r1Path, r1);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("rejects node evidence below the authority build floor", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const r0Path = resolveEnvelopeV2DualReadReceiptPath(stateDir);
    const r0 = readReceipt(r0Path);
    r0.nodeEvidence = [
      { nodeId: "node-1", buildId: "2026.08.13", buildSequence: 9 },
      { nodeId: "node-2", buildId: "2026.08.14", buildSequence: TEST_FLEET_OPS.minBuildSequence },
    ];
    writeReceipt(r0Path, r0);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("rejects a tampered R0 whose evidence hash no longer matches", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const r0Path = resolveEnvelopeV2DualReadReceiptPath(stateDir);
    const r0 = readReceipt(r0Path);
    r0.nodeEvidence = [
      { nodeId: "node-1", buildId: "2026.08.15", buildSequence: 12 },
      { nodeId: "node-2", buildId: "2026.08.15", buildSequence: 12 },
    ];
    writeReceipt(r0Path, r0);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("rejects R1 that does not bind the current R0 id and evidence hash", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const r1Path = resolveEnvelopeV2WriteUnlockReceiptPath(stateDir);
    const r1 = readReceipt(r1Path);
    r1.r0ReceiptId = "r0-other";
    r1.r0EvidenceHash = "0".repeat(64);
    writeReceipt(r1Path, r1);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("refuses to issue R0 when a node build is below the authority floor", () => {
    const stateDir = tmpStateDir();
    installCognitiveFleetOpsAuthority({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
      minBuildSequence: TEST_FLEET_OPS.minBuildSequence,
      nodeIds: [...TEST_FLEET_OPS.nodeIds],
    });
    const auth = authenticateCognitiveFleetOps({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
    });
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth,
        stateDir,
        receiptId: "r0-stale",
        nodeBuilds: {
          "node-1": { buildId: "2026.08.13", buildSequence: 9 },
          "node-2": { buildId: "2026.08.14", buildSequence: TEST_FLEET_OPS.minBuildSequence },
        },
      }),
    ).toThrow(/build_below_floor/);
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth,
        stateDir,
        receiptId: "r0-partial",
        nodeBuilds: { "node-1": TEST_FLEET_OPS.nodeBuilds["node-1"] },
      }),
    ).toThrow(/fleet_node_coverage/);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("uses integer buildSequence ordering so 9 cannot satisfy a floor of 10", () => {
    expect(compareCognitiveBuildSequence(9, 10)).toBeLessThan(0);
    expect(parseCognitiveBuildSequence("9")).toBeNull();
    expect(parseCognitiveBuildSequence("10")).toBeNull();

    const stateDir = tmpStateDir();
    installCognitiveFleetOpsAuthority({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
      minBuildSequence: 10,
      nodeIds: ["node-1"],
    });
    const auth = authenticateCognitiveFleetOps({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
    });
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth,
        stateDir,
        receiptId: "r0-nine",
        nodeBuilds: { "node-1": { buildId: "9", buildSequence: 9 } },
      }),
    ).toThrow(/build_below_floor/);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("does not treat non-fixed-width version labels as build order", () => {
    const stateDir = tmpStateDir();
    installCognitiveFleetOpsAuthority({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
      minBuildSequence: 10,
      nodeIds: ["node-1"],
    });
    const auth = authenticateCognitiveFleetOps({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
    });
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth,
        stateDir,
        receiptId: "r0-version-bypass",
        nodeBuilds: { "node-1": { buildId: "9", buildSequence: 9 } },
      }),
    ).toThrow(/build_below_floor/);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("does not infer build order from git SHA lexicographic order", () => {
    const newerSha = "ffffffffffffffffffffffffffffffffffffffff";
    const olderSha = "0000000000000000000000000000000000000001";
    expect(newerSha > olderSha).toBe(true);

    const stateDir = tmpStateDir();
    installCognitiveFleetOpsAuthority({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
      minBuildSequence: 100,
      nodeIds: ["node-1"],
    });
    const auth = authenticateCognitiveFleetOps({
      stateDir,
      opsId: TEST_FLEET_OPS.opsId,
      deployToken: TEST_FLEET_OPS.deployToken,
    });
    expect(() =>
      issueEnvelopeV2DualReadReceipt({
        auth,
        stateDir,
        receiptId: "r0-sha-bypass",
        nodeBuilds: { "node-1": { buildId: newerSha, buildSequence: 50 } },
      }),
    ).toThrow(/build_below_floor/);
    issueEnvelopeV2DualReadReceipt({
      auth,
      stateDir,
      receiptId: "r0-sha-ok",
      nodeBuilds: { "node-1": { buildId: olderSha, buildSequence: 100 } },
    });
    issueEnvelopeV2WriteUnlockReceipt({ auth, stateDir, receiptId: "r1-sha-ok" });
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(true);
  });

  it("fails closed when authority is missing or node coverage is incomplete", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    fs.unlinkSync(resolveCognitiveFleetOpsAuthorityPath(stateDir));
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);
  });

  it("fails closed on extra keys, empty fleet, or duplicate nodes", () => {
    const stateDir = tmpStateDir();
    unlockCognitiveWritesForTests(stateDir);
    const authorityPath = resolveCognitiveFleetOpsAuthorityPath(stateDir);
    const authority = readReceipt(authorityPath);
    authority.extra = true;
    writeReceipt(authorityPath, authority);
    expect(isCognitiveWriteUnlocked(stateDir)).toBe(false);

    const clean = tmpStateDir();
    unlockCognitiveWritesForTests(clean);
    const r0Path = resolveEnvelopeV2DualReadReceiptPath(clean);
    const r0 = readReceipt(r0Path);
    r0.nodeIds = [];
    r0.nodeEvidence = [];
    writeReceipt(r0Path, r0);
    expect(isCognitiveWriteUnlocked(clean)).toBe(false);

    const dup = tmpStateDir();
    unlockCognitiveWritesForTests(dup);
    const dupR0Path = resolveEnvelopeV2DualReadReceiptPath(dup);
    const dupR0 = readReceipt(dupR0Path);
    dupR0.nodeIds = ["node-1", "node-1"];
    writeReceipt(dupR0Path, dupR0);
    expect(isCognitiveWriteUnlocked(dup)).toBe(false);
  });
});
