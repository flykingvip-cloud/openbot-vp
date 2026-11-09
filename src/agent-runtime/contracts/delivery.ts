export const SILENT_REPLY_TOKEN = "NO_REPLY";

/** Transport facts only. Never grants acceptance or permission to retry. */
export type CommandDeliveryReceipt = {
  deliveryId: string;
  status: "delivered" | "failed" | "delivery_unknown";
  messageIds: string[];
  error?: string;
};

/** Data needed by command delivery; excludes model, authorization and execution options. */
export type CommandDeliveryOptions = {
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  deliver?: boolean;
  bestEffortDeliver?: boolean;
  json?: boolean;
  lane?: string;
  replyChannel?: string;
  channel?: string;
  replyTo?: string;
  to?: string;
  threadId?: string | number;
  replyAccountId?: string;
  accountId?: string;
  messageChannel?: string;
  deliveryTargetMode?: "explicit" | "implicit" | "heartbeat";
  runContext?: import("./command.js").AgentRunContext;
  abortSignal?: AbortSignal;
};
