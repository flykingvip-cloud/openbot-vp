/**
 * Chat checkpoint list — gateway method pack (chat-checkpoint-rollback).
 */

import { chatCheckpointHandlers } from "./chat-checkpoints.js";
import { defineGatewayMethodPack } from "./pack-types.js";

const METHODS = ["chat.checkpoints.list"] as const;

export const chatCheckpointsPack = defineGatewayMethodPack({
  id: "chat-checkpoints",
  methods: METHODS,
  scopes: {
    "operator.read": METHODS,
  },
  handlers: chatCheckpointHandlers,
});
