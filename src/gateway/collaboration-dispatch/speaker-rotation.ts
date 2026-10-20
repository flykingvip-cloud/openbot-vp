import { createHash } from "node:crypto";

export function stableRotationIndex(seed: string, modulo: number): number {
  if (modulo <= 0) {
    return 0;
  }
  const digest = createHash("sha256").update(seed).digest();
  const value = digest.readUInt32BE(0);
  return value % modulo;
}

/** UTC day key so the same group rotates speakers across days without a coordinator. */
export function utcDayKey(nowMs = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

export function pickRotatedIndex(params: {
  groupId: string;
  roundId?: string;
  count: number;
  nowMs?: number;
}): number {
  if (params.count <= 0) {
    return 0;
  }
  const seed = params.roundId?.trim()
    ? `${params.groupId}|${params.roundId.trim()}`
    : `${params.groupId}|${utcDayKey(params.nowMs)}`;
  return stableRotationIndex(seed, params.count);
}
