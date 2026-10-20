/**
 * CDP page probe for handoff gate clearance (QR/SMS auto-resume).
 * Never reads or returns field values / secrets.
 *
 * After gateway restart, in-memory CDP maps may be empty; resolveAccountBrowserCdpUrl
 * rediscovers the Account Worker published port so await_return can still fire
 * auto_gate_cleared (retry each poll — never fail-closed forever).
 */
import { getPageForTargetId } from "../../browser/pw-session.js";
import { resolveAccountBrowserCdpUrl } from "./account-cdp-resolve.js";
import type { HandoffGateDomSnapshot, HandoffGatePageProbe } from "./secure-form-handoff-gate.js";

/** Injectable for tests — defaults to live account CDP. */
let probeOverride: HandoffGatePageProbe | null = null;

export function setHandoffGateProbeForTests(probe: HandoffGatePageProbe | null) {
  probeOverride = probe;
}

/** Selectors that indicate a signed-in account chrome (Zhihu AppHeader, generic avatars). */
export const HANDOFF_SIGNED_IN_CHROME_SELECTOR = [
  '[data-testid="user-avatar"]',
  ".user-avatar",
  ".AppHeader-userInfo",
  ".AppHeader-profile",
  ".Avatar",
  'a[href*="/people/"]',
  'a[href*="logout"]',
  'a[href*="signout"]',
  '[class*="UserMenu"]',
  '[class*="AppHeader-user"]',
].join(", ");

export function createAccountHandoffGateProbe(account: {
  tenantId: string;
  userId: string;
}): HandoffGatePageProbe {
  return async (): Promise<HandoffGateDomSnapshot | null> => {
    // Read override at call-time so tests can inject after createAccountHandoffGateProbe.
    if (probeOverride) {
      return probeOverride();
    }
    const cdpUrl = await resolveAccountBrowserCdpUrl(account);
    if (!cdpUrl) {
      return null;
    }
    try {
      const page = await getPageForTargetId({ cdpUrl });
      const href = page.url();
      const snap = await page.evaluate((chromeSel: string) => {
        const body = document.body;
        const signedInAttr = body?.getAttribute("data-signed-in") ?? null;
        const statusEl =
          document.getElementById("status") ??
          document.querySelector<HTMLElement>('[role="status"]');
        const statusText = statusEl?.textContent ?? "";
        const path = location.pathname || "";
        const onAuthPath =
          /\/(login|signin|sign-in|signup|sign-up|passport|qrcode|auth\/qr)(?:\/|$)/i.test(path) ||
          /\/signin/i.test(path);
        const hasLoginSurface = Boolean(
          body?.getAttribute("data-login-surface") ||
          body?.getAttribute("data-fixture") === "wechat-qr" ||
          body?.getAttribute("data-fixture") === "sms-otp" ||
          onAuthPath,
        );
        const hasUserChrome = Boolean(document.querySelector(chromeSel));
        const signedInHeuristic =
          signedInAttr === "true" ||
          signedInAttr === "1" ||
          (!hasLoginSurface && !onAuthPath && hasUserChrome);
        return {
          signedInAttr,
          statusText,
          signedInHeuristic,
          leftAuthPath: !onAuthPath,
        };
      }, HANDOFF_SIGNED_IN_CHROME_SELECTOR);
      return { ...snap, href };
    } catch {
      // CDP may flap while Chrome boots; next poll retries rediscover + attach.
      return null;
    }
  };
}
