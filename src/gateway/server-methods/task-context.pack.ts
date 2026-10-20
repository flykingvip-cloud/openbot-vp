import { defineGatewayMethodPack } from "./pack-types.js";
import { taskContextHandlers } from "./task-context.js";

const READ_METHODS = ["tasks.list", "tasks.getSummary"] as const;
const WRITE_METHODS = ["tasks.create", "tasks.update", "tasks.bindSession"] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const taskContextPack = defineGatewayMethodPack({
  id: "task-context",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: taskContextHandlers,
});
