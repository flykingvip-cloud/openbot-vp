/**
 * DingTalk Channel — Core Types
 *
 * Based on the DingTalk Open Platform API:
 * - Stream mode (WebSocket-based, recommended)
 * - HTTP callback mode (webhook)
 */

export type DingtalkConnectionMode = "stream" | "webhook";

export type DingtalkAccountConfig = {
  enabled?: boolean;
  name?: string;
  clientId: string;
  clientSecret?: string;
  connectionMode?: DingtalkConnectionMode;
  robotCode?: string;
  webhookPath?: string;
  webhookUrl?: string;
  defaultTo?: string;
  cooldownId?: string;
  dm?: {
    policy?: "open" | "pairing" | "allowlist";
    allowFrom?: string[];
  };
  textChunkLimit?: number;
};

export type ResolvedDingtalkAccount = {
  accountId: string;
  name: string | null;
  enabled: boolean;
  configured: boolean;
  config: DingtalkAccountConfig;
  clientId: string;
  clientSecret: string;
  connectionMode: DingtalkConnectionMode;
  robotCode: string | null;
};

export type DingtalkInboundMessage = {
  msgtype: string;
  text?: { content: string };
  msgId: string;
  createAt: string;
  conversationType: "1" | "2"; // 1=单聊, 2=群聊
  conversationId: string;
  senderId: string;
  senderNick: string;
  chatbotCorpId?: string;
  chatbotUserId?: string;
  atUsers?: Array<{ dingtalkId: string; staffId?: string }>;
  isInAtList?: boolean;
  sessionWebhook?: string;
  sessionWebhookExpiredTime?: number;
};

export type DingtalkStreamEvent = {
  specVersion: string;
  type: string;
  headers: Record<string, string>;
  data: string;
};
