import { html } from "lit";
import { unsafeSVG } from "lit/directives/unsafe-svg.js";

const KU_UPLOAD_FILE_ICON_SRC = "/assets/knowledge-universe/upload-file-icon.png";
const KU_UPLOAD_FILE_ICON_SRC_2X = "/assets/knowledge-universe/upload-file-icon@2x.png";

/**
 * Lit escapes string interpolations as text nodes, so SVG path markup must go through
 * unsafeSVG or the icon renders as an empty <svg> (cabin enter arrows looked "missing").
 */
function iconSvg(className: string, body: string) {
  return html`
    <svg
      class=${className}
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
    >
      ${unsafeSVG(body)}
    </svg>
  `;
}

function uploadFileIconImage(className: string) {
  return html`
    <img
      class="${className} knowledge-universe__upload-file-icon"
      src=${KU_UPLOAD_FILE_ICON_SRC}
      srcset="${KU_UPLOAD_FILE_ICON_SRC} 1x, ${KU_UPLOAD_FILE_ICON_SRC_2X} 2x"
      width="20"
      height="20"
      alt=""
      aria-hidden="true"
      decoding="async"
    />
  `;
}

export function kuIconPlus(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconUpload(className = "knowledge-universe__icon") {
  return uploadFileIconImage(className);
}

/** Cropped raster — folder + cloud upload affordance */
export function kuIconDocumentUpload(className = "knowledge-universe__icon") {
  return uploadFileIconImage(className);
}

export function kuIconDatabase(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<ellipse cx="12" cy="6" rx="8" ry="3" stroke="currentColor" stroke-width="2"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" stroke="currentColor" stroke-width="2"/>',
  );
}

export function kuIconMore(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<circle cx="6" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="18" cy="12" r="1.5" fill="currentColor"/>',
  );
}

export function kuIconSearch(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3-3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconFolder(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M3 7a2 2 0 012-2h5l2 2h9a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  );
}

export function kuIconFile(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M8 4h8l4 4v12a2 2 0 01-2 2H8a2 2 0 01-2-2V6a2 2 0 012-2z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M16 4v4h4" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  );
}

export function kuIconBuilding(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M4 21V5a1 1 0 011-1h5v17M14 21V9h5a1 1 0 011 1v11M9 9h1M9 13h1M9 17h1M17 13h1M17 17h1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconRobot(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<rect x="5" y="8" width="14" height="12" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="10" cy="13" r="1.5" fill="currentColor"/><circle cx="14" cy="13" r="1.5" fill="currentColor"/><path d="M12 4v4M8 20v2M16 20v2M9 4h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconShield(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M12 3l8 3v6c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V6l8-3z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  );
}

export function kuIconChart(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconLink(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M9 12a4 4 0 006.4 3.2l1.2-1.2M15 12a4 4 0 00-6.4-3.2L7.4 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M10 8l4 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconEye(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/>',
  );
}

export function kuIconBookmark(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M7 4h10v16l-5-3.5L7 20V4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  );
}

export function kuIconArchive(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M4 7h16v3H4V7z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 001 1h10a1 1 0 001-1v-9" stroke="currentColor" stroke-width="2"/><path d="M10 14h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconPin(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M12 17v4M8 3h8l-1 7 3 2v2H6v-2l3-2L8 3z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  );
}

export function kuIconUser(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<circle cx="12" cy="8" r="3.5" stroke="currentColor" stroke-width="2"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

/** Compact chevron for cabin "enter" affordances (管理全部空间 / 查看全部). */
export function kuIconChevronRight(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  );
}

export function kuIconZoomIn(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconZoomOut(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<circle cx="11" cy="11" r="7" stroke="currentColor" stroke-width="2"/><path d="M21 21l-4.35-4.35M8 11h6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  );
}

export function kuIconResetView(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3 3v5h5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  );
}

/** Expand / open panorama. */
export function kuIconExpand(className = "knowledge-universe__icon") {
  return iconSvg(
    className,
    '<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  );
}
