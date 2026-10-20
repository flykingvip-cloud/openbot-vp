/**
 * Account Computer preview inside the existing chat sidebar.
 * Chrome (tab, size) is per view. The noVNC service is per tenantId + platform user id.
 *
 * Each chat stores the stream URL from its own open. The server mints a fresh
 * short-lived token per open against the one port: view-only unless this session
 * holds control. Showing the computer claims that input grant, so the dock is
 * clickable without a separate 接管 click. Docked and expanded previews keep
 * 返回桌面, 全屏, and 给AI in the header. Fullscreen drops those three titles
 * and the sidebar chrome row. 退出全屏 sits in the workbench stage header.
 * 关闭预览 closes the sidebar only while the preview is not fullscreen.
 * Escape also leaves fullscreen.
 * Handing control back, or a pending secure form, keeps the picture view-only.
 * A later open while this session already holds a live input grant does not
 * rotate the token. CONTROLLED_BY names the operator.
 */
import { html, nothing, type TemplateResult } from "lit";
import { t } from "../../i18n/index.ts";
import {
  createClipboardSyncSession,
  ensureClipboardPermission,
  getCachedClipboardPermission,
  readTextFromClipboardEvent,
  resetClipboardPermissionCacheForTests,
  type ClipboardSyncResult,
} from "../account-computer/desktop-clipboard.ts";
import {
  applyComputerFullscreenSizeChange,
  enterComputerFullscreenSize,
  exitComputerFullscreenSize,
  inputCapabilityDataAttrs,
  resolveDesktopInputCapability,
  toggleComputerFullscreenSize,
  type DesktopInputCapability,
} from "../account-computer/desktop-input-capability.ts";

export { exitComputerFullscreenSize };
import {
  shouldForcePreviewTokenRotate,
  shouldSkipHealthyInteractivePreviewOpen,
} from "../account-computer/desktop-session-perf.ts";
import {
  getOrCreatePreviewBind,
  resetPreviewBindsForTests,
  type DesktopSessionPreviewBind,
  type PreviewBindHost,
} from "../account-computer/desktop-session-preview-bind.ts";
import type { DesktopSessionPhase } from "../account-computer/desktop-session-state.ts";
import {
  getActiveTakeoverEpisode,
  normalizeSiteHost,
  observeOwnershipTransitionForLearning,
  resetTakeoverLearningForTests,
  takeoverLearningDataAttrs,
} from "../account-computer/desktop-takeover-learning.ts";
import {
  dispatchInteractionOwnership,
  getInteractionOwnership,
  moveInteractionOwnership,
  ownershipDataAttrs,
  resetInteractionOwnershipForTests,
  tickInteractionOwnershipGrace,
  type InteractionOwnershipSnapshot,
} from "../account-computer/interaction-ownership.ts";
import { DEFAULT_ASSISTANT_AVATAR, DEFAULT_ASSISTANT_NAME } from "../assistant-identity.ts";
import { extractToolCards } from "../chat/tool-cards.ts";

/** Shared host↔remote clipboard sync (loop-suppressed). Not a poller. */
const previewClipboardSync = createClipboardSyncSession();

/**
 * User-gesture clipboard bridge for the 电脑 stage.
 * Probes permission once (event-driven); syncs text/plain with size/MIME guards.
 * Does not start timers or focus listeners.
 */
function onComputerClipboardUserGesture(
  event: ClipboardEvent,
  clipboardCapable: boolean,
  canDrive: boolean,
): ClipboardSyncResult | null {
  if (!canDrive) {
    return null;
  }
  // One-shot permission probe on gesture — never interval / focus poll.
  void ensureClipboardPermission();
  if (!clipboardCapable) {
    return null;
  }
  if (event.type === "paste") {
    const text = readTextFromClipboardEvent(event);
    if (text == null) {
      return null;
    }
    return previewClipboardSync.hostToRemote(text);
  }
  if (event.type === "copy" || event.type === "cut") {
    const text = readTextFromClipboardEvent(event);
    if (text == null) {
      return null;
    }
    // Host copy while driving desktop: treat as host→remote publish of selection text when present.
    return previewClipboardSync.hostToRemote(text);
  }
  return null;
}

/** Test helper: reset clipboard permission cache used by preview gating. */
export function resetComputerClipboardPermissionForTests(): void {
  resetClipboardPermissionCacheForTests();
  previewClipboardSync.clearLoopGuard();
}

export type ComputerPreviewSurface = "artifact" | "computer";
export type ComputerPreviewSize = "docked" | "expanded" | "fullscreen";
export type ComputerFormalStatus = "STARTING" | "READY" | "REAUTH_REQUIRED" | "DISCONNECTED";
export type ComputerKeyboardTarget = "chat" | "desktop";

export type ComputerOperator = {
  kind: "agent" | "user";
  label: string;
};

export type ComputerPreviewChrome = {
  sidebarOpen: boolean;
  sidebarSurface: ComputerPreviewSurface;
  computerPreviewSize: ComputerPreviewSize;
  computerNarrowChat: boolean;
  computerPreviewRevision: number;
  sessionKey: string;
  assistantName?: string;
};

export type ComputerPreviewModel = {
  surface: ComputerPreviewSurface;
  size: ComputerPreviewSize;
  parkFrame: boolean;
  narrowChat: boolean;
  forceNarrow: boolean;
  connectionId: string | null;
  mountGeneration: number;
  /** True when this view should paint the shared stream. */
  ownsFrame: boolean;
  /** True when this session may send pointer and keyboard into the desktop. */
  controlsDesktop: boolean;
  streamUrl: string | null;
  formalStatus: ComputerFormalStatus | null;
  operator: ComputerOperator | null;
  userTakeover: boolean;
  ended: boolean;
  showChip: boolean;
  /** Last browser.preview failure message; cleared on a successful open. */
  previewError: string | null;
  /** M1b Desktop Session connecting stage (canonical runtime). */
  sessionStage?: string | null;
  /** Multi-stage / anomaly copy from Desktop Session Runtime. */
  sessionConnectingMessage?: string | null;
  /** Optional reconnect CTA label when stalled / failed / auth. */
  sessionReconnectCta?: string | null;
  /** Reconnect reason for CTA / auto recovery (network | stream | credential). */
  sessionReconnectReason?: "network" | "stream" | "credential" | null;
  /** Canonical M1b phase (INTERACTIVE unlocks input capability). */
  sessionPhase?: DesktopSessionPhase | null;
  /** Observable input capability flags (clipboard requires permission + INTERACTIVE). */
  inputCapability?: DesktopInputCapability | null;
  /** Interaction Ownership Coordinator snapshot (M4). */
  ownership?: InteractionOwnershipSnapshot | null;
};

type ComputerConnection = {
  id: string;
  accountKey: string;
  /** Per chat. Each open carries its own token; do not share one consumed URL. */
  sessionStreams: Map<string, string>;
  /** Last token mode applied for a chat, so a later open does not reload the iframe. */
  issuedMode: Map<string, "input" | "view">;
  /**
   * Last known remote desktop page URL (sanitized raw string, not host-only).
   * Feeds takeover learning siteHost; null until noted.
   */
  remotePageUrl: string | null;
  formalStatus: ComputerFormalStatus | null;
  agentOperator: ComputerOperator | null;
  operator: ComputerOperator | null;
  userTakeover: boolean;
  /**
   * Set by 交还. Showing the computer does not claim input again until 接管.
   * A fresh connection (cold open after end) starts cleared.
   */
  userYielded: boolean;
  /** True after this session's open stored an input URL. Avoids rotating that grant. */
  inputGrantLive: boolean;
  /** Session that took over. Other sessions of this account stay view-only. */
  controlSessionKey: string | null;
  agentEngaged: boolean;
  ended: boolean;
  mountGeneration: number;
  previewError: string | null;
  streamRetryAttempt: number;
  /** Wall clock when connecting UI became active (for min visible hold). */
  connectingStartedAt: number | null;
};

const PENDING_ACCOUNT_KEY = "\0pending";

const sessionMessageDisposers = new Map<string, () => void>();

type ComputerPreviewHost = ComputerPreviewChrome & {
  syncAccountComputerPreview?: () => void;
  refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
};

function desktopSessionBindFor(
  sessionKey: string,
  host?: PreviewBindHost,
): DesktopSessionPreviewBind {
  const key = sessionKey.trim() || "default";
  const resolvedHost: PreviewBindHost = host ?? { sessionKey: key };
  const refreshCredential = () => {
    // Token lifecycle: re-open mints a fresh short-lived stream URL (no page reload).
    if (typeof resolvedHost.refreshAccountComputerPreview === "function") {
      return resolvedHost.refreshAccountComputerPreview("open");
    }
    if (typeof resolvedHost.syncAccountComputerPreview === "function") {
      resolvedHost.syncAccountComputerPreview();
    }
  };
  const bind = getOrCreatePreviewBind(key, {
    sessionId: key,
    host: resolvedHost,
    refreshCredential,
  });
  if (!sessionMessageDisposers.has(key)) {
    sessionMessageDisposers.set(key, bind.attachMessageListener());
  }
  return bind;
}

/** Reconnect stream without location.reload() (M1b iron rule). */
export function reconnectComputerDesktopSession(
  host: ComputerPreviewHost,
  reason?: "network" | "stream" | "credential",
) {
  const bind = desktopSessionBindFor(host.sessionKey, host);
  const resolved = reason ?? bind.preferredReconnectReason();
  bind.reconnect(resolved);
  host.computerPreviewRevision += 1;
}

