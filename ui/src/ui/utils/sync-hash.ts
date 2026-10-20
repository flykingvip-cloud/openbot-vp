/** Deterministic short fingerprint for browser + node (non-cryptographic). */
export function hashTextSync(input: string, hexLength = 12): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const hex = (hash >>> 0).toString(16).padStart(8, "0");
  if (hexLength <= hex.length) {
    return hex.slice(0, hexLength);
  }
  let extended = hex;
  let seed = hash;
  while (extended.length < hexLength) {
    seed = Math.imul(seed ^ input.length, 2246822519);
    extended += (seed >>> 0).toString(16).padStart(8, "0");
  }
  return extended.slice(0, hexLength);
}
