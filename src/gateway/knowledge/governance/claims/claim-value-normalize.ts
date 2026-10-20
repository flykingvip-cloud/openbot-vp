function normalizePercentToken(value: string): string | null {
  const percentSuffix = value.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (percentSuffix) {
    return `pct:${percentSuffix[1]}`;
  }
  const percentWord = value.match(/^(\d+(?:\.\d+)?)\s*percent$/);
  if (percentWord) {
    return `pct:${percentWord[1]}`;
  }
  return null;
}

export function normalizeClaimObjectValue(value: string): string {
  const trimmed = value.trim().toLowerCase().replace(/\s+/g, " ");
  if (!trimmed) {
    return "";
  }
  const percent = normalizePercentToken(trimmed);
  if (percent) {
    return percent;
  }
  const withUnit = trimmed.match(/^(\d+(?:\.\d+)?)\s*([a-z]{1,12})$/);
  if (withUnit) {
    return `${withUnit[2]}:${withUnit[1]}`;
  }
  return trimmed;
}

export function claimValuesConflict(left: string, right: string): boolean {
  const a = normalizeClaimObjectValue(left);
  const b = normalizeClaimObjectValue(right);
  if (!a || !b || a === b) {
    return false;
  }
  return true;
}