/** Map Control UI formal status / errors onto Desktop Session anomaly phases. */
export function noteComputerDesktopSessionAnomaly(
  sessionKey: string,
  kind: "auth" | "lost" | "degraded" | "failed",
  host?: ComputerPreviewHost,
) {
  const bind = desktopSessionBindFor(sessionKey, host);
  if (kind === "auth") {
    bind.noteAuthExpired();
  } else if (kind === "lost") {
    bind.noteSessionLost();
  } else if (kind === "degraded") {
    bind.noteNetworkDegraded();
  } else {
    bind.onPreviewFailed();
  }
}

const connections = new Map<string, ComputerConnection>();
let activeAccountKey: string | null = null;
let connectionSeq = 0;

/** Same-origin noVNC bootstrap returns this plain body when the one-shot token is gone. */
export const NOVNC_INVALID_OR_EXPIRED_TOKEN = "Invalid or expired token";

/** Loom landing: post-takeover input remint + per-session stream bind + stage vertical center. */
export const DESKTOP_POST_TAKEOVER_INPUT_LANDING = "DESKTOP_POST_TAKEOVER_INPUT_M1" as const;

/** True when the iframe document is the gateway 404 body for a consumed/expired grant. */
export function isNovncInvalidOrExpiredTokenDocument(doc: Document | null | undefined): boolean {
  if (!doc?.body) {
    return false;
  }
  const text = (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
  return text === NOVNC_INVALID_OR_EXPIRED_TOKEN || text.includes(NOVNC_INVALID_OR_EXPIRED_TOKEN);
}

/**
 * Drop the consumed streamUrl, mark AUTH_EXPIRED, and reconnect with reason=credential
 * (re-open mints a fresh token — never location.reload).
 */
export function rotateComputerPreviewStreamCredential(host: ComputerPreviewHost) {
  const key = host.sessionKey.trim();
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  if (connection) {
    connection.sessionStreams.delete(key);
    connection.issuedMode.delete(key);
    connection.inputGrantLive = false;
  }
  const bind = desktopSessionBindFor(key, host);
  bind.noteAuthExpired();
  host.computerPreviewRevision += 1;
  bind.reconnect("credential");
}

/** Keep 「正在连接…」 on screen long enough for accept / cold UI to observe. */
const MIN_CONNECTING_VISIBLE_MS = 900;
const connectingHoldTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function accountComputerKey(tenantId: string, userId: string): string {
  const tenant = tenantId.trim();
  const user = userId.trim();
  if (!tenant || !user) {
    throw new Error("account computer requires tenantId and userId");
  }
  return `${tenant}\u0000${user}`;
}

/**
 * Test-only: advance the Desktop Session Runtime to INTERACTIVE so input
 * capability gating (keyboard/pointer) can unlock after takeover.
 * Production reaches INTERACTIVE via noVNC first_frame → noteInteractiveReady.
 */
export function advanceComputerDesktopInteractiveForTests(sessionKey: string) {
  const bind = desktopSessionBindFor(sessionKey);
  const phase = bind.runtime.snapshot.phase;
  if (phase === "YIELDED" || phase === "ENDED") {
    bind.resumeAfterHumanTakeover();
  } else if (phase === "IDLE") {
    bind.runtime.noteOpen();
    bind.runtime.notePreviewRequested();
  } else if (phase === "OPENING") {
    bind.runtime.notePreviewRequested();
  }
  if (
    bind.runtime.snapshot.phase === "CONNECTING" ||
    bind.runtime.snapshot.phase === "OPENING" ||
    bind.runtime.snapshot.phase === "CONNECT_FAILED" ||
    bind.runtime.snapshot.phase === "RECONNECTING"
  ) {
    bind.runtime.noteStreamEndpoint();
  }
  if (bind.runtime.snapshot.phase === "STREAM_ATTACHED") {
    bind.runtime.noteFirstFrame();
  }
  if (bind.runtime.snapshot.phase === "FIRST_FRAME") {
    bind.runtime.noteInteractiveReady();
  } else if (bind.runtime.snapshot.phase !== "INTERACTIVE") {
    // STREAM_STALLED / NETWORK_DEGRADED etc. with a prior frame — recover then interactive.
    bind.runtime.noteFirstFrame();
    bind.runtime.noteInteractiveReady();
  }
}

export function resetAccountComputerPreviewForTests() {
  clearComputerPreviewStreamRetries();
  for (const dispose of sessionMessageDisposers.values()) {
    dispose();
  }
  sessionMessageDisposers.clear();
  resetPreviewBindsForTests();
  resetInteractionOwnershipForTests();
  resetTakeoverLearningForTests();
  resetComputerClipboardPermissionForTests();
  connections.clear();
  activeAccountKey = null;
  connectionSeq = 0;
}

/** Unit tests that assert the live iframe can skip the min connecting hold. */
export function expireComputerConnectingHoldForTests() {
  const past = Date.now() - MIN_CONNECTING_VISIBLE_MS - 1;
  for (const connection of connections.values()) {
    if (connection.connectingStartedAt) {
      connection.connectingStartedAt = past;
    }
  }
}

/**
 * Computer identity is tenantId + platform user id (`employeeUserId`).
 * `session.user` is the login email and must never be the key.
 */
export function resolveAccountComputerAccount(snapshot: {
  tenantId?: string | null;
  employeeUserId?: string | null;
}): { tenantId: string; userId: string } | null {
  const tenantId = snapshot.tenantId?.trim() ?? "";
  const userId = snapshot.employeeUserId?.trim() ?? "";
  if (!tenantId || !userId || userId.includes("@")) {
    return null;
  }
  return { tenantId, userId };
}

export function rememberComputerAccount(account: { tenantId: string; userId: string } | null) {
  if (!account?.tenantId?.trim() || !account.userId?.trim()) {
    return;
  }
  activeAccountKey = accountComputerKey(account.tenantId, account.userId);
}

function createConnection(accountKey: string): ComputerConnection {
  connectionSeq += 1;
  return {
    id: `computer-${connectionSeq}`,
    accountKey,
    sessionStreams: new Map(),
    issuedMode: new Map(),
    remotePageUrl: null,
    formalStatus: null,
    agentOperator: null,
    operator: null,
    userTakeover: false,
    userYielded: false,
    inputGrantLive: false,
    controlSessionKey: null,
    agentEngaged: false,
    ended: false,
    mountGeneration: 1,
    previewError: null,
    streamRetryAttempt: 0,
    connectingStartedAt: null,
  };
}

function liveConnection(accountKey: string): ComputerConnection | null {
  const connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    return null;
  }
  return connection;
}

const MAX_REMOTE_PAGE_URL_CHARS = 2048;

/**
 * Basic sanitize for remote page URL storage: drop credentials, ignore blank /
 * about:blank. Keeps a normalized URL string (not host-only) for later siteHost.
 */
export function sanitizeComputerRemotePageUrl(pageUrl: string | null | undefined): string | null {
  const raw = (pageUrl ?? "").trim();
  if (!raw) {
    return null;
  }
  const lower = raw.toLowerCase();
  if (lower === "about:blank" || lower.startsWith("about:blank#")) {
    return null;
  }
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(raw) ? raw : `https://${raw}`;
    const u = new URL(withScheme);
    u.username = "";
    u.password = "";
    // Drop hash (often holds tokens); keep path + query for site context.
    u.hash = "";
    const out = u.toString();
    return out.slice(0, MAX_REMOTE_PAGE_URL_CHARS) || null;
  } catch {
    const cleaned = raw.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/@]*@/, (m) => {
      // Strip userinfo if present in non-URL-parseable strings.
      const schemeEnd = m.indexOf("://");
      return schemeEnd >= 0 ? m.slice(0, schemeEnd + 3) : m;
    });
    if (!cleaned || cleaned.toLowerCase() === "about:blank") {
      return null;
    }
    return cleaned.slice(0, MAX_REMOTE_PAGE_URL_CHARS);
  }
}

/**
 * Record the remote desktop page URL on the active (or pending) connection.
 * Empty / about:blank inputs are ignored (do not clear a prior good URL).
 */
export function noteComputerRemotePageUrl(pageUrl: string | null | undefined): void {
  const sanitized = sanitizeComputerRemotePageUrl(pageUrl);
  if (sanitized == null) {
    return;
  }
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  let connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
  }
  connection.remotePageUrl = sanitized;
}

/** Resolve pageUrl for learning observers (override → connection remote). */
function resolveLearningPageUrl(
  connection: ComputerConnection | null | undefined,
  override?: string | null,
): string | null {
  if (override !== undefined && override !== null) {
    const sanitized = sanitizeComputerRemotePageUrl(override);
    if (sanitized) {
      return sanitized;
    }
    // Explicit empty override: fall through to stored remote.
  }
  return connection?.remotePageUrl ?? null;
}

export function defaultComputerPreviewModel(): ComputerPreviewModel {
  return {
    surface: "artifact",
    size: "docked",
    parkFrame: false,
    narrowChat: false,
    forceNarrow: false,
    connectionId: null,
    mountGeneration: 0,
    ownsFrame: false,
    controlsDesktop: false,
    streamUrl: null,
    formalStatus: null,
    operator: null,
    userTakeover: false,
    ended: false,
    showChip: false,
    previewError: null,
    sessionStage: null,
    sessionConnectingMessage: null,
    sessionReconnectCta: null,
    sessionReconnectReason: null,
    sessionPhase: null,
    inputCapability: resolveDesktopInputCapability({
      phase: null,
      controlsDesktop: false,
      surface: "artifact",
      clipboardPermission: getCachedClipboardPermission(),
    }),
    ownership: null,
  };
}

