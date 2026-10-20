import { evolutionDelegationHandlers } from "./evolution-delegation.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = ["evolution.delegation.get"] as const;
const WRITE_METHODS = ["evolution.delegation.request", "evolution.delegation.approve"] as const;

export const EVOLUTION_DELEGATION_METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const evolutionDelegationPack = defineGatewayMethodPack({
  id: "evolution-delegation",
  methods: EVOLUTION_DELEGATION_METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.approvals": WRITE_METHODS,
  },
  handlers: evolutionDelegationHandlers,
});
