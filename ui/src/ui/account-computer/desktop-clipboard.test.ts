import { describe, expect, it, beforeEach } from "vitest";
import {
  ALLOWED_CLIPBOARD_MIME,
  DEFAULT_CLIPBOARD_TEXT_MAX_BYTES,
  DESKTOP_CLIPBOARD_LANDING,
  clipboardTextByteLength,
  createClipboardLoopGuard,
  createClipboardSyncSession,
  ensureClipboardPermission,
  getCachedClipboardPermission,
  isClipboardPermissionGranted,
  normalizeClipboardMime,
  probeClipboardPermission,
  readTextFromClipboardEvent,
  resetClipboardPermissionCacheForTests,
  setCachedClipboardPermission,
  validateClipboardTextPayload,
  writeTextToClipboardEvent,
  type ClipboardAdapter,
  type ClipboardPermissionState,
  type ClipboardSyncResult,
} from "./desktop-clipboard.ts";

function expectRejected(
  result: ClipboardSyncResult | ReturnType<typeof validateClipboardTextPayload>,
  reason: string,
) {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe(reason);
  }
}

function memoryAdapter(
  initial = "",
  permission: ClipboardPermissionState = "granted",
): ClipboardAdapter & { store: { text: string } } {
  const store = { text: initial };
  return {
    store,
    async readText() {
      return store.text;
    },
    async writeText(text: string) {
      store.text = text;
    },
    async queryPermission() {
      return permission;
    },
  };
}

describe("DESKTOP_CLIPBOARD_M1", () => {
  beforeEach(() => {
    resetClipboardPermissionCacheForTests();
  });

  it("exports the loom landing id and defaults", () => {
    expect(DESKTOP_CLIPBOARD_LANDING).toBe("DESKTOP_CLIPBOARD_M1");
    expect(DEFAULT_CLIPBOARD_TEXT_MAX_BYTES).toBe(256 * 1024);
    expect(ALLOWED_CLIPBOARD_MIME).toBe("text/plain");
  });

  it("normalizes MIME allowlist (text/plain only)", () => {
    expect(normalizeClipboardMime(undefined)).toBe("text/plain");
    expect(normalizeClipboardMime("")).toBe("text/plain");
    expect(normalizeClipboardMime("text/plain;charset=utf-8")).toBe("text/plain");
    expect(normalizeClipboardMime("text")).toBe("text/plain");
    expect(normalizeClipboardMime("text/html")).toBeNull();
    expect(normalizeClipboardMime("image/png")).toBeNull();
  });

  it("rejects empty, oversized, and non-allowlisted MIME payloads", () => {
    expectRejected(validateClipboardTextPayload(""), "empty");
    expectRejected(validateClipboardTextPayload("hi", "image/png"), "mime_rejected");
    const big = "x".repeat(DEFAULT_CLIPBOARD_TEXT_MAX_BYTES + 1);
    expect(clipboardTextByteLength(big)).toBeGreaterThan(DEFAULT_CLIPBOARD_TEXT_MAX_BYTES);
    expectRejected(validateClipboardTextPayload(big), "oversized");
    const ok = validateClipboardTextPayload("hello", "text/plain");
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.mimeType).toBe("text/plain");
    }
  });

  it("suppresses opposite-direction echo via generation/token guard", () => {
    const guard = createClipboardLoopGuard();
    const g1 = guard.noteOutbound("host_to_remote", "payload-a");
    expect(g1).toBe(1);
    expect(guard.isEcho("remote_to_host", "payload-a")).toBe(true);
    expect(guard.isEcho("host_to_remote", "payload-a")).toBe(false);
    expect(guard.isEcho("remote_to_host", "other")).toBe(false);
    guard.noteOutbound("remote_to_host", "payload-b");
    expect(guard.isEcho("host_to_remote", "payload-b")).toBe(true);
    expect(guard.isEcho("remote_to_host", "payload-b")).toBe(false);
  });

  it("hostToRemote / remoteToHost validate size/MIME and suppress loops", () => {
    const sync = createClipboardSyncSession({ maxBytes: 64 });
    const out = sync.hostToRemote("from-host");
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.direction).toBe("host_to_remote");
      expect(out.generation).toBe(1);
    }
    expectRejected(sync.remoteToHost("from-host"), "loop_echo");
    const back = sync.remoteToHost("from-remote");
    expect(back.ok).toBe(true);
    expectRejected(sync.hostToRemote("from-remote"), "loop_echo");
    expectRejected(sync.hostToRemote("x".repeat(65)), "oversized");
    expectRejected(sync.hostToRemote("ok", "text/html"), "mime_rejected");
  });

  it("reads/writes through an injected adapter", async () => {
    const adapter = memoryAdapter("seed");
    const sync = createClipboardSyncSession({ adapter });
    const read = await sync.readHostForRemote();
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.text).toBe("seed");
    }
    const remote = sync.remoteToHost("remote-text");
    expect(remote.ok).toBe(true);
    if (remote.ok) {
      const applied = await sync.applyRemoteToHost(remote);
      expect(applied.ok).toBe(true);
      expect(adapter.store.text).toBe("remote-text");
    }
  });

  it("probes permission via adapter without polling", async () => {
    expect(await probeClipboardPermission(memoryAdapter("", "granted"))).toBe("granted");
    expect(await probeClipboardPermission(memoryAdapter("", "denied"))).toBe("denied");
    expect(await probeClipboardPermission(memoryAdapter("", "unsupported"))).toBe("unsupported");
    expect(await probeClipboardPermission(memoryAdapter("", "prompt"))).toBe("prompt");
  });

  it("caches permission event-driven (ensure is one-shot terminal)", async () => {
    expect(getCachedClipboardPermission()).toBe("unknown");
    expect(isClipboardPermissionGranted("unknown")).toBe(false);
    expect(isClipboardPermissionGranted("granted")).toBe(true);

    let probes = 0;
    const adapter: Pick<ClipboardAdapter, "queryPermission"> = {
      async queryPermission() {
        probes += 1;
        return "granted";
      },
    };
    expect(await ensureClipboardPermission(adapter)).toBe("granted");
    expect(await ensureClipboardPermission(adapter)).toBe("granted");
    expect(probes).toBe(1);

    setCachedClipboardPermission("denied");
    expect(await ensureClipboardPermission(adapter)).toBe("denied");
    expect(probes).toBe(1);
  });

  it("fallback helpers read/write ClipboardEvent data", () => {
    const store = new Map<string, string>();
    const data = {
      getData: (type: string) => store.get(type) ?? "",
      setData: (type: string, value: string) => {
        store.set(type, value);
      },
    } as unknown as DataTransfer;
    let prevented = false;
    expect(readTextFromClipboardEvent({ clipboardData: null })).toBeNull();
    store.set("text/plain", "pasted");
    expect(readTextFromClipboardEvent({ clipboardData: data })).toBe("pasted");
    expect(
      writeTextToClipboardEvent(
        {
          clipboardData: data,
          preventDefault: () => {
            prevented = true;
          },
        },
        "copied",
      ),
    ).toBe(true);
    expect(prevented).toBe(true);
    expect(store.get("text/plain")).toBe("copied");
  });
});
