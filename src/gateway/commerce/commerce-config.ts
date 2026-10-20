/** 商业层运行时开关（测试 / 迁移兼容）。 */

export type CommercePaymentMode = "sandbox" | "live";

export type CommercePaymentConfig = {
  mode: CommercePaymentMode;
  gatewayPublicBaseUrl: string;
  sandboxWebhookSecret: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  alipayAppId?: string;
  alipayWebhookSecret?: string;
};

export function isCommerceLegacyBypassEnabled(): boolean {
  const raw = process.env.OPENBOT_COMMERCE_LEGACY_BYPASS?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function readPaymentMode(): CommercePaymentMode {
  const raw = process.env.OPENBOT_COMMERCE_PAYMENT_MODE?.trim().toLowerCase();
  return raw === "live" ? "live" : "sandbox";
}

/** 在线支付配置（sandbox / live 分离，R9.3）。 */
export function resolveCommercePaymentConfig(): CommercePaymentConfig {
  const port = process.env.OPENBOT_GATEWAY_PORT?.trim() || "18789";
  const defaultBase = `http://127.0.0.1:${port}`;
  const gatewayPublicBaseUrl =
    process.env.OPENBOT_COMMERCE_GATEWAY_PUBLIC_URL?.trim() ||
    process.env.OPENBOT_GATEWAY_PUBLIC_URL?.trim() ||
    defaultBase;
  const sandboxWebhookSecret =
    process.env.OPENBOT_COMMERCE_SANDBOX_WEBHOOK_SECRET?.trim() || "openbot-commerce-sandbox-dev";
  return {
    mode: readPaymentMode(),
    gatewayPublicBaseUrl: gatewayPublicBaseUrl.replace(/\/+$/, ""),
    sandboxWebhookSecret,
    ...(process.env.OPENBOT_COMMERCE_STRIPE_SECRET_KEY?.trim()
      ? { stripeSecretKey: process.env.OPENBOT_COMMERCE_STRIPE_SECRET_KEY.trim() }
      : {}),
    ...(process.env.OPENBOT_COMMERCE_STRIPE_WEBHOOK_SECRET?.trim()
      ? { stripeWebhookSecret: process.env.OPENBOT_COMMERCE_STRIPE_WEBHOOK_SECRET.trim() }
      : {}),
    ...(process.env.OPENBOT_COMMERCE_ALIPAY_APP_ID?.trim()
      ? { alipayAppId: process.env.OPENBOT_COMMERCE_ALIPAY_APP_ID.trim() }
      : {}),
    ...(process.env.OPENBOT_COMMERCE_ALIPAY_WEBHOOK_SECRET?.trim()
      ? { alipayWebhookSecret: process.env.OPENBOT_COMMERCE_ALIPAY_WEBHOOK_SECRET.trim() }
      : {}),
  };
}

/** 对公转账指引（占位，运营可后续改为配置项）。 */
export const BANK_TRANSFER_INSTRUCTIONS = {
  accountName: "OpenBot Technology Co., Ltd.",
  bankName: "示例银行股份有限公司",
  accountNumber: "6222 **** **** 1234",
  remarkHint: "请在备注中填写订单号 ord-xxx",
};
