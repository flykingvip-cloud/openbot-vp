/**
 * Desktop Clipboard (ROADMAP v3 P1 — after keyboard / pointer / fullscreen).
 *
 * Capability → permission → bidirectional sync → loop suppression → size/MIME → fallback.
 *
 * Iron rules:
 * - Unlock only with the same INTERACTIVE gate family as keyboard/pointer (caller enforces).
 * - Never poll clipboard on an interval or focus/visibility loop (desktop-proxy anti-pattern).
 * - Permission is one-shot / event-driven (Permissions API change listener or user gesture).
 * - Ownership FSM stays in interaction-ownership.ts; this module is sync + permission only.
 *
 * Fallback when Clipboard API is missing/denied (user-gesture only):
 * - Prefer ClipboardEvent.clipboardData getData/setData on paste/copy/cut.
 * - Last resort: document.execCommand("copy") with a transient textarea.
 * Never invent timers or focus polling to re-read the clipboard.
 */

/** Loom landing stream id for this slice. */
export const DESKTOP_CLIPBOARD_LANDING = "DESKTOP_CLIPBOARD_M1" as const;

/** Default text payload cap (256 KiB UTF-8 bytes). */
export const DEFAULT_CLIPBOARD_TEXT_MAX_BYTES = 256 * 1024;

/** Primary (and currently only) allowed MIME. */
export const ALLOWED_CLIPBOARD_MIME = "text/plain" as const;

export type ClipboardPermissionState = "unknown" | "prompt" | "granted" | "denied" | "unsupported";

export type ClipboardSyncDirection = "host_to_remote" | "remote_to_host";

export type ClipboardSyncRejectReason =
  | "empty"
  | "oversized"
  | "mime_rejected"
  | "loop_echo"
  | "permission_denied"
  | "unsupported"
  | "adapter_error";

export type ClipboardSyncOk = {
  ok: true;
  text: string;
  mimeType: typeof ALLOWED_CLIPBOARD_MIME;
  generation: number;
  direction: ClipboardSyncDirection;
};

export type ClipboardSyncFail = {
  ok: false;
  reason: ClipboardSyncRejectReason;
  detail?: string;
};

export type ClipboardSyncResult = ClipboardSyncOk | ClipboardSyncFail;

/**
 * Injectable host clipboard I/O so pure sync logic is unit-testable
 * without a real browser Clipboard API.
 */
export type ClipboardAdapter = {
  readText: () => Promise<string>;
  writeText: (text: string) => Promise<void>;
  /** Optional Permissions API (or test double) probe — must not poll. */
  queryPermission?: () => Promise<ClipboardPermissionState>;
};

export type ClipboardSyncOptions = {
  maxBytes?: number;
  adapter?: ClipboardAdapter;
};

/** UTF-8 byte length used for the size cap (not JS string length). */
export function clipboardTextByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/**
 * Normalize MIME to text/plain or reject.
 * Bare / omitted mime defaults to text/plain; other types are rejected (stripped).
 */
export function normalizeClipboardMime(mime: string | null | undefined): string | null {
  if (mime == null || mime.trim() === "") {
    return ALLOWED_CLIPBOARD_MIME;
  }
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  if (base === "text/plain" || base === "text") {
    return ALLOWED_CLIPBOARD_MIME;
  }
  return null;
}

export function validateClipboardTextPayload(
  text: string,
  mimeType: string | null | undefined = ALLOWED_CLIPBOARD_MIME,
  maxBytes: number = DEFAULT_CLIPBOARD_TEXT_MAX_BYTES,
): ClipboardSyncFail | { ok: true; text: string; mimeType: typeof ALLOWED_CLIPBOARD_MIME } {
  if (typeof text !== "string" || text.length === 0) {
    return { ok: false, reason: "empty" };
  }
  const normalized = normalizeClipboardMime(mimeType);
  if (normalized == null) {
    return { ok: false, reason: "mime_rejected", detail: mimeType ?? "" };
  }
  const bytes = clipboardTextByteLength(text);
  if (bytes > maxBytes) {
    return {
      ok: false,
      reason: "oversized",
      detail: `${bytes}>${maxBytes}`,
    };
  }
  return { ok: true, text, mimeType: ALLOWED_CLIPBOARD_MIME };
}

