const DATA_IMAGE_PREFIX_RE = /^data:image\//i;
const IMAGE_FILE_EXT_RE = /\.(svg|png|jpe?g|webp|gif|avif)$/i;
const TRANSPARENT_ALPHA_THRESHOLD = 18;
const BACKGROUND_COLOR_DISTANCE_THRESHOLD = 30;
const BACKGROUND_ALPHA_DISTANCE_THRESHOLD = 24;
const MAX_TRIMMED_LOGO_DIMENSION = 512;

/**
 * Bump when shipping new favicon / touch assets so browsers never keep serving
 * stale red/blue legacy icons from disk cache under the same path.
 */
export const BRAND_FAVICON_ASSET_VERSION = "20260722a";

/** Static favicon path segment (under site root / basePath). */
export const BRAND_FAVICON_SVG = "favicon.svg";

export const MAX_CUSTOM_BRAND_LOGO_BYTES = 512 * 1024;

export type BrandLogoErrorCode = "unsupported" | "too_large" | "read_failed";

export class BrandLogoError extends Error {
  code: BrandLogoErrorCode;

  constructor(code: BrandLogoErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeCustomBrandLogoDataUrl(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed || !DATA_IMAGE_PREFIX_RE.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function resolveCustomBrandLogoSrc(settings: {
  customBrandLogoDataUrl?: unknown;
}): string | null {
  return normalizeCustomBrandLogoDataUrl(settings.customBrandLogoDataUrl) ?? null;
}

function resolveBundledAsset(basePath: string, filename: string): string {
  return basePath ? `${basePath}/${filename}` : `/${filename}`;
}

/** Append cache-busting version to static brand asset URLs (never to data: URLs). */
export function withBrandFaviconVersion(
  href: string,
  version = BRAND_FAVICON_ASSET_VERSION,
): string {
  if (!href || href.startsWith("data:")) {
    return href;
  }
  // Strip previous v= so re-sync stays stable.
  const cleaned = href.replace(/([?&])v=[^&]*(&|$)/, (_, sep: string, end: string) =>
    end === "&" ? sep : "",
  );
  const base = cleaned.endsWith("?") || cleaned.endsWith("&") ? cleaned.slice(0, -1) : cleaned;
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}v=${encodeURIComponent(version)}`;
}

export function resolveBundledBrandWordmarkSrc(basePath: string): string {
  // Prefer WebP (~18KB at display size) over the legacy PNG wordmark.
  return resolveBundledAsset(basePath, "openbot-logo.webp");
}

export function resolveBrandLogoSrc(
  settings: { customBrandLogoDataUrl?: unknown },
  basePath: string,
): string {
  return resolveCustomBrandLogoSrc(settings) ?? resolveBundledAsset(basePath, "favicon.svg");
}

export function resolveAppleTouchIconSrc(
  settings: { customBrandLogoDataUrl?: unknown },
  basePath: string,
): string {
  return (
    resolveCustomBrandLogoSrc(settings) ?? resolveBundledAsset(basePath, "apple-touch-icon.png")
  );
}

type ManagedIconSpec = {
  marker: string;
  rel: string;
  href: string;
  type?: string;
  sizes?: string;
};

function removeUnmanagedHeadIconLinks() {
  if (typeof document === "undefined") {
    return;
  }
  const nodes = document.head.querySelectorAll(
    'link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]',
  );
  for (const node of nodes) {
    if (!(node instanceof HTMLLinkElement)) {
      continue;
    }
    // Drop static index.html icons and any previous brand links; we reinstall a clean set.
    node.remove();
  }
}

function installManagedHeadLink(spec: ManagedIconSpec): HTMLLinkElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  const link = document.createElement("link");
  link.rel = spec.rel;
  link.dataset.openbotBrand = spec.marker;
  link.href = spec.href;
  if (spec.type) {
    link.type = spec.type;
  }
  if (spec.sizes) {
    link.setAttribute("sizes", spec.sizes);
  }
  document.head.append(link);
  return link;
}

/**
 * Install exactly one coherent set of favicon / touch icons.
 * Removes competing static + dynamic links so navigation / refresh never
 * oscillates between legacy red/blue caches and the current brand assets.
 */
export function syncBrandHeadAssets(
  settings: { customBrandLogoDataUrl?: unknown },
  basePath: string,
) {
  if (typeof document === "undefined") {
    return;
  }

  removeUnmanagedHeadIconLinks();

  const custom = resolveCustomBrandLogoSrc(settings);
  if (custom) {
    const type = custom.startsWith("data:image/svg+xml")
      ? "image/svg+xml"
      : custom.startsWith("data:image/png")
        ? "image/png"
        : undefined;
    installManagedHeadLink({
      marker: "icon",
      rel: "icon",
      href: custom,
      type,
    });
    installManagedHeadLink({
      marker: "touch",
      rel: "apple-touch-icon",
      href: custom,
      sizes: "180x180",
    });
    return;
  }

  // Default brand pack: same generation, versioned paths, no competing unmanaged links.
  installManagedHeadLink({
    marker: "icon-ico",
    rel: "icon",
    href: withBrandFaviconVersion(resolveBundledAsset(basePath, "favicon.ico")),
    sizes: "any",
  });
  installManagedHeadLink({
    marker: "icon",
    rel: "icon",
    href: withBrandFaviconVersion(resolveBundledAsset(basePath, "favicon.svg")),
    type: "image/svg+xml",
  });
  installManagedHeadLink({
    marker: "icon-32",
    rel: "icon",
    href: withBrandFaviconVersion(resolveBundledAsset(basePath, "favicon-32.png")),
    type: "image/png",
    sizes: "32x32",
  });
  installManagedHeadLink({
    marker: "touch",
    rel: "apple-touch-icon",
    href: withBrandFaviconVersion(resolveBundledAsset(basePath, "apple-touch-icon.png")),
    type: "image/png",
    sizes: "180x180",
  });
}

function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith("image/") || IMAGE_FILE_EXT_RE.test(file.name);
}

function createBrandLogoError(code: BrandLogoErrorCode): BrandLogoError {
  if (code === "unsupported") {
    return new BrandLogoError(code, "unsupported custom logo file");
  }
  if (code === "too_large") {
    return new BrandLogoError(code, "custom logo file is too large");
  }
  return new BrandLogoError(code, "failed to read custom logo file");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const normalized = normalizeCustomBrandLogoDataUrl(value);
      if (!normalized) {
        reject(createBrandLogoError("read_failed"));
        return;
      }
      resolve(normalized);
    });
    reader.addEventListener("error", () => reject(createBrandLogoError("read_failed")));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image));
    image.addEventListener("error", () => reject(createBrandLogoError("read_failed")));
    image.src = dataUrl;
  });
}

function averageChannel(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function averageBorderPixel(data: Uint8ClampedArray, width: number, height: number) {
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  const alphas: number[] = [];
  const pushPixel = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    reds.push(data[offset] ?? 0);
    greens.push(data[offset + 1] ?? 0);
    blues.push(data[offset + 2] ?? 0);
    alphas.push(data[offset + 3] ?? 0);
  };

  for (let x = 0; x < width; x += 1) {
    pushPixel(x, 0);
    if (height > 1) {
      pushPixel(x, height - 1);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    pushPixel(0, y);
    if (width > 1) {
      pushPixel(width - 1, y);
    }
  }

  return {
    red: averageChannel(reds),
    green: averageChannel(greens),
    blue: averageChannel(blues),
    alpha: averageChannel(alphas),
  };
}

type Rgb = { red: number; green: number; blue: number };
type Rgba = Rgb & { alpha: number };

function isNearWhitePixel(red: number, green: number, blue: number, alpha: number): boolean {
  if (alpha <= TRANSPARENT_ALPHA_THRESHOLD) {
    return true;
  }
  const minChannel = Math.min(red, green, blue);
  const maxChannel = Math.max(red, green, blue);
  return minChannel >= 228 && maxChannel - minChannel <= 16;
}

function quantizeChannel(value: number): number {
  return Math.round(value / 24) * 24;
}

function rgbKey(red: number, green: number, blue: number): string {
  return `${quantizeChannel(red)}:${quantizeChannel(green)}:${quantizeChannel(blue)}`;
}

function buildEdgePalette(data: Uint8ClampedArray, width: number, height: number): Rgb[] {
  const counts = new Map<string, { rgb: Rgb; count: number }>();
  const add = (x: number, y: number) => {
    const offset = (y * width + x) * 4;
    const alpha = data[offset + 3] ?? 0;
    if (alpha <= TRANSPARENT_ALPHA_THRESHOLD) {
      return;
    }
    const red = data[offset] ?? 0;
    const green = data[offset + 1] ?? 0;
    const blue = data[offset + 2] ?? 0;
    if (isNearWhitePixel(red, green, blue, alpha)) {
      return;
    }
    const key = rgbKey(red, green, blue);
    const current = counts.get(key);
    if (current) {
      current.count += 1;
    } else {
      counts.set(key, { rgb: { red, green, blue }, count: 1 });
    }
  };

  for (let x = 0; x < width; x += 1) {
    add(x, 0);
    if (height > 1) {
      add(x, height - 1);
    }
  }
  for (let y = 1; y < height - 1; y += 1) {
    add(0, y);
    if (width > 1) {
      add(width - 1, y);
    }
  }

  const perimeterSamples = Math.max(1, width * 2 + Math.max(0, height - 2) * 2);
  const minCount = Math.max(2, Math.floor(perimeterSamples * 0.04));
  return [...counts.values()]
    .filter((entry) => entry.count >= minCount)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((entry) => entry.rgb);
}

function matchesEdgePalette(red: number, green: number, blue: number, palette: Rgb[]): boolean {
  return palette.some(
    (sample) =>
      Math.abs(red - sample.red) <= 48 &&
      Math.abs(green - sample.green) <= 48 &&
      Math.abs(blue - sample.blue) <= 48,
  );
}

function isLikelyDecorativeFramePixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
): boolean {
  if (alpha <= TRANSPARENT_ALPHA_THRESHOLD) {
    return false;
  }
  const maxChannel = Math.max(red, green, blue);
  const minChannel = Math.min(red, green, blue);
  const spread = maxChannel - minChannel;
  return spread >= 72 && maxChannel >= 160 && minChannel <= 120;
}

function isEmptyLogoPixel(
  red: number,
  green: number,
  blue: number,
  alpha: number,
  background: Rgba,
  edgePalette: Rgb[],
): boolean {
  if (isNearWhitePixel(red, green, blue, alpha)) {
    return true;
  }
  if (isLikelyDecorativeFramePixel(red, green, blue, alpha)) {
    return true;
  }
  if (matchesEdgePalette(red, green, blue, edgePalette)) {
    return true;
  }
  if (alpha <= TRANSPARENT_ALPHA_THRESHOLD) {
    return true;
  }
  const colorDistance = Math.max(
    Math.abs(red - background.red),
    Math.abs(green - background.green),
    Math.abs(blue - background.blue),
  );
  const alphaDistance = Math.abs(alpha - background.alpha);
  return (
    colorDistance <= BACKGROUND_COLOR_DISTANCE_THRESHOLD &&
    alphaDistance <= BACKGROUND_ALPHA_DISTANCE_THRESHOLD
  );
}

function isEmptyAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
  background: Rgba,
  edgePalette: Rgb[],
): boolean {
  const offset = (y * width + x) * 4;
  return isEmptyLogoPixel(
    data[offset] ?? 0,
    data[offset + 1] ?? 0,
    data[offset + 2] ?? 0,
    data[offset + 3] ?? 0,
    background,
    edgePalette,
  );
}

function tightenVerticalBounds(
  data: Uint8ClampedArray,
  width: number,
  bounds: { left: number; top: number; right: number; bottom: number },
  background: Rgba,
  edgePalette: Rgb[],
): { left: number; top: number; right: number; bottom: number } {
  let { left, top, right, bottom } = bounds;
  const rowWidth = right - left + 1;

  while (bottom > top) {
    let emptyCount = 0;
    for (let x = left; x <= right; x += 1) {
      if (isEmptyAt(data, width, x, bottom, background, edgePalette)) {
        emptyCount += 1;
      }
    }
    if (emptyCount / rowWidth >= 0.9) {
      bottom -= 1;
      continue;
    }
    break;
  }

  while (top < bottom) {
    let emptyCount = 0;
    for (let x = left; x <= right; x += 1) {
      if (isEmptyAt(data, width, x, top, background, edgePalette)) {
        emptyCount += 1;
      }
    }
    if (emptyCount / rowWidth >= 0.9) {
      top += 1;
      continue;
    }
    break;
  }

  return { left, top, right, bottom };
}

function findTrimBounds(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  const background = averageBorderPixel(data, width, height);
  const edgePalette = buildEdgePalette(data, width, height);
  let left = width;
  let right = -1;
  let top = height;
  let bottom = -1;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      const alpha = data[offset + 3] ?? 0;
      const red = data[offset] ?? 0;
      const green = data[offset + 1] ?? 0;
      const blue = data[offset + 2] ?? 0;
      if (isEmptyLogoPixel(red, green, blue, alpha, background, edgePalette)) {
        continue;
      }

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }

  if (right < left || bottom < top) {
    return null;
  }
  return tightenVerticalBounds(data, width, { left, top, right, bottom }, background, edgePalette);
}

async function trimLogoDataUrl(dataUrl: string): Promise<string> {
  if (typeof document === "undefined") {
    return dataUrl;
  }
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_TRIMMED_LOGO_DIMENSION / Math.max(image.width, image.height, 1));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    return dataUrl;
  }

  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const imageData = context.getImageData(0, 0, width, height);
  const bounds = findTrimBounds(imageData.data, width, height);
  if (!bounds) {
    return dataUrl;
  }

  const trimmedWidth = bounds.right - bounds.left + 1;
  const trimmedHeight = bounds.bottom - bounds.top + 1;
  if (trimmedWidth >= width && trimmedHeight >= height) {
    return dataUrl;
  }

  const output = document.createElement("canvas");
  output.width = trimmedWidth;
  output.height = trimmedHeight;
  const outputContext = output.getContext("2d");
  if (!outputContext) {
    return dataUrl;
  }
  outputContext.drawImage(
    canvas,
    bounds.left,
    bounds.top,
    trimmedWidth,
    trimmedHeight,
    0,
    0,
    trimmedWidth,
    trimmedHeight,
  );

  return output.toDataURL("image/png");
}

export async function trimCustomBrandLogoDataUrl(dataUrl: string): Promise<string> {
  const normalized = normalizeCustomBrandLogoDataUrl(dataUrl);
  if (!normalized) {
    return dataUrl;
  }
  try {
    return await trimLogoDataUrl(normalized);
  } catch {
    return normalized;
  }
}

export function resolveTrimBoundsForTest(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): { left: number; top: number; right: number; bottom: number } | null {
  return findTrimBounds(data, width, height);
}

export async function readCustomBrandLogoFile(file: File): Promise<string> {
  if (!isSupportedImageFile(file)) {
    throw createBrandLogoError("unsupported");
  }
  if (file.size > MAX_CUSTOM_BRAND_LOGO_BYTES) {
    throw createBrandLogoError("too_large");
  }
  const dataUrl = await readFileAsDataUrl(file);
  try {
    return await trimLogoDataUrl(dataUrl);
  } catch {
    return dataUrl;
  }
}
