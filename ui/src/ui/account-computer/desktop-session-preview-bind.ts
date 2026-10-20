/**
 * Bind Control UI account-computer preview to the Desktop Session Runtime.
 * Listens for noVNC observer postMessage (stream_connected / first_frame / frame_tick).
 */

import { t } from "../../i18n/index.ts";
import {
  createDesktopSessionRuntime,
  type DesktopSessionRuntime,
  type DesktopSessionRuntimeOptions,
} from "./desktop-session-runtime.ts";
import {
  connectingStageOf,
  type ConnectingStage,
  type ReconnectReason,
} from "./desktop-session-state.ts";

export const NOVNC_OBSERVER_SOURCE = "openbot-novnc-observer";

export type NovncObserverMessageType = "stream_connected" | "first_frame" | "frame_tick";

export type NovncObserverMessage = {
  source: typeof NOVNC_OBSERVER_SOURCE;
  type: NovncObserverMessageType;
  ts?: number;
};

export function isNovncObserverMessage(data: unknown): data is NovncObserverMessage {
  if (!data || typeof data !== "object") {
    return false;
  }
  const rec = data as Record<string, unknown>;
  if (rec.source !== NOVNC_OBSERVER_SOURCE) {
    return false;
  }
  return rec.type === "stream_connected" || rec.type === "first_frame" || rec.type === "frame_tick";
}

export type PreviewBindHost = {
  sessionKey: string;
  syncAccountComputerPreview?: () => void;
  refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
  computerPreviewRevision?: number;
  /** Lit paint bump after runtime phase changes that unlock input (first_frame / stall recover). */
  requestUpdate?: () => void;
};

export type DesktopSessionPreviewBind = {
  runtime: DesktopSessionRuntime;
  /** Map streamUrl presence → STREAM_ATTACHED only (iron rule). */
  onStreamUrl: (streamUrl: string | null) => void;
  onPreviewOpen: () => void;
  onPreviewFailed: () => void;
  onEnd: () => void;
  onYield: () => void;
  /**
   * Leave terminal YIELDED/ENDED so a later 接管 can re-enter INTERACTIVE.
   * Hand-back calls onYield (terminal); without this, first_frame is ignored and
   * the iframe stays inert even though chrome shows 给AI.
   */
  resumeAfterHumanTakeover: () => void;
  noteAuthExpired: () => void;
  noteSessionLost: () => void;
  noteNetworkDegraded: () => void;
  /** Update credential refresh / host hooks after bind creation. */
  configure: (next: {
    host?: PreviewBindHost;
    refreshCredential?: () => void | Promise<void>;
  }) => void;
  /** Install window message listener; returns disposer. */
  attachMessageListener: (target?: Window) => () => void;
  /** Copy for connecting / anomaly CTA based on runtime stage. */
  connectingCopy: () => {
    message: string;
    cta: string | null;
    stage: ConnectingStage;
    reconnectReason: ReconnectReason | null;
  };
  /** Session reconnect without reload. */
  reconnect: (reason: ReconnectReason) => void;
  /** Preferred reconnect reason for the current anomaly stage. */
  preferredReconnectReason: () => ReconnectReason;
  dispose: () => void;
};

export type PreviewBindOptions = Omit<DesktopSessionRuntimeOptions, "onReconnect"> & {
  host?: PreviewBindHost;
  /**
   * Credential refresh path (token lifecycle). Called when reason === "credential".
   * Must not reload the page.
   */
  refreshCredential?: () => void | Promise<void>;
};

export function reconnectReasonForStage(stage: ConnectingStage): ReconnectReason {
  if (stage === "auth") {
    return "credential";
  }
  if (stage === "degraded") {
    return "network";
  }
  return "stream";
}

