/**
 * Gateway ↔ local WeChat personal worker command surface.
 *
 * Session files stay on the worker (chmod 600). The cloud Gateway must never
 * hold context_token / proxy apiKey for personal WeChat.
 */

export type WechatWorkerLoginStartResult = {
  qrDataUrl: string;
  loginId: string;
};

export type WechatWorkerLoginWaitResult = {
  connected: boolean;
  status: "scanning" | "confirming" | "logged_in" | "logged_out" | "timeout" | "error";
  wxid?: string;
  nickname?: string;
  message: string;
};

export type WechatWorkerStatusResult = {
  online: boolean;
  loggedIn: boolean;
  wxid?: string;
  nickname?: string;
};

export type WechatWorkerProbeResult = {
  ok: boolean;
  online: boolean;
  error?: string;
  /** Soft advisory (e.g. sidecar sendReady:false). Never alone marks offline. */
  warning?: string;
};

export type WechatPersonalWorker = {
  /** Fail-closed reachability check for the local worker / node. */
  probe: () => Promise<WechatWorkerProbeResult>;
  loginStart: (params: {
    accountId: string;
    force?: boolean;
    timeoutMs?: number;
  }) => Promise<WechatWorkerLoginStartResult>;
  loginWait: (params: {
    accountId: string;
    timeoutMs?: number;
  }) => Promise<WechatWorkerLoginWaitResult>;
  logout: (params: { accountId: string }) => Promise<{ cleared: boolean }>;
  status: (params: { accountId: string }) => Promise<WechatWorkerStatusResult>;
  sendText?: (params: { accountId: string; to: string; text: string }) => Promise<{
    messageId: string;
    /**
     * vNext sidecar delivery state; omit for legacy msgId-only responses.
     * Known values: delivered | submitted_unconfirmed | status_unknown.
     */
    deliveryStatus?: string;
  }>;
};

/** JSON command names for a future Mac Node / local invoke bridge. */
export const WECHAT_WORKER_COMMANDS = {
  probe: "wechat.personal.probe",
  loginStart: "wechat.personal.login.start",
  loginWait: "wechat.personal.login.wait",
  logout: "wechat.personal.logout",
  status: "wechat.personal.status",
  sendText: "wechat.personal.sendText",
} as const;

/** Node event (not an invoke RPC) used to forward sidecar inbound DMs to Gateway. */
export const WECHAT_PERSONAL_INBOUND_EVENT = "wechat.personal.inbound";

export const WECHAT_WORKER_OFFLINE_ERROR = "WeChat personal worker is offline or unreachable.";

/**
 * Default fail-closed worker: no QR, no session, probe fails.
 * Replace via setWechatPersonalWorker() when a local node is available.
 */
export function createFailClosedWechatPersonalWorker(
  reason = WECHAT_WORKER_OFFLINE_ERROR,
): WechatPersonalWorker {
  return {
    async probe() {
      return { ok: false, online: false, error: reason };
    },
    async loginStart() {
      throw new Error(reason);
    },
    async loginWait() {
      return {
        connected: false,
        status: "error",
        message: reason,
      };
    },
    async logout() {
      return { cleared: false };
    },
    async status() {
      return { online: false, loggedIn: false };
    },
  };
}

/**
 * In-memory test double that can simulate QR → logged_in without a real node.
 * Session state is process-local only (never persisted to cloud).
 */
export function createMemoryWechatPersonalWorker(opts?: {
  wxid?: string;
  nickname?: string;
  online?: boolean;
}): WechatPersonalWorker & {
  setOnline: (online: boolean) => void;
  forceLogin: (wxid: string, nickname?: string) => void;
} {
  let online = opts?.online ?? true;
  let loggedIn = false;
  let wxid = opts?.wxid ?? "";
  let nickname = opts?.nickname ?? "";
  let pendingQr: { accountId: string; loginId: string; qrDataUrl: string } | null = null;

  return {
    setOnline(next: boolean) {
      online = next;
    },
    forceLogin(nextWxid: string, nextNickname?: string) {
      loggedIn = true;
      wxid = nextWxid;
      nickname = nextNickname ?? nextWxid;
      pendingQr = null;
    },
    async probe() {
      if (!online) {
        return { ok: false, online: false, error: WECHAT_WORKER_OFFLINE_ERROR };
      }
      return { ok: true, online: true };
    },
    async loginStart({ accountId, force }) {
      if (!online) {
        throw new Error(WECHAT_WORKER_OFFLINE_ERROR);
      }
      if (loggedIn && !force) {
        throw new Error(`WeChat personal already linked (${wxid || "unknown"}).`);
      }
      const loginId = `mem-${accountId}-${Date.now()}`;
      const qrDataUrl =
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      pendingQr = { accountId, loginId, qrDataUrl };
      return { qrDataUrl, loginId };
    },
    async loginWait({ accountId, timeoutMs }) {
      if (!online) {
        return {
          connected: false,
          status: "error",
          message: WECHAT_WORKER_OFFLINE_ERROR,
        };
      }
      if (!pendingQr || pendingQr.accountId !== accountId) {
        if (loggedIn) {
          return {
            connected: true,
            status: "logged_in",
            wxid: wxid || undefined,
            nickname: nickname || undefined,
            message: `Logged in as ${wxid || "unknown"}`,
          };
        }
        return {
          connected: false,
          status: "timeout",
          message: "No active WeChat personal QR login.",
        };
      }
      // Simulate scan completion for tests after a short wait budget.
      void timeoutMs;
      loggedIn = true;
      wxid = wxid || `wxid_test_${accountId}`;
      nickname = nickname || "Test WeChat";
      pendingQr = null;
      return {
        connected: true,
        status: "logged_in",
        wxid,
        nickname,
        message: `Logged in as ${wxid}`,
      };
    },
    async logout() {
      loggedIn = false;
      wxid = "";
      nickname = "";
      pendingQr = null;
      return { cleared: true };
    },
    async status() {
      return {
        online,
        loggedIn: online && loggedIn,
        wxid: loggedIn ? wxid || undefined : undefined,
        nickname: loggedIn ? nickname || undefined : undefined,
      };
    },
    async sendText({ to, text }) {
      if (!online || !loggedIn) {
        throw new Error(WECHAT_WORKER_OFFLINE_ERROR);
      }
      return { messageId: `wechat-mem-${to}-${text.length}-${Date.now()}` };
    },
  };
}