export function computerKeyboardTarget(
  model: Pick<
    ComputerPreviewModel,
    "surface" | "controlsDesktop" | "sessionPhase" | "sessionStage" | "inputCapability"
  >,
): ComputerKeyboardTarget {
  const cap =
    model.inputCapability ??
    resolveDesktopInputCapability({
      phase: model.sessionPhase ?? null,
      controlsDesktop: model.controlsDesktop,
      surface: model.surface,
      anomalyOverlay: isAnomalySessionStage(model.sessionStage),
      clipboardPermission: getCachedClipboardPermission(),
    });
  return cap.keyboard ? "desktop" : "chat";
}

function isAnomalySessionStage(stage: string | null | undefined): boolean {
  return Boolean(
    stage && ["stalled", "failed", "auth", "lost", "degraded", "reconnecting"].includes(stage),
  );
}

/** Layout fullscreen enter — never reloads Control UI. */
export function enterComputerFullscreen(host: ComputerPreviewChrome) {
  applyComputerFullscreenSizeChange(() => {
    setComputerPreviewSize(host, enterComputerFullscreenSize());
  });
}

/** Layout fullscreen exit (Escape / shrink) — never reloads Control UI. */
export function exitComputerFullscreen(host: ComputerPreviewChrome) {
  applyComputerFullscreenSizeChange(() => {
    setComputerPreviewSize(host, exitComputerFullscreenSize());
  });
}

/** Toggle docked ↔ fullscreen without reload. */
export function toggleComputerFullscreen(host: ComputerPreviewChrome) {
  applyComputerFullscreenSizeChange(() => {
    setComputerPreviewSize(host, toggleComputerFullscreenSize(host.computerPreviewSize));
  });
}

function adoptPendingConnection(accountKey: string) {
  if (accountKey === PENDING_ACCOUNT_KEY || connections.has(accountKey)) {
    // Still migrate ownership if connection already adopted but ownership lagged.
    if (accountKey !== PENDING_ACCOUNT_KEY) {
      moveInteractionOwnership(PENDING_ACCOUNT_KEY, accountKey);
    }
    return;
  }
  const pending = connections.get(PENDING_ACCOUNT_KEY);
  if (!pending || pending.ended) {
    moveInteractionOwnership(PENDING_ACCOUNT_KEY, accountKey);
    return;
  }
  connections.delete(PENDING_ACCOUNT_KEY);
  pending.accountKey = accountKey;
  connections.set(accountKey, pending);
  moveInteractionOwnership(PENDING_ACCOUNT_KEY, accountKey);
}

export function readComputerPreviewModel(
  chrome: ComputerPreviewChrome,
  account: { tenantId: string; userId: string } | null,
  extras?: { forceNarrow?: boolean },
): ComputerPreviewModel {
  rememberComputerAccount(account);
  const accountKey = account
    ? accountComputerKey(account.tenantId, account.userId)
    : (activeAccountKey ?? PENDING_ACCOUNT_KEY);
  adoptPendingConnection(accountKey);
  const connection = connections.get(accountKey) ?? null;
  const live = connection && !connection.ended ? connection : null;
  const rawStreamUrl = live?.sessionStreams.get(chrome.sessionKey.trim()) ?? null;
  // Hold connecting UI for MIN_CONNECTING_VISIBLE_MS even when streamUrl is already ready
  // so cold/hard-refresh accept can observe 「正在连接…」 instead of racing to the iframe.
  const holdConnecting =
    Boolean(live?.connectingStartedAt) &&
    Date.now() - (live?.connectingStartedAt ?? 0) < MIN_CONNECTING_VISIBLE_MS &&
    !live?.ended;
  const streamUrl = holdConnecting ? null : rawStreamUrl;
  const hasStream = Boolean(streamUrl);
  const formalStatus =
    holdConnecting && rawStreamUrl
      ? ("STARTING" as ComputerFormalStatus)
      : (connection?.formalStatus ?? null);
  return {
    surface: chrome.sidebarSurface,
    size: chrome.computerPreviewSize,
    parkFrame: Boolean(Boolean(rawStreamUrl) && !chrome.sidebarOpen),
    narrowChat: chrome.computerNarrowChat,
    forceNarrow: extras?.forceNarrow === true,
    connectionId: live?.id ?? connection?.id ?? null,
    mountGeneration: live?.mountGeneration ?? connection?.mountGeneration ?? 0,
    ownsFrame: hasStream,
    controlsDesktop: Boolean(
      live?.userTakeover && live.controlSessionKey === chrome.sessionKey.trim(),
    ),
    streamUrl,
    formalStatus,
    operator: live?.operator ?? null,
    userTakeover: live?.userTakeover === true,
    ended: connection?.ended === true,
    showChip: live?.agentEngaged === true || holdConnecting,
    previewError: live?.previewError ?? null,
    ...(() => {
      const bind = desktopSessionBindFor(chrome.sessionKey, chrome);
      // Iron rule: raw streamUrl notifies STREAM_ATTACHED only (bind enforces).
      if (rawStreamUrl) {
        bind.onStreamUrl(rawStreamUrl);
      }
      const copy = bind.connectingCopy();
      const sessionPhase = bind.runtime.snapshot.phase;
      const controlsDesktop = Boolean(
        live?.userTakeover && live.controlSessionKey === chrome.sessionKey.trim(),
      );
      // Advance GRACE → BACKGROUND_AGENT when due (shared desktop coordinator).
      const priorOwnership = getInteractionOwnership(accountKey);
      const ticked = tickInteractionOwnershipGrace(priorOwnership);
      const ownership =
        ticked.phase !== priorOwnership.phase
          ? (() => {
              const next = dispatchInteractionOwnership(accountKey, { type: "GRACE_ELAPSE" });
              observeOwnershipTransitionForLearning(priorOwnership, next, {
                accountKey,
                sessionPhase,
                pageUrl: live?.remotePageUrl ?? null,
                siteHost: normalizeSiteHost(live?.remotePageUrl),
              });
              return next;
            })()
          : priorOwnership;
      const inputCapability = resolveDesktopInputCapability({
        phase: sessionPhase,
        controlsDesktop,
        surface: chrome.sidebarSurface,
        anomalyOverlay: isAnomalySessionStage(copy.stage),
        ownership,
        sessionKey: chrome.sessionKey.trim(),
        clipboardPermission: getCachedClipboardPermission(),
      });
      return {
        sessionStage: copy.stage,
        sessionConnectingMessage: copy.message,
        sessionReconnectCta: copy.cta,
        sessionReconnectReason: copy.reconnectReason,
        sessionPhase,
        inputCapability,
        ownership,
      };
    })(),
  };
}

export function beginAgentComputerUse(host: ComputerPreviewChrome, agentLabel: string) {
  const alreadyVisible = host.sidebarOpen && host.sidebarSurface === "computer";
  host.sidebarOpen = true;
  host.sidebarSurface = "computer";
  desktopSessionBindFor(host.sessionKey, host).onPreviewOpen();
  if (!alreadyVisible) {
    host.computerPreviewSize = "docked";
    host.computerNarrowChat = false;
  }
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  let connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
  }
  const label = agentLabel.trim() || "Agent";
  connection.agentOperator = { kind: "agent", label };
  connection.agentEngaged = true;
  connection.ended = false;
  if (!connection.formalStatus) {
    connection.formalStatus = "STARTING";
  }
  if (!connection.connectingStartedAt) {
    connection.connectingStartedAt = Date.now();
  }
  if (!connection.userTakeover) {
    connection.operator = connection.agentOperator;
  }
  // Ownership: agent requests interactive lease on shared desktop (#423).
  // Human takeover already holding the desk → request only queues pending.
  const agentId = label;
  dispatchInteractionOwnership(accountKey, {
    type: "AGENT_LEASE_REQUEST",
    agentId,
  });
  if (!connection.userTakeover) {
    dispatchInteractionOwnership(accountKey, { type: "AGENT_LEASE_GRANT" });
  }
  host.computerPreviewRevision += 1;
  scheduleConnectingHoldRefresh(host);
}

/**
 * True when 「打开电脑」 would have been enabled.
 * Selecting the computer tab opens that cold desktop. Size changes must not.
 */
export function computerPreviewNeedsOpen(
  model: Pick<ComputerPreviewModel, "formalStatus" | "streamUrl" | "ended">,
): boolean {
  const live = Boolean(model.streamUrl && !model.ended);
  const starting = model.formalStatus === "STARTING" && !model.ended;
  return !(starting || live);
}

export function selectComputerSurface(
  host: ComputerPreviewChrome,
  surface: ComputerPreviewSurface,
) {
  host.sidebarOpen = true;
  host.sidebarSurface = surface;
  if (surface === "computer") {
    host.computerNarrowChat = false;
  }
  host.computerPreviewRevision += 1;
}

export function selectComputerChip(host: ComputerPreviewChrome) {
  host.sidebarOpen = true;
  host.sidebarSurface = "computer";
  host.computerNarrowChat = false;
  host.computerPreviewRevision += 1;
}

/** Layout only. Size changes the split class and never mints or replaces a stream grant. */
export function setComputerPreviewSize(host: ComputerPreviewChrome, size: ComputerPreviewSize) {
  host.sidebarOpen = true;
  host.sidebarSurface = "computer";
  host.computerPreviewSize = size;
  host.computerNarrowChat = false;
  host.computerPreviewRevision += 1;
}

