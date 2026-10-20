import type { EvolutionVerifierRecord, ExternalEffectVerifier } from "@openbot/evolution-core";
import { isCodeIdentityCredentialRef } from "@openbot/evolution-core";
import {
  skillInstallationReadAfterWriteVerifier,
  SKILL_INSTALLATION_RAW_VERIFIER_RECORD,
} from "./skill-installation-raw.js";
import {
  workingDnaReadAfterWriteVerifier,
  WORKING_DNA_RAW_VERIFIER_RECORD,
} from "./working-dna-raw.js";

export type FixedBuiltinVerifier = {
  record: EvolutionVerifierRecord;
  implementation: ExternalEffectVerifier;
};

export const FIXED_BUILTIN_VERIFIER_CATALOG: readonly FixedBuiltinVerifier[] = [
  {
    record: WORKING_DNA_RAW_VERIFIER_RECORD,
    implementation: workingDnaReadAfterWriteVerifier,
  },
  {
    record: SKILL_INSTALLATION_RAW_VERIFIER_RECORD,
    implementation: skillInstallationReadAfterWriteVerifier,
  },
];

export function installCatalogBuiltins(handle: {
  installFixedBuiltin(
    record: EvolutionVerifierRecord,
    implementation: ExternalEffectVerifier,
  ): unknown;
}): void {
  for (const row of FIXED_BUILTIN_VERIFIER_CATALOG) {
    handle.installFixedBuiltin(row.record, row.implementation);
  }
}

export function isCatalogBuiltinRecord(record: EvolutionVerifierRecord): boolean {
  const catalog = FIXED_BUILTIN_VERIFIER_CATALOG.find(
    (row) => row.record.verifierId === record.verifierId,
  );
  if (!catalog) {
    return false;
  }
  return (
    catalog.record.verifierKind === record.verifierKind &&
    catalog.record.credentialRef === record.credentialRef &&
    catalog.record.trustedBy === record.trustedBy &&
    isCodeIdentityCredentialRef(record.credentialRef, record.verifierId)
  );
}
