export type ChatAttachment = {
  id: string;
  dataUrl: string;
  mimeType: string;
  fileName?: string;
  assetId?: string;
  versionId?: string;
  contentHash?: string;
  sizeBytes?: number;
  lastModified?: number;
  status?: "reading" | "ready" | "uploading" | "sent" | "failed";
  progress?: number;
  error?: string;
  notice?: string;
  /**
   * Why a failed attachment was rejected. Only unsupported types render a
   * composer notice; read and size failures stay on the chip.
   */
  failureReason?: "unsupported";
  /** Set when the composer auto-converted a long paste into a text file. */
  source?: "paste";
};

export type ChatQueueItem = {
  id: string;
  text: string;
  createdAt: number;
  attachments?: ChatAttachment[];
  refreshSessions?: boolean;
};

export const CRON_CHANNEL_LAST = "last";

export type CronFormState = {
  name: string;
  description: string;
  agentId: string;
  sessionKey: string;
  clearAgent: boolean;
  enabled: boolean;
  deleteAfterRun: boolean;
  scheduleKind: "at" | "every" | "cron";
  scheduleAt: string;
  everyAmount: string;
  everyUnit: "minutes" | "hours" | "days";
  cronExpr: string;
  cronTz: string;
  scheduleExact: boolean;
  staggerAmount: string;
  staggerUnit: "seconds" | "minutes";
  sessionTarget: "main" | "isolated";
  wakeMode: "next-heartbeat" | "now";
  payloadKind: "systemEvent" | "agentTurn";
  payloadText: string;
  payloadModel: string;
  payloadThinking: string;
  payloadLightContext: boolean;
  deliveryMode: "none" | "announce" | "webhook";
  deliverySurfaces: Array<"workbench-agent-main" | "workbench-collab-group">;
  deliveryChannel: string;
  deliveryTo: string;
  deliveryAccountId: string;
  deliveryBestEffort: boolean;
  failureAlertMode: "inherit" | "disabled" | "custom";
  failureAlertAfter: string;
  failureAlertCooldownSeconds: string;
  failureAlertChannel: string;
  failureAlertTo: string;
  failureAlertDeliveryMode: "announce" | "webhook";
  failureAlertAccountId: string;
  timeoutSeconds: string;
};