/** True when this chat has taken over and should receive an input token. */
export function computerSessionRequestsInput(sessionKey: string): boolean {
  const key = sessionKey.trim();
  if (!key || !activeAccountKey) {
    return false;
  }
  const connection = liveConnection(activeAccountKey);
  return Boolean(connection?.userTakeover && connection.controlSessionKey === key);
}

function ensureLiveComputerConnection(): ComputerConnection {
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  let connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
  }
  if (!activeAccountKey) {
    activeAccountKey = accountKey;
  }
  return connection;
}

export function takeoverComputerPreview(
  host: ComputerPreviewChrome,
  userLabel: string,
  opts?: { pageUrl?: string | null; sessionKey?: string },
) {
  const connection = ensureLiveComputerConnection();
  const sessionKey = (opts?.sessionKey ?? host.sessionKey).trim();
  connection.userTakeover = true;
  connection.userYielded = false;
  connection.ended = false;
  connection.controlSessionKey = sessionKey;
  if (sessionKey && pendingExplicitHandbackSession === sessionKey) {
    pendingExplicitHandbackSession = null;
  }
  // Force the next browser.preview open to mint a fresh input token (never keep a
  // stale view-only / revoked grant while the chrome already shows 交还).
  connection.inputGrantLive = false;
  if (sessionKey) {
    connection.issuedMode.delete(sessionKey);
  }
  connection.operator = { kind: "user", label: userLabel.trim() || t("chat.computerYou") };
  if (opts?.pageUrl !== undefined) {
    noteComputerRemotePageUrl(opts.pageUrl);
  }
  // Human preempts any agent interactive lease on this account desktop.
  const accountKey = connection.accountKey;
  const priorOwnership = getInteractionOwnership(accountKey);
  const nextOwnership = dispatchInteractionOwnership(accountKey, {
    type: "HUMAN_TAKEOVER",
    sessionKey,
  });
  // M5: observe only — ownership FSM semantics unchanged.
  const pageUrl = resolveLearningPageUrl(connection, opts?.pageUrl);
  const bind = desktopSessionBindFor(sessionKey || host.sessionKey, host);
  // 给AI → YIELDED is terminal until OPEN. Resume so reminted first_frame can
  // reach INTERACTIVE again; otherwise iframe stays inert while chrome shows 给AI.
  bind.resumeAfterHumanTakeover();
  observeOwnershipTransitionForLearning(priorOwnership, nextOwnership, {
    accountKey,
    sessionPhase: bind.runtime.snapshot.phase,
    pageUrl,
    siteHost: normalizeSiteHost(pageUrl),
  });
  host.computerPreviewRevision += 1;
}

/** Session that clicked「交给AI」— next open plan may notify manual_handback. */
let pendingExplicitHandbackSession: string | null = null;

/** Test-only: clear explicit handback latch between cases. */
export function resetComputerPreviewHandbackForTests() {
  pendingExplicitHandbackSession = null;
}

/** Clear local user takeover so the next open refresh sends releaseControl. */
export function handBackComputerPreview(
  host: ComputerPreviewChrome,
  opts?: {
    pageUrl?: string | null;
    /** Auto gate clear — do not mark explicitHandback. */ silent?: boolean;
  },
) {
  const key = host.sessionKey.trim();
  if (key && !opts?.silent) {
    pendingExplicitHandbackSession = key;
  }
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = liveConnection(accountKey);
  if (connection) {
    connection.userTakeover = false;
    connection.userYielded = true;
    connection.inputGrantLive = false;
    connection.controlSessionKey = null;
    connection.operator = connection.agentOperator;
  }
  if (opts?.pageUrl !== undefined) {
    noteComputerRemotePageUrl(opts.pageUrl);
  }
  // HUMAN_TAKEOVER → GRACE (then BACKGROUND_AGENT on tick).
  const priorOwnership = getInteractionOwnership(accountKey);
  const nextOwnership = dispatchInteractionOwnership(accountKey, { type: "HUMAN_HAND_BACK" });
  const pageUrl = resolveLearningPageUrl(connection, opts?.pageUrl);
  observeOwnershipTransitionForLearning(priorOwnership, nextOwnership, {
    accountKey,
    sessionPhase: desktopSessionBindFor(host.sessionKey, host).runtime.snapshot.phase,
    pageUrl,
    siteHost: normalizeSiteHost(pageUrl),
  });
  host.computerPreviewRevision += 1;
  desktopSessionBindFor(host.sessionKey, host).onYield();
}

export type ComputerPreviewOpenPlan = {
  action: "open" | "status" | "end";
  takeControl: boolean;
  releaseControl: boolean;
  /** True only after explicit「交给AI」— gateway may emit manual_handback. */
  explicitHandback?: boolean;
};

/**
 * Decide the next browser.preview call for this session.
 * Default is AI control: opening the 电脑 tab alone must not takeControl.
 * Human input is claimed only after explicit 接管 / auth handoff (holding).
 * An already-live input grant stays on status so the iframe is not reloaded.
 * 交还 and a secure form stay view-only (releaseControl).
 */
export function computerPreviewOpenPlan(
  host: ComputerPreviewChrome,
  opts: {
    action: "open" | "status" | "end";
    formLocked?: boolean;
    userLabel?: string;
    /** QR/SMS auth gate in progress — hold user control; never ambient-release. */
    authHandoffActive?: boolean;
  },
): ComputerPreviewOpenPlan {
  if (opts.action !== "open") {
    return { action: opts.action, takeControl: false, releaseControl: false };
  }
  const key = host.sessionKey.trim();
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  const live = connection && !connection.ended ? connection : null;
  const holding = Boolean(live?.userTakeover && live.controlSessionKey === key);
  const issuedMode = live?.issuedMode.get(key);
  // Require issuedMode===input so a view-only URL never status-skips after 接管.
  const grantLive = Boolean(
    holding && live?.inputGrantLive && issuedMode === "input" && live.sessionStreams.has(key),
  );
  // Mid-gate QR/SMS wait: keep human input so scan can finish; do not releaseControl
  // (that raced with await_return and forced manual_handback on Zhihu live).
  if (opts.authHandoffActive) {
    if (
      holding &&
      grantLive &&
      !shouldForcePreviewTokenRotate(desktopSessionBindFor(key, host).runtime.snapshot.phase)
    ) {
      return { action: "status", takeControl: false, releaseControl: false };
    }
    return { action: "open", takeControl: true, releaseControl: false };
  }
  // A pending secure form stays view-only. Explicit 接管 clears the form first,
  // so this branch does not see formLocked on that click.
  if (opts.formLocked) {
    return { action: "open", takeControl: false, releaseControl: true };
  }
  // Product: default AI takeover. Do not claim input merely because 电脑 is open
  // or because a prior handoff left userYielded=false without 交给AI.
  const wantsInput = holding;
  const sessionPhase = desktopSessionBindFor(key, host).runtime.snapshot.phase;
  // Healthy live input grant → status. Anomaly / AUTH_EXPIRED must open to rotate token.
  if (wantsInput && grantLive && !shouldForcePreviewTokenRotate(sessionPhase)) {
    return { action: "status", takeControl: false, releaseControl: false };
  }
  // M3: healthy INTERACTIVE + existing stream → status (no open churn / token rotate).
  // Still open+takeControl when input is wanted but grant is not live.
  if (
    shouldSkipHealthyInteractivePreviewOpen(sessionPhase) &&
    Boolean(live?.sessionStreams.has(key)) &&
    live?.formalStatus === "READY" &&
    !(wantsInput && !grantLive)
  ) {
    return { action: "status", takeControl: false, releaseControl: false };
  }
  if (wantsInput) {
    return { action: "open", takeControl: true, releaseControl: false };
  }
  const explicitHandback = pendingExplicitHandbackSession === key;
  if (explicitHandback) {
    pendingExplicitHandbackSession = null;
  }
  return {
    action: "open",
    takeControl: false,
    releaseControl: true,
    ...(explicitHandback ? { explicitHandback: true } : {}),
  };
}

/** True when this session already holds takeover and needs an input grant refresh. */
export function computerPreviewNeedsInputClaim(
  host: ComputerPreviewChrome,
  opts?: { formLocked?: boolean; authHandoffActive?: boolean },
): boolean {
  return computerPreviewOpenPlan(host, {
    action: "open",
    formLocked: opts?.formLocked,
    authHandoffActive: opts?.authHandoffActive,
  }).takeControl;
}

/** Mark this session as the desktop operator before the input URL returns. */
export function noteComputerPreviewInputClaim(host: ComputerPreviewChrome, userLabel: string) {
  takeoverComputerPreview(host, userLabel);
}

/**
 * Drop a local input claim without counting it as 交还.
 * Used when a secure form must keep the picture view-only.
 */
export function suspendComputerPreviewInput(host: ComputerPreviewChrome) {
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = liveConnection(accountKey);
  if (!connection) {
    return;
  }
  connection.userTakeover = false;
  connection.inputGrantLive = false;
  connection.controlSessionKey = null;
  connection.operator = connection.agentOperator;
  host.computerPreviewRevision += 1;
}

export function returnComputerToChat(host: ComputerPreviewChrome) {
  host.computerNarrowChat = true;
  host.computerPreviewRevision += 1;
}

export function endComputerPreview(host: ComputerPreviewChrome) {
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  if (connection) {
    connection.ended = true;
    connection.sessionStreams.clear();
    connection.issuedMode.clear();
    connection.formalStatus = "DISCONNECTED";
    connection.mountGeneration += 1;
    connection.agentEngaged = false;
    connection.userTakeover = false;
    connection.userYielded = false;
    connection.inputGrantLive = false;
    connection.controlSessionKey = null;
    connection.operator = null;
  }
  dispatchInteractionOwnership(accountKey, { type: "RESET" });
  host.computerPreviewSize = "docked";
  host.computerNarrowChat = false;
  host.computerPreviewRevision += 1;
}

