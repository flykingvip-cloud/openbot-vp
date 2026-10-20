export function buildControlUiCspHeader(): string {
  // Control UI: block framing, restrict inline scripts, keep styles permissive
  // (UI uses a lot of inline style attributes in templates).
  // Keep Google Fonts origins explicit in CSP for deployments that load
  // external Google Fonts stylesheets/font files.
  // frame-src: same-origin + blob:/data: for sandboxed HTML/PDF deliverable previews.
  // Also allow the public OpenBot web hosts so published HTML pages
  // (e.g. https://www.openbot.love/128-layout-preview.html) can iframe when the
  // Control UI is served from a sibling subdomain (gw.openbot.love).
  return [
    "default-src 'self'",
    "base-uri 'none'",
    // Chrome's built-in PDF viewer loads the plugin via object-src.
    "object-src 'self' blob:",
    "frame-src 'self' blob: data: https://www.openbot.love https://gw.openbot.love",
    "frame-ancestors 'none'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    // Control UI notification tones and inline TTS use blob:/data: audio.
    "media-src 'self' blob: data:",
    "font-src 'self' https://fonts.gstatic.com",
    "connect-src 'self' ws: wss:",
  ].join("; ");
}
