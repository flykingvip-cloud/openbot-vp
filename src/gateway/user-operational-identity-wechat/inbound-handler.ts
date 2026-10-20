type WechatInboundLog = { warn: (message: string) => void };

export type WechatPersonalInboundHandler = (params: {
  payloadJSON?: string | null;
  payload?: unknown;
  accountId?: string;
  log?: WechatInboundLog;
}) => Promise<{ handled: boolean; reason?: string }>;

let handler: WechatPersonalInboundHandler | null = null;

export function setWechatPersonalInboundHandler(next: WechatPersonalInboundHandler | null): void {
  handler = next;
}

export function getWechatPersonalInboundHandler(): WechatPersonalInboundHandler | null {
  return handler;
}
