/** Transport facts only. Never grants acceptance or permission to retry. */
export type CommandDeliveryReceipt = {
  deliveryId: string;
  status: "delivered" | "failed" | "delivery_unknown";
  messageIds: string[];
  error?: string;
};
