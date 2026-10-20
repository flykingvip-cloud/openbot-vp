/**
 * Shared compile-time gate contract.
 * P24.5 historically opened only Da Bai. P24.6 adds adapters to the
 * approved prefix. Live authority lives in production-enablement-sequence.
 */
import {
  DIAGNOSIS_DAIBAI_DELIVERY_ENABLED,
  DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED,
} from "./production-cutover.js";
import {
  assertApprovedEnablementPrefix,
  assertNoUnapprovedProductionGateOpen,
  isApprovedEnablementPrefixOpen,
  isUnapprovedProductionGateOpen,
} from "./production-enablement-sequence.js";
import { DIAGNOSIS_REPORT_API_DEPLOYED } from "./report-query-deploy.js";
import { DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED } from "./report-query-production-adapters.js";
import { DiagnosisContractError } from "./types.js";

export {
  assertApprovedEnablementPrefix,
  assertNoUnapprovedProductionGateOpen,
  isApprovedEnablementPrefixOpen,
  isUnapprovedProductionGateOpen,
};

/** P24.5 historical: companions other than Da Bai were closed then. */
export function isNonDaibaiProductionGateClosed(): boolean {
  return (
    !DIAGNOSIS_REPORT_API_DEPLOYED &&
    !DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED &&
    !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED
  );
}

export function isOnlyDaibaiProductionGateOpen(): boolean {
  return DIAGNOSIS_DAIBAI_DELIVERY_ENABLED && isNonDaibaiProductionGateClosed();
}

export function assertNonDaibaiProductionGatesClosed(path = "gates"): void {
  if (!isNonDaibaiProductionGateClosed()) {
    throw new DiagnosisContractError(
      "non_daibai_gate_open",
      "adapters, report API, and remediation gates must stay closed",
      path,
    );
  }
}

export function assertOnlyDaibaiProductionGateOpen(path = "gates"): void {
  if (!isOnlyDaibaiProductionGateOpen()) {
    throw new DiagnosisContractError(
      "gate_contract_violation",
      "only DIAGNOSIS_DAIBAI_DELIVERY_ENABLED may be true after P24.5 enablement",
      path,
    );
  }
}

/** O1.1 read-only prefix: query/get adapters only; Da Bai and remediation stay closed. */
export function isReadonlyEnablementPrefixOpen(): boolean {
  return (
    DIAGNOSIS_PRODUCTION_ADAPTERS_ENABLED &&
    DIAGNOSIS_REPORT_API_DEPLOYED &&
    !DIAGNOSIS_DAIBAI_DELIVERY_ENABLED &&
    !DIAGNOSIS_REMEDIATION_EXECUTION_ENABLED &&
    !isUnapprovedProductionGateOpen()
  );
}
