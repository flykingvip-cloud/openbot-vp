export function estimateBase64DecodedBytes(base64: string): number {
  // Avoid `trim()`/`replace()` here: they allocate a second (potentially huge) string.
  // We only need a conservative decoded-size estimate to enforce budgets before Buffer.from(..., "base64").
  let effectiveLen = 0;
  for (let i = 0; i < base64.length; i += 1) {
    const code = base64.charCodeAt(i);
    // Treat ASCII control + space as whitespace; base64 decoders commonly ignore these.
    if (code <= 0x20) {
      continue;
    }
    effectiveLen += 1;
  }

  if (effectiveLen === 0) {
    return 0;
  }

  let padding = 0;
  // Find last non-whitespace char(s) to detect '=' padding without allocating/copying.
  let end = base64.length - 1;
  while (end >= 0 && base64.charCodeAt(end) <= 0x20) {
    end -= 1;
  }
  if (end >= 0 && base64[end] === "=") {
    padding = 1;
    end -= 1;
    while (end >= 0 && base64.charCodeAt(end) <= 0x20) {
      end -= 1;
    }
    if (end >= 0 && base64[end] === "=") {
      padding = 2;
    }
  }

  const estimated = Math.floor((effectiveLen * 3) / 4) - padding;
  return Math.max(0, estimated);
}

function isCanonicalBase64Alphabet(cleaned: string): boolean {
  // Iterative check avoids regex engines recursing on multi‑MB payloads.
  if (!cleaned || cleaned.length % 4 !== 0) {
    return false;
  }
  let padding = 0;
  for (let i = 0; i < cleaned.length; i += 1) {
    const code = cleaned.charCodeAt(i);
    const isAlpha =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      code === 43 ||
      code === 47;
    if (isAlpha) {
      if (padding > 0) {
        return false;
      }
      continue;
    }
    if (code === 61) {
      padding += 1;
      if (padding > 2) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

/**
 * Normalize and validate a base64 string.
 * Returns canonical base64 (no whitespace) or undefined when invalid.
 */
export function canonicalizeBase64(base64: string): string | undefined {
  // Strip whitespace without a second full copy when already clean.
  let cleaned = base64;
  for (let i = 0; i < base64.length; i += 1) {
    if (base64.charCodeAt(i) <= 0x20) {
      cleaned = base64.replace(/\s+/g, "");
      break;
    }
  }
  if (!isCanonicalBase64Alphabet(cleaned)) {
    return undefined;
  }
  return cleaned;
}
