/**
 * Employee push (Wave 2) — gateway method pack.
 */

import { employeePushHandlers } from "./employee-push.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const WRITE_METHODS = [
  "employee.push.register",
  "employee.push.unregister",
  "employee.push.test",
] as const;

export const employeePushPack = defineGatewayMethodPack({
  id: "employee-push",
  methods: WRITE_METHODS,
  scopes: {
    "operator.write": WRITE_METHODS,
  },
  handlers: employeePushHandlers,
});
