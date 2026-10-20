/**
 * Sandbox / 内部 webhook 签名校验（HMAC-SHA256）。
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export function signCommercePayload(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

export function verifyCommerceSignature(
  secret: string,
  payload: string,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !signatureHeader?.trim()) {
    return false;
  }
  const expected = signCommercePayload(secret, payload);
  const provided = signatureHeader.trim();
  if (expected.length !== provided.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
}

/** Stripe webhook 签名（t=...,v1=...）。 */
export function verifyStripeWebhookSignature(
  secret: string,
  rawBody: string,
  signatureHeader: string | undefined,
  toleranceSec = 300,
): boolean {
  if (!secret || !signatureHeader?.trim()) {
    return false;
  }
  const parts = signatureHeader.split(",").map((part) => part.trim());
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === "t") {
      timestamp = value;
    } else if (key === "v1" && value) {
      signatures.push(value);
    }
  }
  if (!timestamp || signatures.length === 0) {
    return false;
  }
  const ts = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(ts)) {
    return false;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > toleranceSec) {
    return false;
  }
  const signedPayload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return signatures.some((sig) => {
    if (sig.length !== expected.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  });
}
