/**
 * Support cases RPC — gateway method pack (daibai-super-steward / support-case chain).
 */

import { defineGatewayMethodPack } from "./pack-types.js";
import { supportCasesHandlers } from "./support-cases.js";

const READ_METHODS = ["support.cases.list", "support.cases.get"] as const;
const WRITE_METHODS = [
  "support.cases.create",
  "support.cases.resolve",
  "support.cases.close",
] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const supportCasesPack = defineGatewayMethodPack({
  id: "support-cases",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: supportCasesHandlers,
});
