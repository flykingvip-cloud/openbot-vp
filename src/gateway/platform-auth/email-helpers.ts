import { randomUUID } from "node:crypto";
import type {
  PlatformAuthLeadNotification,
  PlatformAuthLeadNotificationType,
  PlatformAuthStore,
} from "./store-types.js";

export function enqueuePlatformAuthNotification(params: {
  store: PlatformAuthStore;
  type: PlatformAuthLeadNotificationType;
  trialApplicationId?: string;
  email?: string;
  enterpriseId?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}): PlatformAuthLeadNotification {
  const notification: PlatformAuthLeadNotification = {
    id: randomUUID(),
    type: params.type,
    ...(params.trialApplicationId ? { trialApplicationId: params.trialApplicationId } : {}),
    ...(params.email ? { email: params.email } : {}),
    ...(params.enterpriseId ? { enterpriseId: params.enterpriseId } : {}),
    payload: params.payload,
    status: "queued",
    createdAt: params.createdAt,
  };
  params.store.leadNotifications[notification.id] = notification;
  return notification;
}
