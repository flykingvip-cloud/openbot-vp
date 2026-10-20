/**
 * Daibai steward RPC — gateway method pack (daibai-super-steward).
 */

import { daibaiHandlers } from "./daibai.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const READ_METHODS = ["user.daibai.ask"] as const;
const WRITE_METHODS = ["user.daibai.execute"] as const;
const METHODS = [...READ_METHODS, ...WRITE_METHODS] as const;

export const daibaiPack = defineGatewayMethodPack({
  id: "daibai",
  methods: METHODS,
  scopes: {
    "operator.read": READ_METHODS,
    "operator.write": WRITE_METHODS,
  },
  handlers: daibaiHandlers,
});
