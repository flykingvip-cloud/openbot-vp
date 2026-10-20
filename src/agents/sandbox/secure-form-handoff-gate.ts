/**
 * Detect when a human login gate (QR / SMS / etc.) is cleared so await_return
 * can resume without a「交给AI」click.
 *
 * Signals are page-state only — never secrets. Fixture contract:
 *   body[data-signed-in="true"] or #status containing "fixture-ok".
 *
 * Live sites (e.g. Zhihu): leave /signin for a non-auth path with signed-in
 * chrome (avatar / AppHeader user / people link). Bare URL success markers
 * alone are not enough for site roots like https://www.zhihu.com/.
 */

export type HandoffGateDomSnapshot = {
  /** document.body.getAttribute("data-signed-in") */
  signedInAttr?: string | null;
  /** #status / [role=status] text */
  statusText?: string | null;
  /** page URL href */
  href?: string | null;
  /** true when login surface markers are gone and signed-in chrome is present */
  signedInHeuristic?: boolean;
  /** true when pathname left login/signin/passport/qr surfaces */
  leftAuthPath?: boolean;
};

const AUTH_PATH_RE = /\/(login|signin|sign-in|signup|sign-up|passport|qrcode|auth\/qr)(?:\/|\?|$)/i;

/** Pure DOM/URL heuristics — unit-testable without CDP. */
export function isHandoffGateClearedFromDom(snap: HandoffGateDomSnapshot): boolean {
  if (snap.signedInAttr === "true" || snap.signedInAttr === "1") {
    return true;
  }
  const status = (snap.statusText ?? "").trim();
  if (/fixture-ok/i.test(status)) {
    return true;
  }
  if (snap.signedInHeuristic === true) {
    return true;
  }
  const href = (snap.href ?? "").trim().toLowerCase();
  if (!href) {
    return false;
  }
  // Common post-login URL markers (demo IdP + fixtures). Conservative.
  if (
    /loginsuccess|login[_-]?success|signed[_-]?in|oauth.*callback|\/home(?:\/|$)|\/dashboard(?:\/|$)/i.test(
      href,
    ) &&
    !AUTH_PATH_RE.test(href)
  ) {
    return true;
  }
  // leftAuthPath alone is not enough (logged-out homepage). signedInHeuristic
  // already returned above when true — no redundant compare (avoids TS2367).
  return false;
}

export type HandoffGatePageProbe = () => Promise<HandoffGateDomSnapshot | null>;

/**
 * Poll until the gate is cleared or abort is signaled.
 * Resolves true when cleared, false when aborted / never cleared.
 */
export async function pollHandoffGateCleared(params: {
  probe: HandoffGatePageProbe;
  intervalMs?: number;
  shouldStop?: () => boolean;
  signal?: AbortSignal;
}): Promise<boolean> {
  const intervalMs =
    typeof params.intervalMs === "number" && params.intervalMs > 0 ? params.intervalMs : 1_500;
  while (true) {
    if (params.shouldStop?.() || params.signal?.aborted) {
      return false;
    }
    let snap: HandoffGateDomSnapshot | null = null;
    try {
      snap = await params.probe();
    } catch {
      snap = null;
    }
    if (snap && isHandoffGateClearedFromDom(snap)) {
      return true;
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, intervalMs);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (params.signal) {
        if (params.signal.aborted) {
          clearTimeout(timer);
          resolve();
          return;
        }
        params.signal.addEventListener("abort", onAbort, { once: true });
      }
    });
  }
}
