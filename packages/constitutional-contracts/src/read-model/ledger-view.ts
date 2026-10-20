import {
  adaptCapabilityGrant,
  adaptDomainContract,
  adaptEvolutionLedgerEvent,
  adaptExecutionTrace,
  adaptPluginInstall,
  adaptValidationReceipt,
  type CapabilityGrantSource,
  type EvolutionLedgerSourceEvent,
  type ExecutionTraceSource,
  type PluginInstallSource,
  type ValidationReceiptSource,
} from "../adapters/index.js";
import type { ConstitutionalContract } from "../schemas/contract.js";
import { ConstitutionalContractSchema } from "../schemas/contract.js";
import type { ConstitutionalEvidence } from "../schemas/evidence.js";
import { ConstitutionalEvidenceSchema } from "../schemas/evidence.js";
import type { ConstitutionalIdentity } from "../schemas/identity.js";
import { ConstitutionalIdentitySchema } from "../schemas/identity.js";

/**
 * Read-only constitutional ledger view.
 * Source ledger ids stay distinct. Nothing here writes back to them.
 */
export type ConstitutionalLedgerView = {
  schemaVersion: 1;
  kind: "constitutional_ledger_view";
  writeThrough: false;
  enforce: false;
  liveInvoke: false;
  identities: ConstitutionalIdentity[];
  contracts: ConstitutionalContract[];
  evidence: ConstitutionalEvidence[];
  sourceLedgers: string[];
};

export type ConstitutionalSourceSnapshot = {
  evolutionEvents?: readonly EvolutionLedgerSourceEvent[];
  validationReceipts?: readonly ValidationReceiptSource[];
  executionTraces?: readonly ExecutionTraceSource[];
  pluginInstalls?: readonly PluginInstallSource[];
  capabilityGrants?: readonly CapabilityGrantSource[];
  contracts?: readonly Parameters<typeof adaptDomainContract>[0][];
};

function uniqueLedgers(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    ordered.push(id);
  }
  return ordered;
}

export function projectConstitutionalLedgerView(input: {
  identities?: readonly ConstitutionalIdentity[];
  contracts?: readonly ConstitutionalContract[];
  evidence?: readonly ConstitutionalEvidence[];
}): ConstitutionalLedgerView {
  const identities = (input.identities ?? []).map((item) =>
    ConstitutionalIdentitySchema.parse(item),
  );
  const contracts = (input.contracts ?? []).map((item) => ConstitutionalContractSchema.parse(item));
  const evidence = (input.evidence ?? []).map((item) => ConstitutionalEvidenceSchema.parse(item));
  const sourceLedgers = uniqueLedgers([
    ...identities.map((item) => item.sourceLedger),
    ...identities.flatMap((item) =>
      item.authorizationSourceLedger ? [item.authorizationSourceLedger] : [],
    ),
    ...contracts.map((item) => item.sourceLedger),
    ...evidence.map((item) => item.sourceLedger),
  ]);
  return {
    schemaVersion: 1,
    kind: "constitutional_ledger_view",
    writeThrough: false,
    enforce: false,
    liveInvoke: false,
    identities,
    contracts,
    evidence,
    sourceLedgers,
  };
}

/** Projects injected source rows into a view. Does not retain the inputs. */
export function projectConstitutionalViewFromSources(
  sources: ConstitutionalSourceSnapshot,
): ConstitutionalLedgerView {
  return projectConstitutionalLedgerView({
    identities: [
      ...(sources.pluginInstalls ?? []).map((record) => adaptPluginInstall(record)),
      ...(sources.capabilityGrants ?? []).map((grant) => adaptCapabilityGrant(grant)),
    ],
    contracts: (sources.contracts ?? []).map((contract) => adaptDomainContract(contract)),
    evidence: [
      ...(sources.evolutionEvents ?? []).map((event) => adaptEvolutionLedgerEvent(event)),
      ...(sources.validationReceipts ?? []).map((receipt) => adaptValidationReceipt(receipt)),
      ...(sources.executionTraces ?? []).map((trace) => adaptExecutionTrace(trace)),
    ],
  });
}