export type ClipboardLoopGuard = {
  /** Record a successful outbound write; returns the new generation. */
  noteOutbound: (direction: ClipboardSyncDirection, text: string) => number;
  /**
   * True when `text` is an echo of the opposite-direction write we just made
   * (same payload bouncing back through the other side).
   */
  isEcho: (direction: ClipboardSyncDirection, text: string) => boolean;
  clear: () => void;
  generation: () => number;
};

/** Token/generation loop suppression for host↔remote echo. */
export function createClipboardLoopGuard(): ClipboardLoopGuard {
  let generation = 0;
  let lastText: string | null = null;
  let lastDirection: ClipboardSyncDirection | null = null;

  return {
    noteOutbound(direction, text) {
      generation += 1;
      lastText = text;
      lastDirection = direction;
      return generation;
    },
    isEcho(direction, text) {
      if (lastText == null || lastDirection == null) {
        return false;
      }
      return lastDirection !== direction && lastText === text;
    },
    clear() {
      lastText = null;
      lastDirection = null;
    },
    generation: () => generation,
  };
}

export type ClipboardSyncSession = {
  hostToRemote: (text: string, mimeType?: string | null) => ClipboardSyncResult;
  remoteToHost: (text: string, mimeType?: string | null) => ClipboardSyncResult;
  /** Read host clipboard via adapter, then validate as host→remote payload. */
  readHostForRemote: () => Promise<ClipboardSyncResult>;
  /** Apply a successful remote→host result onto the host adapter. */
  applyRemoteToHost: (ok: ClipboardSyncOk) => Promise<ClipboardSyncResult>;
  loopGeneration: () => number;
  clearLoopGuard: () => void;
};

function syncOneWay(
  direction: ClipboardSyncDirection,
  text: string,
  mimeType: string | null | undefined,
  maxBytes: number,
  guard: ClipboardLoopGuard,
): ClipboardSyncResult {
  const validated = validateClipboardTextPayload(text, mimeType, maxBytes);
  if (!validated.ok) {
    return validated;
  }
  if (guard.isEcho(direction, validated.text)) {
    return { ok: false, reason: "loop_echo" };
  }
  const generation = guard.noteOutbound(direction, validated.text);
  return {
    ok: true,
    text: validated.text,
    mimeType: validated.mimeType,
    generation,
    direction,
  };
}

