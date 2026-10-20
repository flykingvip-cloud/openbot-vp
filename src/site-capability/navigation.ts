/**
 * SAR navigation goes through the existing browser navigation guard.
 * Adapters cannot pass a skip flag or their own SSRF policy.
 */

import {
  assertBrowserNavigationAllowed,
  type BrowserNavigationPolicyOptions,
} from "../browser/navigation-guard.js";
import type { LookupFn } from "../infra/net/ssrf.js";
import { SAR_DENIAL_CODE, sarDeny, type SarDenial } from "./codes.js";

export async function assertSarNavigationAllowed(params: {
  url: string;
  allowedOrigins: readonly string[];
  policy?: BrowserNavigationPolicyOptions;
  lookupFn?: LookupFn;
}): Promise<{ ok: true } | SarDenial> {
  try {
    await assertBrowserNavigationAllowed({
      url: params.url,
      lookupFn: params.lookupFn,
      ssrfPolicy: params.policy?.ssrfPolicy,
      allowAccountComputerDesktopPage: false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "navigation blocked";
    return sarDeny(SAR_DENIAL_CODE.policyDenied, message);
  }
  let parsed: URL;
  try {
    parsed = new URL(params.url);
  } catch {
    return sarDeny(SAR_DENIAL_CODE.policyDenied, "navigation url is invalid");
  }
  if (!params.allowedOrigins.includes(parsed.origin)) {
    return sarDeny(
      SAR_DENIAL_CODE.policyDenied,
      `origin ${parsed.origin} is outside the capability allowlist`,
    );
  }
  return { ok: true };
}
