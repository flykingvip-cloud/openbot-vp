import {
  authenticateCognitiveFleetOps,
  installCognitiveFleetOpsAuthority,
  issueEnvelopeV2DualReadReceipt,
  issueEnvelopeV2WriteUnlockReceipt,
} from "./cognitive-fleet-ops-internal.js";

export const TEST_FLEET_OPS = {
  opsId: "ops-1",
  deployToken: "test-deploy-token-1",
  minBuildSequence: 10,
  nodeIds: ["node-1", "node-2"],
  nodeBuilds: {
    "node-1": { buildId: "2026.08.14", buildSequence: 10 },
    "node-2": { buildId: "2026.08.14", buildSequence: 11 },
  },
} as const;

/** Test-only fleet unlock. Production barrel does not export receipt writers. */
export function unlockCognitiveWritesForTests(stateDir: string): void {
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
  issueEnvelopeV2DualReadReceipt({
    auth,
    stateDir,
    receiptId: "r0-1",
    nodeBuilds: { ...TEST_FLEET_OPS.nodeBuilds },
  });
  issueEnvelopeV2WriteUnlockReceipt({
    auth,
    stateDir,
    receiptId: "r1-1",
  });
}