export function createClipboardSyncSession(opts: ClipboardSyncOptions = {}): ClipboardSyncSession {
  const maxBytes = opts.maxBytes ?? DEFAULT_CLIPBOARD_TEXT_MAX_BYTES;
  const adapter = opts.adapter;
  const guard = createClipboardLoopGuard();

  return {
    hostToRemote(text, mimeType) {
      return syncOneWay("host_to_remote", text, mimeType, maxBytes, guard);
    },
    remoteToHost(text, mimeType) {
      return syncOneWay("remote_to_host", text, mimeType, maxBytes, guard);
    },
    async readHostForRemote() {
      if (!adapter) {
        return { ok: false, reason: "unsupported", detail: "no_adapter" };
      }
      try {
        const text = await adapter.readText();
        return syncOneWay("host_to_remote", text, ALLOWED_CLIPBOARD_MIME, maxBytes, guard);
      } catch (err) {
        return {
          ok: false,
          reason: "adapter_error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async applyRemoteToHost(ok) {
      if (!ok.ok || ok.direction !== "remote_to_host") {
        return { ok: false, reason: "adapter_error", detail: "not_remote_to_host" };
      }
      if (!adapter) {
        return { ok: false, reason: "unsupported", detail: "no_adapter" };
      }
      try {
        await adapter.writeText(ok.text);
        return ok;
      } catch (err) {
        return {
          ok: false,
          reason: "adapter_error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
    loopGeneration: () => guard.generation(),
    clearLoopGuard: () => guard.clear(),
  };
}

function mapDomPermissionState(state: string): ClipboardPermissionState {
  switch (state) {
    case "granted":
      return "granted";
    case "denied":
      return "denied";
    case "prompt":
      return "prompt";
    default:
      return "unknown";
  }
}

/**
 * One-shot / event-driven permission probe.
 * Call from a user gesture or once when the session becomes INTERACTIVE — never on a timer/focus loop.
 */
export async function probeClipboardPermission(
  adapter?: Pick<ClipboardAdapter, "queryPermission"> | null,
): Promise<ClipboardPermissionState> {
  if (adapter?.queryPermission) {
    return adapter.queryPermission();
  }
  if (typeof navigator === "undefined" || !navigator.clipboard) {
    return "unsupported";
  }
  const permissions = (
    navigator as Navigator & {
      permissions?: { query: (desc: { name: string }) => Promise<{ state: string }> };
    }
  ).permissions;
  if (!permissions?.query) {
    // API present; permission unknown until a gesture read/write succeeds or fails.
    return "unknown";
  }
  try {
    // clipboard-read is the stricter gate; write often follows the same prompt in Chromium.
    const status = await permissions.query({ name: "clipboard-read" });
    return mapDomPermissionState(status.state);
  } catch {
    // Firefox / Safari may throw on clipboard-read permission name.
    return "unknown";
  }
}

/** Read text/plain from a paste/copy ClipboardEvent (fallback path). */
export function readTextFromClipboardEvent(event: {
  clipboardData?: DataTransfer | null;
}): string | null {
  const data = event.clipboardData;
  if (!data) {
    return null;
  }
  const text = data.getData("text/plain") || data.getData("text");
  return text ? text : null;
}

/** Write text/plain onto a copy/cut ClipboardEvent (fallback path). */
export function writeTextToClipboardEvent(
  event: { clipboardData?: DataTransfer | null; preventDefault?: () => void },
  text: string,
): boolean {
  const data = event.clipboardData;
  if (!data) {
    return false;
  }
  try {
    data.setData("text/plain", text);
    event.preventDefault?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Browser adapter: Clipboard API first; callers should fall back to event clipboardData
 * when this throws or permission is denied (see module header).
 */
export function createBrowserClipboardAdapter(): ClipboardAdapter {
  return {
    async readText() {
      if (typeof navigator === "undefined" || !navigator.clipboard?.readText) {
        throw new Error("clipboard_unsupported");
      }
      return navigator.clipboard.readText();
    },
    async writeText(text: string) {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard_unsupported");
      }
      await navigator.clipboard.writeText(text);
    },
    async queryPermission() {
      return probeClipboardPermission(null);
    },
  };
}

// --- Preview-facing permission cache (event-driven; not a poller) ---

let cachedPermission: ClipboardPermissionState = "unknown";

export function getCachedClipboardPermission(): ClipboardPermissionState {
  return cachedPermission;
}

export function setCachedClipboardPermission(state: ClipboardPermissionState): void {
  cachedPermission = state;
}

export function resetClipboardPermissionCacheForTests(): void {
  cachedPermission = "unknown";
}

/**
 * Probe once and cache. Safe to call from a user gesture or a single INTERACTIVE entry.
 * No-ops the network-less probe when already terminal (granted/denied/unsupported).
 */
export async function ensureClipboardPermission(
  adapter?: Pick<ClipboardAdapter, "queryPermission"> | null,
): Promise<ClipboardPermissionState> {
  if (
    cachedPermission === "granted" ||
    cachedPermission === "denied" ||
    cachedPermission === "unsupported"
  ) {
    return cachedPermission;
  }
  const next = await probeClipboardPermission(adapter);
  cachedPermission = next;
  return next;
}

/** True when permission allows clipboard capability unlock. */
export function isClipboardPermissionGranted(
  state: ClipboardPermissionState | null | undefined,
): boolean {
  return state === "granted";
}
