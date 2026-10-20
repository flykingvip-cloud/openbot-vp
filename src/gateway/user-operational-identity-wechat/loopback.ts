/** Loopback-only HTTP(S) URL check for the personal WeChat sidecar. */

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function isLoopbackHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }
    const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    return LOOPBACK_HOSTS.has(host);
  } catch {
    return false;
  }
}
