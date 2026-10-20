import type { PaymentProvider } from "../types.js";
import { alipayPaymentAdapter } from "./alipay.js";
import { stripePaymentAdapter } from "./stripe.js";
import type { PaymentProviderAdapter } from "./types.js";

const ADAPTERS: Record<"stripe" | "alipay", PaymentProviderAdapter> = {
  stripe: stripePaymentAdapter,
  alipay: alipayPaymentAdapter,
};

export function getOnlinePaymentAdapter(provider: PaymentProvider): PaymentProviderAdapter | null {
  if (provider === "stripe" || provider === "alipay") {
    return ADAPTERS[provider];
  }
  return null;
}

export function isOnlinePaymentProvider(
  provider: PaymentProvider,
): provider is "stripe" | "alipay" {
  return provider === "stripe" || provider === "alipay";
}
