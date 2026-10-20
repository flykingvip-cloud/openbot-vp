/**
 * Data governance inventory + later-wave I4 enablement evaluation.
 * Enablement evaluates gates only; it does not cut over LIVE.
 */

import { dataGovernanceHandlers } from "./data-governance.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "dataGovernance.inventory.list",
  "dataGovernance.inventory.listRecoveryRequired",
  "dataGovernance.inventory.get",
  "dataGovernance.inventory.diagnose",
  "dataGovernance.recovery.listReceipts",
  "dataGovernance.recovery.getReceipt",
] as const;

const WRITE_METHODS = ["dataGovernance.laterWave.evaluateEnablement"] as const;

export const dataGovernancePack = defineGatewayMethodPack({
  id: "data-governance",
  methods: [...READ_METHODS, ...WRITE_METHODS],
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: dataGovernanceHandlers,
});
