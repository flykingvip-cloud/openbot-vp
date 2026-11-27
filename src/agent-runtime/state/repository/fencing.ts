/**
 * Canonical storage-level fencingGeneration guard.
 *
 * Fencing generations are monotonic safe non-negative integers. Storage writes
 * fail closed with StaleFencingGenerationError when a caller presents a stale
 * generation or attempts to regress the persisted generation.
 */

export class StaleFencingGenerationError extends Error {
  readonly expectedGeneration: number | undefined;
  readonly currentGeneration: number;
  readonly resource?: string;

  constructor(
    expectedGeneration: number | undefined,
    currentGeneration: number,
    resource?: string,
    message?: string,
  ) {
    super(
      message ??
        `stale fencingGeneration${resource ? ` (${resource})` : ""}: expected=${String(expectedGeneration)} current=${currentGeneration}`,
    );
    this.name = "StaleFencingGenerationError";
    this.expectedGeneration = expectedGeneration;
    this.currentGeneration = currentGeneration;
    this.resource = resource;
  }
}

export function isValidFencingGeneration(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    Number.isSafeInteger(value) &&
    value >= 0
  );
}

export function normalizeFencingGeneration(value: unknown, resource?: string): number {
  if (value === undefined) {
    return 0;
  }
  if (!isValidFencingGeneration(value)) {
    const label =
      typeof value === "number" || typeof value === "string" || typeof value === "boolean"
        ? String(value)
        : typeof value;
    throw new StaleFencingGenerationError(
      undefined,
      0,
      resource,
      `invalid fencingGeneration${resource ? ` (${resource})` : ""}: ${label}`,
    );
  }
  return value;
}

export function assertFencingGenerationMatch(params: {
  expectedGeneration: number | undefined;
  currentGeneration: number;
  resource?: string;
  allowBootstrapWhenZero?: boolean;
}): void {
  const current = normalizeFencingGeneration(params.currentGeneration, params.resource);
  if (params.allowBootstrapWhenZero && current === 0 && params.expectedGeneration === undefined) {
    return;
  }
  if (
    !isValidFencingGeneration(params.expectedGeneration) ||
    params.expectedGeneration !== current
  ) {
    throw new StaleFencingGenerationError(params.expectedGeneration, current, params.resource);
  }
}

export function assertMonotonicFencingGeneration(params: {
  currentGeneration: number;
  nextGeneration: number;
  resource?: string;
}): void {
  const current = normalizeFencingGeneration(params.currentGeneration, params.resource);
  if (!isValidFencingGeneration(params.nextGeneration) || params.nextGeneration < current) {
    throw new StaleFencingGenerationError(
      params.nextGeneration,
      current,
      params.resource,
      `non-monotonic fencingGeneration${params.resource ? ` (${params.resource})` : ""}: next=${String(params.nextGeneration)} current=${current}`,
    );
  }
}

export function nextFencingGeneration(currentGeneration: number | undefined): number {
  return normalizeFencingGeneration(currentGeneration) + 1;
}
