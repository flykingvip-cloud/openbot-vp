import {
  installCognitiveMutationFaultHookForTests,
  type CognitiveMutationFaultHook,
} from "./cognitive-fault-slot.js";
import {
  supersedeCognitiveProvenanceRef,
  updateCognitiveGovernance,
  type CognitiveUpdateResult,
  type CognitiveWriteLockResult,
  type SupersedeCognitiveProvenanceRefParams,
  type UpdateCognitiveGovernanceParams,
} from "./cognitive-update.js";

/**
 * Test-only factory: runs the production command with a process-local fault hook,
 * then always clears the hook. Production `updateCognitiveGovernance` has no fault argument.
 */
export async function updateCognitiveGovernanceForTests(
  params: UpdateCognitiveGovernanceParams,
  fault?: CognitiveMutationFaultHook,
): Promise<CognitiveUpdateResult | CognitiveWriteLockResult> {
  installCognitiveMutationFaultHookForTests(fault);
  try {
    return await updateCognitiveGovernance(params);
  } finally {
    installCognitiveMutationFaultHookForTests(undefined);
  }
}

export async function supersedeCognitiveProvenanceRefForTests(
  params: SupersedeCognitiveProvenanceRefParams,
  fault?: CognitiveMutationFaultHook,
): Promise<CognitiveUpdateResult | CognitiveWriteLockResult> {
  installCognitiveMutationFaultHookForTests(fault);
  try {
    return await supersedeCognitiveProvenanceRef(params);
  } finally {
    installCognitiveMutationFaultHookForTests(undefined);
  }
}
