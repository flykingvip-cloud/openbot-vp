/**
 * Group workspace file methods — gateway method pack.
 */

import { groupWorkspaceFileHandlers } from "./group-workspace-file.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = [
  "workbench.group-file.read",
  "workbench.group-file.list",
  "workbench.group-file.preview",
  "workbench.group-file.open",
  "workbench.group-manifest.read",
] as const;
const WRITE_METHODS = ["workbench.group-file.write", "workbench.group-file.patch-pptx"] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const groupWorkspaceFilePack = defineGatewayMethodPack({
  id: "group-workspace-file",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: groupWorkspaceFileHandlers,
});
