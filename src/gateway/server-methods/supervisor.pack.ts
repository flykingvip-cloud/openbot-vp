/**
 * Development Supervisor — gateway method pack (development-supervisor).
 */

import { defineGatewayMethodPack } from "./pack-types.js";
import { supervisorHandlers } from "./supervisor.js";

const READ_METHODS = [
  "supervisor.task.get",
  "supervisor.task.list",
  "supervisor.task.subscribe",
  "supervisor.task.audit",
  "supervisor.template.list",
  "supervisor.worker.list",
  "supervisor.worker.health",
  "supervisor.worker.policy.list",
  "supervisor.node.list",
  "supervisor.node.bindings.list",
  "supervisor.node.bindingRequest.list",
  "supervisor.runner.status",
  "supervisor.status",
] as const;

const WRITE_METHODS = [
  "supervisor.task.create",
  "supervisor.task.abort",
  "supervisor.worker.policy.upsert",
  "supervisor.worker.policy.remove",
  "supervisor.node.bind",
  "supervisor.node.unbind",
  "supervisor.node.bindingRequest.create",
  "supervisor.node.bindingRequest.resolve",
  "supervisor.feature.set",
] as const;

const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const supervisorPack = defineGatewayMethodPack({
  id: "supervisor",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: supervisorHandlers,
});