export function adoptComputerAccount(tenantId: string, userId: string): string {
  const next = accountComputerKey(tenantId, userId);
  if (activeAccountKey === next) {
    return next;
  }
  const previousKey = activeAccountKey;
  const previous = previousKey ? connections.get(previousKey) : undefined;
  const existing = connections.get(next);
  if (existing && !existing.ended && existing !== previous) {
    if (previousKey) {
      // Always migrate ownership (human-wins merge) before abandoning the old key.
      moveInteractionOwnership(previousKey, next);
      connections.delete(previousKey);
    }
    activeAccountKey = next;
    return next;
  }
  if (previous && previousKey && !previous.ended) {
    connections.delete(previousKey);
    previous.accountKey = next;
    connections.set(next, previous);
    moveInteractionOwnership(previousKey, next);
  }
  activeAccountKey = next;
  return next;
}

export function applyServerComputerPreview(input: {
  tenantId: string;
  userId: string;
  sessionKey: string;
  action: "open" | "status" | "end";
  status: ComputerFormalStatus | "COLD";
  streamUrl?: string | null;
  /** Server reason when the desktop cannot start. Shown instead of the cold stage. */
  failure?: string | null;
  controlledBy?: ComputerOperator | null;
  /** True when this open asked the server for an input token. */
  grantsInput?: boolean;
  /** Forward-compatible remote page URL for takeover learning siteHost. */
  pageUrl?: string | null;
}) {
  const accountKey = adoptComputerAccount(input.tenantId, input.userId);
  adoptPendingConnection(accountKey);
  moveInteractionOwnership(PENDING_ACCOUNT_KEY, accountKey);
  let connection = connections.get(accountKey);
  if (input.action === "end" || input.status === "DISCONNECTED") {
    if (!connection) {
      connection = createConnection(accountKey);
      connections.set(accountKey, connection);
    }
    const wasLive =
      connection.sessionStreams.size > 0 ||
      connection.formalStatus === "READY" ||
      connection.formalStatus === "STARTING" ||
      connection.formalStatus === "REAUTH_REQUIRED";
    connection.ended = true;
    connection.sessionStreams.clear();
    connection.issuedMode.clear();
    connection.formalStatus = "DISCONNECTED";
    connection.agentEngaged = false;
    connection.mountGeneration += 1;
    const bind = desktopSessionBindFor(input.sessionKey?.trim() || "default");
    if (wasLive && input.status === "DISCONNECTED" && input.action !== "end") {
      bind.noteSessionLost();
    }
    bind.onEnd();
    return;
  }
  if (!connection || connection.ended) {
    if (input.status === "COLD" && input.action !== "open" && !input.failure?.trim()) {
      return;
    }
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
  }
  const failure = input.failure?.trim() ?? "";
  if (failure) {
    connection.ended = false;
    connection.formalStatus = "STARTING";
    connection.previewError = failure;
  }
  if (input.status === "COLD") {
    if (input.action === "open" && !failure) {
      connection.formalStatus = null;
      connection.ended = false;
    }
    return;
  }
  if (failure) {
    return;
  }
  connection.ended = false;
  connection.formalStatus = input.status;
  if (input.pageUrl !== undefined) {
    const sanitized = sanitizeComputerRemotePageUrl(input.pageUrl);
    if (sanitized) {
      connection.remotePageUrl = sanitized;
    }
  }
  if (!connection.connectingStartedAt && (input.action === "open" || input.status === "STARTING")) {
    connection.connectingStartedAt = Date.now();
  }
  {
    const bind = desktopSessionBindFor(input.sessionKey?.trim() || "default");
    if (input.action === "open" || input.status === "STARTING" || input.status === "READY") {
      bind.onPreviewOpen();
    }
    if (input.status === "REAUTH_REQUIRED") {
      bind.noteAuthExpired();
    }
    if (input.streamUrl) {
      bind.onStreamUrl(input.streamUrl);
    }
  }
  if (input.streamUrl) {
    connection.previewError = null;
    connection.streamRetryAttempt = 0;
    const key = input.sessionKey.trim();
    const next = input.grantsInput ? "input" : "view";
    const previousUrl = connection.sessionStreams.get(key);
    // Each browser.preview open mints a one-shot token. Always adopt a new URL
    // (view or input) so a remount never reuses a consumed grant. Identical URL
    // keeps the iframe (no reload).
    connection.issuedMode.set(key, next);
    if (!previousUrl || previousUrl !== input.streamUrl) {
      connection.sessionStreams.set(key, input.streamUrl);
    }
    connection.inputGrantLive = next === "input";
  }
  if (input.controlledBy && !connection.userTakeover) {
    if (input.controlledBy.kind === "agent") {
      connection.agentOperator = input.controlledBy;
      connection.agentEngaged = true;
    }
    connection.operator = input.controlledBy;
  }
}

export function attachComputerSession(params: {
  tenantId: string;
  userId: string;
  sessionKey: string;
  agentLabel?: string;
}): { connectionId: string; streamUrl: string | null; ownsFrame: boolean; created: boolean } {
  const accountKey = accountComputerKey(params.tenantId, params.userId);
  activeAccountKey = accountKey;
  let created = false;
  let connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
    created = true;
  }
  if (params.agentLabel?.trim()) {
    connection.agentOperator = { kind: "agent", label: params.agentLabel.trim() };
    connection.agentEngaged = true;
    connection.ended = false;
    if (!connection.userTakeover) {
      connection.operator = connection.agentOperator;
    }
    if (!connection.formalStatus) {
      connection.formalStatus = "STARTING";
    }
  }
  const streamUrl = connection.sessionStreams.get(params.sessionKey.trim()) ?? null;
  return {
    connectionId: connection.id,
    streamUrl,
    ownsFrame: Boolean(streamUrl),
    created,
  };
}

export function messageUsesBrowserTool(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as Record<string, unknown>;
  const direct = record.toolName ?? record.tool_name;
  if (direct === "browser") {
    return true;
  }
  return extractToolCards(message).some((card) => card.kind === "call" && card.name === "browser");
}

/** Keep 「正在连接…」 on screen long enough for accept / cold UI to observe. */
/** Assistant/user text that claims Account Computer / 云电脑 is in play. */
export function messageClaimsAccountComputer(message: unknown): boolean {
  if (!message || typeof message !== "object") {
    return false;
  }
  const record = message as Record<string, unknown>;
  const chunks: string[] = [];
  if (typeof record.content === "string") {
    chunks.push(record.content);
  } else if (Array.isArray(record.content)) {
    for (const block of record.content) {
      if (!block || typeof block !== "object") {
        continue;
      }
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") {
        chunks.push(text);
      }
    }
  }
  if (typeof record.text === "string") {
    chunks.push(record.text);
  }
  const joined = chunks.join("\n");
  return /打开云电脑|云电脑|电脑\s*Tab|「电脑」|在云电脑|已打开电脑|正在连接云电脑|Account Computer/i.test(
    joined,
  );
}

export function messageTriggersComputerPreview(message: unknown): boolean {
  return messageUsesBrowserTool(message) || messageClaimsAccountComputer(message);
}

export type SyncComputerPreviewFromMessagesOptions = {
  /**
   * Cold Control UI / hard refresh may focus 电脑 from history.
   * Nav session switch must leave this unset: `loadChatHistory` then must not
   * call `noteBrowserComputerUse` / `beginAgentComputerUse`.
   */
  forceOpen?: boolean;
};

/**
 * History scan for browser tools or 云电脑 copy.
 *
 * `forceOpen` is only for cold Control UI / hard refresh. Sidebar navigation
 * (`runWorkbenchNavSelection` → `switchEmployeeWorkbenchSession` →
 * `loadChatHistory`) must omit it. A closed dock stays closed; an already-open
 * dock is refreshed by `syncComputerPreviewAfterSessionSwitch`, not here.
 * Live turns still open via `noteBrowserComputerUse` / `beginAgentComputerUse`.
 */
export function syncComputerPreviewFromMessages(
  state: object,
  messages: unknown[] | undefined,
  options?: SyncComputerPreviewFromMessagesOptions,
): boolean {
  if (options?.forceOpen !== true) {
    return false;
  }
  if (!Array.isArray(messages) || messages.length === 0) {
    return false;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (messageTriggersComputerPreview(message)) {
      return noteBrowserComputerUse(state, message);
    }
  }
  return false;
}

function scheduleConnectingHoldRefresh(host: ComputerPreviewChrome) {
  const key = host.sessionKey.trim() || "default";
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  if (!connection || connection.ended || !connection.connectingStartedAt) {
    return;
  }
  const elapsed = Date.now() - connection.connectingStartedAt;
  const remaining = MIN_CONNECTING_VISIBLE_MS - elapsed;
  const existing = connectingHoldTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    connectingHoldTimers.delete(key);
  }
  if (remaining <= 0) {
    host.computerPreviewRevision += 1;
    return;
  }
  const timer = setTimeout(() => {
    connectingHoldTimers.delete(key);
    host.computerPreviewRevision += 1;
  }, remaining);
  connectingHoldTimers.set(key, timer);
}

