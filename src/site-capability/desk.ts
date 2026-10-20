/**
 * Account-browser desk lock shared by generic browser dispatch, SAR, and
 * human takeover. One holder per account-browser scope. Parallel dispatch
 * is a conflict, not a second cursor.
 */

export type DeskKind = "browser" | "sar" | "human";

export type DeskLock = {
  kind: DeskKind;
  runId: string;
};

export type DeskClaimResult =
  | { ok: true }
  | { ok: false; code: "SERIAL_CONFLICT" | "HUMAN_TAKEOVER"; message: string };

export type AccountBrowserDesk = {
  claim(scopeKey: string, kind: "browser" | "sar", runId: string): DeskClaimResult;
  /** Drop the lock only when this run still holds it. Human takeover is left in place. */
  release(scopeKey: string, kind: "browser" | "sar", runId: string): void;
};

export class AccountBrowserSerialDenied extends Error {
  readonly code: "SERIAL_CONFLICT" | "HUMAN_TAKEOVER" | "COORDINATOR_REQUIRED";

  constructor(code: AccountBrowserSerialDenied["code"], message: string) {
    super(message);
    this.name = "AccountBrowserSerialDenied";
    this.code = code;
  }
}

let activeDesk: AccountBrowserDesk | null = null;

export function getActiveAccountBrowserDesk(): AccountBrowserDesk | null {
  return activeDesk;
}

export function setActiveAccountBrowserDesk(desk: AccountBrowserDesk | null): void {
  activeDesk = desk;
}

export function resetActiveAccountBrowserDeskForTests(): void {
  activeDesk = null;
}

/**
 * Generic browser entry. When the caller names an account-browser scope,
 * a live coordinator is required. Missing coordinator fails closed.
 */
export function claimActiveBrowserDispatch(
  scopeKey: string,
  runId: string,
):
  | DeskClaimResult
  | {
      ok: false;
      code: "COORDINATOR_REQUIRED";
      message: string;
    } {
  const desk = activeDesk;
  if (!desk) {
    return {
      ok: false,
      code: "COORDINATOR_REQUIRED",
      message: "account-browser serial coordinator is required",
    };
  }
  return desk.claim(scopeKey, "browser", runId);
}

export function releaseActiveBrowserDispatch(
  scopeKey: string,
  kind: "browser" | "sar",
  runId: string,
): void {
  activeDesk?.release(scopeKey, kind, runId);
}
