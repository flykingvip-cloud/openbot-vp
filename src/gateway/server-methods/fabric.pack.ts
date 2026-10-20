/**
 * OpenBot Fabric control plane — gateway method pack (openbot-fabric).
 */

import { fabricHandlers } from "./fabric.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "fabric.policy.check",
  "fabric.tool.stream",
  "fabric.audit.query",
  "fabric.status",
] as const;

const WRITE_METHODS = [
  "fabric.tool.execute",
  "fabric.adapter.register",
  "fabric.feature.set",
] as const;

const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const fabricPack = defineGatewayMethodPack({
  id: "fabric",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: fabricHandlers,
});