const STREAM_RETRY_DELAYS_MS = [300, 600, 1200, 2000, 3000, 5000, 8000];
const streamRetryTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function clearComputerPreviewStreamRetries() {
  for (const timer of streamRetryTimers.values()) {
    clearTimeout(timer);
  }
  streamRetryTimers.clear();
  for (const timer of connectingHoldTimers.values()) {
    clearTimeout(timer);
  }
  connectingHoldTimers.clear();
}

/** True when the dock is open on computer but still waiting for a noVNC streamUrl. */
export function computerPreviewNeedsStreamRetry(
  model: Pick<ComputerPreviewModel, "streamUrl" | "ended" | "formalStatus" | "showChip">,
): boolean {
  if (model.ended || model.streamUrl) {
    return false;
  }
  if (model.formalStatus === "DISCONNECTED") {
    return false;
  }
  return (
    model.formalStatus === "STARTING" ||
    model.formalStatus === "READY" ||
    model.formalStatus === "REAUTH_REQUIRED" ||
    model.showChip
  );
}

export function noteComputerPreviewStreamError(message: string, sessionKey?: string) {
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  let connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    connection = createConnection(accountKey);
    connections.set(accountKey, connection);
  }
  const trimmed = message.trim() || "preview failed";
  connection.previewError = trimmed;
  const key = (sessionKey ?? "").trim() || "default";
  const bind = desktopSessionBindFor(key);
  if (/network|offline|timeout|ECONN|ENOTFOUND|failed to fetch/i.test(trimmed)) {
    bind.noteNetworkDegraded();
  } else {
    bind.onPreviewFailed();
  }
}

export function clearComputerPreviewStreamError() {
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  if (connection) {
    connection.previewError = null;
  }
}

/**
 * Retry browser.preview while the stage is connecting without a stream.
 * Caps attempts; clears itself once a streamUrl lands or the computer ends.
 */
export function scheduleComputerPreviewStreamRetry(
  host: ComputerPreviewChrome & {
    syncAccountComputerPreview?: () => void;
    refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
  },
  opts?: { reset?: boolean },
) {
  const key = host.sessionKey.trim() || "default";
  const accountKey = activeAccountKey ?? PENDING_ACCOUNT_KEY;
  const connection = connections.get(accountKey);
  if (!connection || connection.ended) {
    return;
  }
  if (opts?.reset) {
    connection.streamRetryAttempt = 0;
  }
  const existing = streamRetryTimers.get(key);
  if (existing) {
    clearTimeout(existing);
    streamRetryTimers.delete(key);
  }
  const model = readComputerPreviewModel(host, null);
  if (!computerPreviewNeedsStreamRetry(model)) {
    connection.streamRetryAttempt = 0;
    return;
  }
  const attempt = connection.streamRetryAttempt;
  if (attempt >= STREAM_RETRY_DELAYS_MS.length) {
    // Cap reached: never leave a permanent white/connecting stage.
    if (!connection.previewError) {
      connection.previewError = "gave-up";
    }
    host.computerPreviewRevision += 1;
    return;
  }
  const delay = STREAM_RETRY_DELAYS_MS[attempt] ?? 5000;
  connection.streamRetryAttempt = attempt + 1;
  const timer = setTimeout(() => {
    streamRetryTimers.delete(key);
    const live = connections.get(accountKey);
    if (!live || live.ended) {
      return;
    }
    const next = readComputerPreviewModel(host, null);
    if (!computerPreviewNeedsStreamRetry(next)) {
      live.streamRetryAttempt = 0;
      return;
    }
    if (typeof host.syncAccountComputerPreview === "function") {
      host.syncAccountComputerPreview();
    } else if (
      typeof (host as { refreshAccountComputerPreview?: (a: "open") => void })
        .refreshAccountComputerPreview === "function"
    ) {
      void (
        host as { refreshAccountComputerPreview: (a: "open") => void | Promise<void> }
      ).refreshAccountComputerPreview("open");
    }
    scheduleComputerPreviewStreamRetry(host);
  }, delay);
  streamRetryTimers.set(key, timer);
}

/**
 * After switching chat/agent while 电脑 is already open: mint a per-session
 * streamUrl. Shared Account Computer (#423) keeps one desktop, but sessionStreams
 * is keyed by sessionKey — without this, Skill孵化 stays on 「正在连接…」 while a
 * sibling bot already paints.
 */
export function syncComputerPreviewAfterSessionSwitch(
  host: ComputerPreviewChrome & {
    syncAccountComputerPreview?: () => void;
    refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
  },
): void {
  if (!host.sidebarOpen || host.sidebarSurface !== "computer") {
    return;
  }
  const syncHost = host as ComputerPreviewChrome & {
    syncAccountComputerPreview?: () => void;
    refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
  };
  if (typeof syncHost.syncAccountComputerPreview === "function") {
    syncHost.syncAccountComputerPreview();
  } else if (typeof syncHost.refreshAccountComputerPreview === "function") {
    void syncHost.refreshAccountComputerPreview("open");
  }
  scheduleComputerPreviewStreamRetry(syncHost, { reset: true });
}

export function noteBrowserComputerUse(state: object, message: unknown): boolean {
  if (!messageTriggersComputerPreview(message)) {
    return false;
  }
  if (!("sidebarSurface" in state) || !("sidebarOpen" in state) || !("sessionKey" in state)) {
    return false;
  }
  const host = state as ComputerPreviewChrome;
  const record = message as Record<string, unknown>;
  const fromMessage = typeof record.senderLabel === "string" ? record.senderLabel.trim() : "";
  const fromHost = host.assistantName?.trim() ?? "";
  beginAgentComputerUse(host, fromMessage || fromHost || "Agent");
  const syncHost = state as {
    syncAccountComputerPreview?: () => void;
    refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
  };
  if (typeof syncHost.syncAccountComputerPreview === "function") {
    syncHost.syncAccountComputerPreview();
  } else if (typeof syncHost.refreshAccountComputerPreview === "function") {
    void syncHost.refreshAccountComputerPreview("open");
  }
  scheduleComputerPreviewStreamRetry(
    host as ComputerPreviewChrome & {
      syncAccountComputerPreview?: () => void;
      refreshAccountComputerPreview?: (action: "open" | "status" | "end") => void | Promise<void>;
    },
    { reset: true },
  );
  return true;
}

export function selectArtifactPreviewSurface(host: object) {
  if (!("sidebarSurface" in host)) {
    return;
  }
  (host as { sidebarSurface: ComputerPreviewSurface }).sidebarSurface = "artifact";
}

export function renderComputerPreviewTabs(
  model: ComputerPreviewModel,
  onSelect?: (surface: ComputerPreviewSurface) => void,
): TemplateResult {
  const select = (surface: ComputerPreviewSurface) => (event: Event) => {
    event.preventDefault();
    onSelect?.(surface);
  };
  return html`
    <div class="sidebar-tabs" role="tablist" aria-label=${t("chat.computerTitle")}>
      <button
        type="button"
        class="sidebar-tab"
        role="tab"
        data-testid="artifact-tab"
        aria-selected=${model.surface === "artifact" ? "true" : "false"}
        @click=${select("artifact")}
      >
        ${t("chat.artifactTab")}
      </button>
      <button
        type="button"
        class="sidebar-tab"
        role="tab"
        data-testid="computer-tab"
        aria-selected=${model.surface === "computer" ? "true" : "false"}
        @click=${select("computer")}
      >
        ${t("chat.computerTab")}
      </button>
    </div>
  `;
}

export type ComputerSessionIdentity = {
  name?: string | null;
  avatar?: string | null;
  /** This conversation's agent id. Operator labels that equal it are not display names. */
  agentId?: string | null;
};

/** Roster row used to turn a shared-computer owner id into the name shown in chat. */
export type ComputerAgentRosterEntry = {
  id: string;
  name?: string | null;
  identity?: {
    name?: string | null;
    avatar?: string | null;
    avatarUrl?: string | null;
  } | null;
};

export type ComputerOperatorDisplay = {
  kind: "agent" | "user";
  name: string;
  avatar: string | null;
};

function computerAvatarIsUrl(value: string): boolean {
  return /^https?:\/\//i.test(value) || /^data:image\//i.test(value) || value.startsWith("/");
}

