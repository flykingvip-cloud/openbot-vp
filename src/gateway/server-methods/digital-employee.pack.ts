/**
 * Digital employee design + instantiate — gateway method pack.
 */

import { digitalEmployeeHandlers } from "../../digital-employee-creation/gateway-handlers.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const WRITE_METHODS = [
  "digitalEmployee.design.compile",
  "digitalEmployee.design.revise",
  "digitalEmployee.design.confirm",
  "digitalEmployee.design.abort",
] as const;
const ADMIN_METHODS = ["digitalEmployee.design.instantiate"] as const;
const METHODS = [...WRITE_METHODS, ...ADMIN_METHODS] as const;

export const digitalEmployeePack = defineGatewayMethodPack({
  id: "digital-employee",
  methods: METHODS,
  scopes: {
    "operator.write": WRITE_METHODS,
    "operator.admin": ADMIN_METHODS,
  },
  handlers: digitalEmployeeHandlers,
});
