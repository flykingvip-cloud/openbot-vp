export type WecomDmPolicy = "open" | "pairing" | "allowlist";

/** callback = classic corp-app webhook; websocket = AIBot long connection. */
export type WecomConnectionMode = "callback" | "websocket";

export type WecomDmConfig = {
  enabled?: boolean;
  policy?: WecomDmPolicy;
  allowFrom?: Array<string | number>;
};

export type WecomAccountConfig = {
  enabled?: boolean;
  name?: string;
  /** Transport: callback (default/legacy) or websocket (AIBot long connection). */
  connectionMode?: WecomConnectionMode;
  /** AIBot Bot ID (websocket mode). */
  botId?: string;
  corpId?: string;
  agentId?: string | number;
  /** App secret (callback) or AIBot long-connection secret (websocket). */
  secret?: string;
  token?: string;
  encodingAesKey?: string;
  webhookPath?: string;
  webhookUrl?: string;
  defaultTo?: string;
  dm?: WecomDmConfig;
  textChunkLimit?: number;
};

export type WecomConfig = WecomAccountConfig & {
  defaultAccount?: string;
  accounts?: Record<string, WecomAccountConfig | undefined>;
};

export type ResolvedWecomAccount = {
  accountId: string;
  name?: string;
  enabled: boolean;
  config: WecomAccountConfig;
  connectionMode: WecomConnectionMode;
  botId?: string;
  corpId?: string;
  agentId?: number;
  secret?: string;
  token?: string;
  encodingAesKey?: string;
  configured: boolean;
};

export type WecomTokenResponse = {
  access_token: string;
  expires_in: number;
};

export type WecomSendMessageResponse = {
  errcode: number;
  errmsg: string;
  msgid?: string;
  invaliduser?: string;
};

export type WecomProbeResult =
  | { ok: true; elapsedMs: number }
  | { ok: false; elapsedMs: number; error: string };