function labelsMatch(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/** Default agent id and the trunk branch token are not names users see in chat. */
function isBareAgentToken(label: string): boolean {
  return label.trim().toLowerCase() === "main";
}

/** Gateway/UI DEFAULT "Assistant" is a placeholder, not a real bot display name. */
function isDefaultAssistantPlaceholder(label: string): boolean {
  return label.trim().toLocaleLowerCase() === DEFAULT_ASSISTANT_NAME.toLocaleLowerCase();
}

function isDefaultAssistantAvatar(avatar: string | null | undefined): boolean {
  return (avatar?.trim() ?? "") === DEFAULT_ASSISTANT_AVATAR;
}

/**
 * Same order as sidebar `agentDisplayName`: identity.name || name.
 * Returns null when only bare id / DEFAULT placeholder remains.
 */
function rosterFace(
  entry: ComputerAgentRosterEntry,
): { name: string; avatar: string | null } | null {
  const name = entry.identity?.name?.trim() || entry.name?.trim() || "";
  if (
    !name ||
    isBareAgentToken(name) ||
    isDefaultAssistantPlaceholder(name) ||
    labelsMatch(name, entry.id)
  ) {
    return null;
  }
  const avatar = entry.identity?.avatarUrl?.trim() || entry.identity?.avatar?.trim() || null;
  return {
    name,
    avatar: avatar && !isDefaultAssistantAvatar(avatar) ? avatar : null,
  };
}

function findRosterEntry(
  roster: readonly ComputerAgentRosterEntry[] | null | undefined,
  agentId: string,
): ComputerAgentRosterEntry | undefined {
  const id = agentId.trim();
  if (!id) {
    return undefined;
  }
  return roster?.find((agent) => agent.id.trim() && labelsMatch(agent.id, id));
}

/**
 * Who the chrome should name.
 * Product: always show the **open conversation bot** (header icon + name),
 * including during user takeover. Never render `computerYou` 「你」 as the
 * operator pill (initial + name would read as 「你 你」). 「交还」 stays a
 * separate header action driven by `controlsDesktop` (this session holds input).
 * When the session has no display name, fall back to roster / operator label
 * for agents only — never to 「你」.
 */
export function resolveComputerOperatorDisplay(
  model: Pick<ComputerPreviewModel, "operator">,
  session?: ComputerSessionIdentity | null,
  roster?: readonly ComputerAgentRosterEntry[] | null,
): ComputerOperatorDisplay | null {
  const sessionName = session?.name?.trim() ?? "";
  const sessionAvatarRaw = session?.avatar?.trim() || null;
  const sessionAvatar =
    sessionAvatarRaw && !isDefaultAssistantAvatar(sessionAvatarRaw) ? sessionAvatarRaw : null;
  const sessionAgentId = session?.agentId?.trim() ?? "";
  // DEFAULT "Assistant" must not short-circuit roster — sidebar may still have agent.name.
  const usableSessionName =
    sessionName && !isBareAgentToken(sessionName) && !isDefaultAssistantPlaceholder(sessionName)
      ? sessionName
      : "";

  // Open bot wins over takeover 「你」 and over another agent id on the desktop.
  if (usableSessionName) {
    return { kind: "agent", name: usableSessionName, avatar: sessionAvatar };
  }

  // Session fell through to missing / bare / DEFAULT: prefer this chat's roster row
  // (identity.name || name) — same chain as sidebar agentDisplayName.
  const sessionRosterEntry = findRosterEntry(roster, sessionAgentId);
  const sessionRosterFace = sessionRosterEntry ? rosterFace(sessionRosterEntry) : null;
  if (sessionRosterFace) {
    return {
      kind: "agent",
      name: sessionRosterFace.name,
      avatar: sessionRosterFace.avatar ?? sessionAvatar,
    };
  }

  // No session display name: never show computerYou / user pill.
  if (model.operator?.kind === "user") {
    return null;
  }

  const raw = model.operator?.label.trim() ?? "";
  const rosterEntry = raw ? findRosterEntry(roster, raw) : undefined;
  const fromRoster = rosterEntry ? rosterFace(rosterEntry) : null;
  const ownsThisChat =
    !model.operator ||
    !raw ||
    (sessionAgentId !== "" && labelsMatch(raw, sessionAgentId)) ||
    (isBareAgentToken(raw) &&
      (sessionAgentId === "" ||
        isBareAgentToken(sessionAgentId) ||
        labelsMatch(raw, sessionAgentId)));

  if (fromRoster && !ownsThisChat) {
    return { kind: "agent", name: fromRoster.name, avatar: fromRoster.avatar };
  }
  if (fromRoster) {
    return { kind: "agent", name: fromRoster.name, avatar: fromRoster.avatar };
  }
  // Session already tried DEFAULT/bare and roster; do not paint agent id / DEFAULT as a name.
  if (
    raw &&
    !isBareAgentToken(raw) &&
    !isDefaultAssistantPlaceholder(raw) &&
    !(sessionAgentId && labelsMatch(raw, sessionAgentId))
  ) {
    return { kind: "agent", name: raw, avatar: null };
  }
  return null;
}

function operatorInitial(name: string): string {
  return Array.from(name.trim())[0] ?? "";
}

export function renderComputerOperatorMark(
  model: ComputerPreviewModel,
  session?: ComputerSessionIdentity | null,
  roster?: readonly ComputerAgentRosterEntry[] | null,
): TemplateResult | null {
  const display = resolveComputerOperatorDisplay(model, session, roster);
  if (!display) {
    return null;
  }
  const avatar = display.avatar;
  const initial = operatorInitial(display.name);
  const avatarIsUrl = Boolean(avatar && computerAvatarIsUrl(avatar));
  // Single-grapheme names must not render as 「X X」 (initial + full name).
  const showNameBesideMark =
    avatarIsUrl || (avatar ? avatar !== display.name : initial !== display.name);
  const mark = avatarIsUrl
    ? html`<img
        class="computer-operator__mark"
        data-testid="computer-operator-avatar"
        src=${avatar!}
        alt=""
      />`
    : html`<span
        class="computer-operator__mark"
        data-testid="computer-operator-avatar"
        aria-hidden="true"
        >${avatar || initial}</span
      >`;
  return html`
    <div
      class="computer-operator computer-operator--${display.kind}"
      data-testid="computer-operator"
      data-operator-kind=${display.kind}
      title=${display.name}
      aria-label=${t("chat.computerOperator", { name: display.name })}
    >
      ${mark}
      ${
        showNameBesideMark
          ? html`<span class="computer-operator__name">${display.name}</span>`
          : nothing
      }
    </div>
  `;
}

/** postMessage source the noVNC observer accepts for cloud-desktop commands. */
export const COMPUTER_PREVIEW_CONTROL_SOURCE = "openbot-control-ui";

type ShowDesktopWindow = Window & { __openbotShowDesktop?: () => void };

function computerFrameArea(frame: HTMLIFrameElement): number {
  const rect = frame.getClientRects();
  if (rect.length === 0) {
    return 0;
  }
  return Math.max(0, rect[0].width) * Math.max(0, rect[0].height);
}

/** The live computer iframe. Skip inert and 1px parked copies so they do not eat the click. */
export function computerShowDesktopFrame(): HTMLIFrameElement | null {
  const frames = [...document.querySelectorAll("[data-testid=computer-frame]")].filter(
    (node): node is HTMLIFrameElement => node instanceof HTMLIFrameElement,
  );
  const usable = frames.filter((frame) => !frame.hasAttribute("inert"));
  const pool = usable.length > 0 ? usable : frames;
  let best: HTMLIFrameElement | null = null;
  let bestArea = 0;
  for (const frame of pool) {
    const area = computerFrameArea(frame);
    if (area > bestArea) {
      best = frame;
      bestArea = area;
    }
  }
  return best ?? pool[0] ?? null;
}

/** Ask the preview iframe to unmap cloud apps and bring the dock back. */
export function postComputerShowDesktop(target: Window | null | undefined): void {
  if (!target) {
    return;
  }
  try {
    const hook = (target as ShowDesktopWindow).__openbotShowDesktop;
    if (typeof hook === "function") {
      hook();
      return;
    }
  } catch {
    // Cross-origin frames hide the hook. postMessage is the fallback.
  }
  try {
    target.postMessage({ source: COMPUTER_PREVIEW_CONTROL_SOURCE, type: "show_desktop" }, "*");
  } catch {
    // Detached frame.
  }
}

function requestComputerShowDesktop(): void {
  const frame = computerShowDesktopFrame();
  postComputerShowDesktop(frame?.contentWindow ?? null);
}

function renderChromeAction(options: {
  testId: string;
  label: string;
  className?: string;
  disabled?: boolean;
  title?: string;
  onClick?: () => void;
}): TemplateResult {
  return html`
    <button
      type="button"
      class="btn btn--sm sidebar-tab-action ${options.className ?? ""}"
      data-testid=${options.testId}
      ?disabled=${options.disabled === true}
      title=${options.title ?? options.label}
      @click=${(event: Event) => {
        event.preventDefault();
        if (options.disabled) {
          return;
        }
        options.onClick?.();
      }}
    >
      ${options.label}
    </button>
  `;
}

export function renderComputerPreviewHeaderActions(
  model: ComputerPreviewModel,
  actions: {
    onSetSize?: (size: ComputerPreviewSize) => void;
    onTakeover?: () => void;
    onHandBack?: () => void;
    /** Kept so existing callers compile. The chrome no longer renders these controls. */
    onOpen?: () => void;
    onEnd?: () => void;
    onNarrowReturn?: () => void;
  },
): TemplateResult | null {
  // Fullscreen is the picture. 返回桌面 / 全屏 / 给AI stay on the docked bar.
  // 退出全屏 is the stage-header control. 关闭预览 closes the sidebar only when docked.
  if (model.size === "fullscreen") {
    return null;
  }
  // Only this chat session's input grant — never sibling userTakeover on the shared PC.
  const showHandBack = model.controlsDesktop;
  const fullscreenEnabled =
    model.inputCapability?.fullscreen !== false && model.surface === "computer";
  const fullscreenLabel = t("chat.computerFullscreen");
  // Order: 返回桌面, 全屏, 给AI or 接管. 关闭预览 is the sidebar close.
  return html`
    ${renderChromeAction({
      testId: "computer-show-desktop",
      label: t("chat.computerShowDesktop"),
      title: t("chat.computerShowDesktopHint"),
      onClick: requestComputerShowDesktop,
    })}
    <button
      type="button"
      class="btn btn--sm sidebar-tab-action"
      data-testid="computer-fullscreen"
      data-fullscreen="false"
      data-input-fullscreen=${fullscreenEnabled ? "true" : "false"}
      aria-pressed="false"
      ?disabled=${!fullscreenEnabled}
      title=${fullscreenLabel}
      @click=${(event: Event) => {
        event.preventDefault();
        if (!fullscreenEnabled) {
          return;
        }
        actions.onSetSize?.(toggleComputerFullscreenSize(model.size));
      }}
    >
      ${fullscreenLabel}
    </button>
    ${
      showHandBack
        ? renderChromeAction({
            testId: "computer-handback",
            label: t("chat.computerHandBack"),
            onClick: actions.onHandBack,
          })
        : renderChromeAction({
            testId: "computer-takeover",
            label: t("chat.computerTakeover"),
            onClick: actions.onTakeover,
          })
    }
  `;
}

export function renderComputerPreviewBody(
  model: ComputerPreviewModel,
  actions?: {
    onReconnectStream?: (reason?: "network" | "stream" | "credential") => void;
    /** Same-origin iframe painted Invalid/expired token — rotate via credential reconnect. */
    onStreamCredentialInvalid?: () => void;
  },
): TemplateResult {
  const showFrame = Boolean(model.streamUrl && !model.ended);
  const anomalyStages = new Set(["stalled", "failed", "auth", "lost", "degraded", "reconnecting"]);
  const isAnomaly = anomalyStages.has(model.sessionStage ?? "");
  const ownership = model.ownership ?? null;
  const inputCapability =
    model.inputCapability ??
    resolveDesktopInputCapability({
      phase: model.sessionPhase ?? null,
      controlsDesktop: model.controlsDesktop,
      surface: model.surface,
      anomalyOverlay: isAnomaly,
      ownership,
      // Prefer humanSessionKey from ownership when model was not pre-gated.
      sessionKey: ownership?.humanSessionKey ?? null,
      clipboardPermission: getCachedClipboardPermission(),
    });
  // Use resolved capability — do not re-gate with a missing sessionKey.
  const blockDesktop = !inputCapability.pointer;
  const inputAttrs = inputCapabilityDataAttrs(inputCapability);
  const ownAttrs = ownership ? ownershipDataAttrs(ownership) : null;
  const learningAttrs = takeoverLearningDataAttrs(getActiveTakeoverEpisode(activeAccountKey ?? ""));
  const cold =
    !showFrame &&
    !model.previewError &&
    (!model.formalStatus || model.formalStatus === "DISCONNECTED");
  // STARTING / READY / REAUTH without a stream must never paint an empty white stage
  // (connectingBlock below covers those formal statuses when the iframe is not yet shown).
  const operatorFailure =
    model.previewError &&
    model.previewError !== "gave-up" &&
    model.previewError !== "preview failed"
      ? model.previewError
      : null;
  const stageMessage =
    operatorFailure ||
    model.sessionConnectingMessage?.trim() ||
    (!model.previewError
      ? t("chat.computerConnecting")
      : model.previewError === "gave-up"
        ? t("chat.computerConnectGaveUp")
        : t("chat.computerConnectFailed"));
  const connectingMessage = operatorFailure
    ? operatorFailure
    : model.previewError
      ? model.previewError === "gave-up"
        ? t("chat.computerConnectGaveUp")
        : t("chat.computerConnectFailed")
      : stageMessage;
  const reconnectCta =
    model.sessionReconnectCta?.trim() ||
    (model.previewError === "gave-up" ? t("chat.computerReconnectCta") : null);
  const showReconnect = Boolean(reconnectCta) && (Boolean(model.previewError) || isAnomaly);
  const reconnectReason = model.sessionReconnectReason ?? "stream";
  const onReconnectClick = () => actions?.onReconnectStream?.(reconnectReason);
  const reconnectButton = showReconnect
    ? html`
      <button
        type="button"
        class="computer-preview__reconnect"
        data-testid="computer-reconnect"
        data-reconnect-reason=${reconnectReason}
        @click=${onReconnectClick}
      >
        ${reconnectCta}
      </button>
    `
    : nothing;
  const connectingBlock = html`
    <div
      class="computer-preview__connecting"
      data-testid="computer-connecting"
      data-preview-error=${model.previewError ? "true" : "false"}
      data-session-stage=${model.sessionStage ?? ""}
    >
      <p>${connectingMessage}</p>
      ${reconnectButton}
    </div>
  `;
  // Blocking fix: keep anomaly CTA visible even while the iframe is mounted.
  const anomalyOverlay =
    showFrame && isAnomaly
      ? html`
        <div
          class="computer-preview__anomaly-overlay"
          data-testid="computer-anomaly-overlay"
          data-session-stage=${model.sessionStage ?? ""}
          style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;background:rgba(20,20,24,0.72);color:#f5f5f7;padding:16px;text-align:center;z-index:2;"
        >
          <p>${connectingMessage}</p>
          ${reconnectButton}
        </div>
      `
      : nothing;
  return html`
    <div class="computer-preview" data-connection-id=${model.connectionId ?? ""}>
      <div
        class="computer-preview__stage"
        data-testid="computer-stage"
        data-controlling=${model.controlsDesktop ? "true" : "false"}
        data-session-stage=${model.sessionStage ?? ""}
        data-session-phase=${model.sessionPhase ?? ""}
        data-session-interactive=${model.sessionPhase === "INTERACTIVE" ? "true" : "false"}
        data-input-keyboard=${inputAttrs["data-input-keyboard"]}
        data-input-pointer=${inputAttrs["data-input-pointer"]}
        data-input-fullscreen=${inputAttrs["data-input-fullscreen"]}
        data-input-clipboard=${inputAttrs["data-input-clipboard"]}
        data-ownership-phase=${ownAttrs?.["data-ownership-phase"] ?? ""}
        data-ownership-keyboard=${ownAttrs?.["data-ownership-keyboard"] ?? ""}
        data-ownership-mouse=${ownAttrs?.["data-ownership-mouse"] ?? ""}
        data-ownership-clipboard=${ownAttrs?.["data-ownership-clipboard"] ?? ""}
        data-ownership-navigation=${ownAttrs?.["data-ownership-navigation"] ?? ""}
        data-takeover-learning=${learningAttrs["data-takeover-learning"]}
        data-takeover-site-host=${learningAttrs["data-takeover-site-host"]}
        style="position: relative;"
        @paste=${(event: ClipboardEvent) => {
          onComputerClipboardUserGesture(
            event,
            inputCapability.clipboard,
            inputCapability.keyboard,
          );
        }}
        @copy=${(event: ClipboardEvent) => {
          onComputerClipboardUserGesture(
            event,
            inputCapability.clipboard,
            inputCapability.keyboard,
          );
        }}
        @cut=${(event: ClipboardEvent) => {
          onComputerClipboardUserGesture(
            event,
            inputCapability.clipboard,
            inputCapability.keyboard,
          );
        }}
      >
        ${
          cold
            ? html`
              <div class="computer-preview__cold" data-testid="computer-cold">
                <p>${t("chat.computerCold")}</p>
              </div>
            `
            : showFrame
              ? html`
                <div class="computer-preview__letterbox">
                  <iframe
                    class="computer-preview__frame"
                    data-testid="computer-frame"
                    data-connection-id=${model.connectionId ?? ""}
                    data-mount-generation=${String(model.mountGeneration)}
                    title=${t("chat.computerTitle")}
                    src=${model.streamUrl ?? ""}
                    ?inert=${blockDesktop}
                    data-input-forward=${blockDesktop ? "false" : "true"}
                    @load=${(event: Event) => {
                      const frame = event.currentTarget as HTMLIFrameElement;
                      let doc: Document | null = null;
                      try {
                        doc = frame.contentDocument;
                      } catch {
                        return;
                      }
                      if (!isNovncInvalidOrExpiredTokenDocument(doc)) {
                        return;
                      }
                      if (typeof actions?.onStreamCredentialInvalid === "function") {
                        actions.onStreamCredentialInvalid();
                        return;
                      }
                      actions?.onReconnectStream?.("credential");
                    }}
                  ></iframe>
                  ${anomalyOverlay}
                </div>
              `
              : connectingBlock
        }
      </div>
    </div>
  `;
}

export function renderComputerUsingChip(onSelect?: () => void): TemplateResult {
  return html`
    <button
      type="button"
      class="computer-using-chip"
      data-testid="computer-using-chip"
      @click=${() => onSelect?.()}
    >
      ${t("chat.computerUsing")}
    </button>
  `;
}

export function computerSplitClasses(sidebarOpen: boolean, model: ComputerPreviewModel): string {
  const classes = ["chat-split-container"];
  if (sidebarOpen) {
    classes.push("chat-split-container--open");
  }
  if (!sidebarOpen && model.parkFrame) {
    classes.push("chat-split-container--computer-parked");
  }
  if (sidebarOpen && model.surface === "computer") {
    classes.push(`chat-split-container--computer-${model.size}`);
  }
  if (model.narrowChat) {
    classes.push("chat-split-container--narrow-chat");
  }
  if (model.forceNarrow) {
    classes.push("chat-split-container--narrow-forced");
  }
  return classes.join(" ");
}

/** Matches `--computer-fullscreen-chat-basis` in `ui/src/styles/chat/sidebar.css`. */
export const COMPUTER_FULLSCREEN_CHAT_BASIS = "320px";

export function computerMainFlex(
  sidebarOpen: boolean,
  splitRatio: number,
  model: ComputerPreviewModel,
): string {
  if (!sidebarOpen) {
    return "1 1 100%";
  }
  if (model.surface === "computer" && model.size === "expanded") {
    return "0 0 280px";
  }
  if (model.surface === "computer" && model.size === "fullscreen") {
    // Grow into space the nav rail gives up. The computer pane width is locked in CSS.
    return `1 1 ${COMPUTER_FULLSCREEN_CHAT_BASIS}`;
  }
  return `0 0 ${splitRatio * 100}%`;
}
