/**
 * Derive a human-friendly device label for browser clients, e.g. "Chrome · Mac",
 * "Safari · iPhone". Sent as the connect `client.displayName` so device pairing
 * records (and the employee "我的设备" list) show a recognizable name instead of
 * a bare key fingerprint.
 */

function detectBrowserName(userAgent: string): string | null {
  if (!userAgent) {
    return null;
  }
  // Order matters: Edge/Opera embed "Chrome/", Chrome embeds "Safari/".
  if (/Edg(e|A|iOS)?\//.test(userAgent)) {
    return "Edge";
  }
  if (/OPR\//.test(userAgent) || /Opera/.test(userAgent)) {
    return "Opera";
  }
  if (/Firefox\//.test(userAgent) || /FxiOS\//.test(userAgent)) {
    return "Firefox";
  }
  if (/CriOS\//.test(userAgent)) {
    return "Chrome";
  }
  if (/Chrome\//.test(userAgent)) {
    return "Chrome";
  }
  if (/Safari\//.test(userAgent)) {
    return "Safari";
  }
  return null;
}

function detectDeviceLabel(userAgent: string, platform: string): string | null {
  const haystack = `${userAgent} ${platform}`;
  if (/iPhone/i.test(haystack)) {
    return "iPhone";
  }
  if (/iPad/i.test(haystack)) {
    return "iPad";
  }
  if (/Android/i.test(haystack)) {
    return "Android";
  }
  if (/Mac/i.test(haystack)) {
    return "Mac";
  }
  if (/Win/i.test(haystack)) {
    return "Windows";
  }
  if (/CrOS/i.test(haystack)) {
    return "ChromeOS";
  }
  if (/Linux/i.test(haystack)) {
    return "Linux";
  }
  return platform.trim() ? platform.trim() : null;
}

export function describeBrowserDeviceName(params?: {
  userAgent?: string;
  platform?: string;
}): string | undefined {
  const nav = typeof navigator === "undefined" ? undefined : navigator;
  const userAgent = params?.userAgent ?? nav?.userAgent ?? "";
  const platform = params?.platform ?? nav?.platform ?? "";
  const browser = detectBrowserName(userAgent);
  const device = detectDeviceLabel(userAgent, platform);
  const label = [browser ?? (device ? "Browser" : null), device].filter(Boolean).join(" · ");
  return label.length > 0 ? label : undefined;
}

/** Web 客户端 connect 用的设备名，不应作为群聊 transcript 的 senderLabel。 */
export function isBrowserDeviceSenderLabel(label: string | null | undefined): boolean {
  const normalized = label?.trim();
  if (!normalized) {
    return false;
  }
  return /^(Chrome|Safari|Firefox|Edge|Opera|Browser)( · | - |\s)/i.test(normalized);
}
