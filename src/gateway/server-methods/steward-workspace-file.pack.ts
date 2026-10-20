/**
 * Steward workspace file methods — gateway method pack (daibai-super-steward).
 */

import { defineGatewayMethodPack } from "./pack-types.js";
import { stewardWorkspaceFileHandlers } from "./steward-workspace-file.js";

const READ_METHODS = [
  "workbench.steward-file.read",
  "workbench.steward-file.preview",
  "workbench.steward-file.open",
] as const;
const WRITE_METHODS = [
  "workbench.steward-file.write",
  "workbench.steward-file.patch-pptx",
] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const stewardWorkspaceFilePack = defineGatewayMethodPack({
  id: "steward-workspace-file",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: stewardWorkspaceFileHandlers,
});