function stageCopy(stage: ConnectingStage): { message: string; cta: string | null } {
  switch (stage) {
    case "opening":
      return { message: t("chat.computerConnectingOpening"), cta: null };
    case "connecting":
      return { message: t("chat.computerConnectingChannel"), cta: null };
    case "waiting_picture":
      return { message: t("chat.computerConnectingWaitingPicture"), cta: null };
    case "attached":
      return { message: t("chat.computerConnectingAttached"), cta: null };
    case "live":
      return { message: t("chat.computerConnectingLive"), cta: null };
    case "stalled":
      return {
        message: t("chat.computerStreamStalled"),
        cta: t("chat.computerReconnectCta"),
      };
    case "reconnecting":
      return { message: t("chat.computerReconnecting"), cta: null };
    case "failed":
      return {
        message: t("chat.computerConnectGaveUp"),
        cta: t("chat.computerReconnectCta"),
      };
    case "auth":
      return {
        message: t("chat.computerAuthExpired"),
        cta: t("chat.computerReconnectCredentialCta"),
      };
    case "lost":
      return {
        message: t("chat.computerSessionLost"),
        cta: t("chat.computerReconnectCta"),
      };
    case "degraded":
      return {
        message: t("chat.computerNetworkDegraded"),
        cta: t("chat.computerReconnectCta"),
      };
    case "ended":
    case "yielded":
    case "idle":
    default:
      return { message: t("chat.computerConnecting"), cta: null };
  }
}

/** Bump Control UI so INTERACTIVE / recovered input gates re-render (clear inert). */
export function notifyDesktopPreviewPaint(host: PreviewBindHost | undefined) {
  if (!host) {
    return;
  }
  if (typeof host.computerPreviewRevision === "number") {
    host.computerPreviewRevision = host.computerPreviewRevision + 1;
  }
  if (typeof host.requestUpdate === "function") {
    host.requestUpdate();
  }
}

