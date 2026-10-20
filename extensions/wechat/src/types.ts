/**
 * WeChat Channel — Core Types
 *
 * Based on the proxy-based WeChat integration pattern:
 * - Proxy service handles WeChat protocol (iPad/Mac protocol)
 * - Gateway communicates with proxy via API + webhook
 * - QR code login flow for authentication
 */

export type WechatDeviceType = "ipad" | "mac";

export type WechatAccountConfig = {
  enabled?: boolean;
  name?: string;
  apiKey: string;
  proxyUrl: string;
  webhookHost?: string;
  webhookPort?: number;
  webhookPath?: string;
  deviceType?: WechatDeviceType;
  defaultTo?: string;
  dm?: {
    policy?: "open" | "pairing" | "allowlist";
    allowFrom?: string[];
  };
  textChunkLimit?: number;
};

export type ResolvedWechatAccount = {
  accountId: string;
  name: string | null;
  enabled: boolean;
  configured: boolean;
  config: WechatAccountConfig;
  apiKey: string;
  proxyUrl: string;
  webhookHost: string | null;
  webhookPort: number;
  webhookPath: string;
  deviceType: WechatDeviceType;
};

export type WechatInboundMessage = {
  msgType: "text" | "image" | "file" | "voice" | "video";
  content?: string;
  fromUser: string;
  fromUserNick?: string;
  toUser: string;
  isGroup: boolean;
  groupId?: string;
  groupName?: string;
  msgId: string;
  timestamp: number;
  fileUrl?: string;
};

export type WechatLoginStatus = {
  status: "logged_out" | "qr_pending" | "scanning" | "confirming" | "logged_in";
  qrCodeUrl?: string;
  wxid?: string;
  nickname?: string;
};