export function createDesktopSessionPreviewBind(
  options: PreviewBindOptions,
): DesktopSessionPreviewBind {
  let host = options.host;
  let refreshCredential = options.refreshCredential;

  const runReconnectSideEffects = (reason: ReconnectReason) => {
    // Session-level recovery only — never location.reload().
    if (reason === "credential") {
      if (typeof refreshCredential === "function") {
        return refreshCredential();
      }
      // Fallback: re-open preview mints a fresh stream token.
      if (host && typeof host.refreshAccountComputerPreview === "function") {
        return host.refreshAccountComputerPreview("open");
      }
      return;
    }
    // stream | network: re-request preview / open without page reload.
    if (host) {
      if (typeof host.syncAccountComputerPreview === "function") {
        host.syncAccountComputerPreview();
        return;
      }
      if (typeof host.refreshAccountComputerPreview === "function") {
        return host.refreshAccountComputerPreview("open");
      }
    }
  };

  const runtime = createDesktopSessionRuntime({
    ...options,
    onReconnect: (reason) => runReconnectSideEffects(reason),
  });

  let lastStreamUrl: string | null = null;
  let opened = false;
  let previewRequested = false;

  const bind: DesktopSessionPreviewBind = {
    runtime,
    configure(next) {
      if (next.host) {
        host = next.host;
      }
      if (typeof next.refreshCredential === "function") {
        refreshCredential = next.refreshCredential;
      }
    },
    onStreamUrl(streamUrl) {
      const next = streamUrl?.trim() || null;
      if (next && next !== lastStreamUrl) {
        lastStreamUrl = next;
        // Iron rule enforced inside runtime: STREAM_ATTACHED only.
        runtime.noteStreamEndpoint();
      } else if (!next) {
        lastStreamUrl = null;
      }
    },
    onPreviewOpen() {
      if (!opened) {
        runtime.noteOpen();
        opened = true;
      }
      if (!previewRequested) {
        runtime.notePreviewRequested();
        previewRequested = true;
      }
    },
    onPreviewFailed() {
      runtime.noteConnectFailed();
    },
    onEnd() {
      runtime.noteEnd();
      opened = false;
      previewRequested = false;
      lastStreamUrl = null;
    },
    onYield() {
      runtime.noteYield();
    },
    resumeAfterHumanTakeover() {
      const phase = runtime.snapshot.phase;
      if (phase !== "YIELDED" && phase !== "ENDED") {
        return;
      }
      // Allow onPreviewOpen / stream / first_frame to advance again after hand-back.
      opened = false;
      previewRequested = false;
      lastStreamUrl = null;
      runtime.noteOpen();
      opened = true;
      runtime.notePreviewRequested();
      previewRequested = true;
    },
    noteAuthExpired() {
      if (runtime.snapshot.phase === "AUTH_EXPIRED" || runtime.snapshot.phase === "RECONNECTING") {
        return;
      }
      runtime.noteAuthExpired();
    },
    noteSessionLost() {
      if (runtime.snapshot.phase === "SESSION_LOST" || runtime.snapshot.phase === "ENDED") {
        return;
      }
      runtime.noteSessionLost();
    },
    noteNetworkDegraded() {
      if (
        runtime.snapshot.phase === "NETWORK_DEGRADED" ||
        runtime.snapshot.phase === "RECONNECTING" ||
        runtime.snapshot.phase === "ENDED"
      ) {
        return;
      }
      runtime.noteNetworkDegraded();
    },
    attachMessageListener(target = typeof window !== "undefined" ? window : undefined) {
      if (!target || typeof target.addEventListener !== "function") {
        return () => undefined;
      }
      const handler = (event: MessageEvent) => {
        if (!isNovncObserverMessage(event.data)) {
          return;
        }
        switch (event.data.type) {
          case "stream_connected":
            runtime.noteStreamEndpoint();
            break;
          case "first_frame": {
            // Intentional: FIRST_FRAME then INTERACTIVE once framebuffer is live.
            runtime.noteFirstFrame();
            runtime.noteInteractiveReady();
            // Without a paint bump Lit keeps pre-INTERACTIVE inert+data-input-* false
            // even though the runtime already reached INTERACTIVE.
            notifyDesktopPreviewPaint(host);
            break;
          }
          case "frame_tick": {
            const beforePhase = runtime.snapshot.phase;
            const beforeStall = runtime.snapshot.stall;
            const recovering =
              beforePhase === "STREAM_STALLED" ||
              beforeStall === "SUSPECTED" ||
              beforeStall === "CONFIRMED" ||
              beforeStall === "RECONNECTING";
            // If first_frame was missed (RFB painted before the parent listener
            // attached), frame_tick is the only signal left. Promote so human
            // takeover is not stuck with an inert iframe (STREAM_ATTACHED +
            // canvas painted + pointer=false).
            if (beforePhase === "STREAM_ATTACHED") {
              runtime.noteFirstFrame();
              runtime.noteInteractiveReady();
            } else {
              runtime.noteFrameTick();
            }
            // Stall recovery used to stop at FIRST_FRAME (still in the input blocklist).
            // Promote to INTERACTIVE whenever frames are flowing again after a stall,
            // or when still sitting on FIRST_FRAME without a paint.
            if (recovering || runtime.snapshot.phase === "FIRST_FRAME") {
              runtime.noteInteractiveReady();
            }
            if (
              recovering ||
              beforePhase === "STREAM_ATTACHED" ||
              runtime.snapshot.phase !== beforePhase ||
              runtime.snapshot.stall !== beforeStall
            ) {
              notifyDesktopPreviewPaint(host);
            }
            break;
          }
          default:
            break;
        }
      };
      const onOffline = () => {
        bind.noteNetworkDegraded();
      };
      target.addEventListener("message", handler as EventListener);
      target.addEventListener("offline", onOffline);
      return () => {
        target.removeEventListener("message", handler as EventListener);
        target.removeEventListener("offline", onOffline);
      };
    },
    connectingCopy() {
      const stage = connectingStageOf(runtime.snapshot);
      const { message, cta } = stageCopy(stage);
      const anomaly = Boolean(cta) || stage === "reconnecting";
      return {
        message,
        cta,
        stage,
        reconnectReason: anomaly ? reconnectReasonForStage(stage) : null,
      };
    },
    preferredReconnectReason() {
      return reconnectReasonForStage(connectingStageOf(runtime.snapshot));
    },
    reconnect(reason) {
      runtime.startReconnect(reason);
    },
    dispose() {
      runtime.dispose();
    },
  };

  return bind;
}

/** Singleton bind registry keyed by sessionKey (Control UI preview path). */
const binds = new Map<string, DesktopSessionPreviewBind>();

export function getOrCreatePreviewBind(
  sessionKey: string,
  options?: Omit<PreviewBindOptions, "sessionId"> & { sessionId?: string },
): DesktopSessionPreviewBind {
  const key = sessionKey.trim() || "default";
  const existing = binds.get(key);
  if (existing) {
    existing.configure({
      host: options?.host,
      refreshCredential: options?.refreshCredential,
    });
    return existing;
  }
  const created = createDesktopSessionPreviewBind({
    sessionId: options?.sessionId ?? key,
    ...options,
    host: options?.host ?? { sessionKey: key },
  });
  binds.set(key, created);
  return created;
}

export function resetPreviewBindsForTests() {
  for (const bind of binds.values()) {
    bind.dispose();
  }
  binds.clear();
}
