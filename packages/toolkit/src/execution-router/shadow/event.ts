import { assertNoSensitiveFields } from "../privacy.js";
import { isDigest16, scanForbiddenSubstrings } from "./digest.js";
import {
  PHASE1_FLAGS,
  SHADOW_EVENT_NAME,
  SHADOW_EVENT_SCHEMA,
  type ShadowDecision,
  type ShadowRouteEvent,
} from "./types.js";

export function projectShadowEvent(params: {
  decision: ShadowDecision;
  runIdDigest: string;
  sessionKeyHash?: string;
}): ShadowRouteEvent {
  if (params.decision.apply !== false) {
    throw new Error("shadow event apply must be false");
  }
  if (!isDigest16(params.runIdDigest)) {
    throw new Error("runIdDigest invalid");
  }
  if (params.sessionKeyHash !== undefined && !isDigest16(params.sessionKeyHash)) {
    throw new Error("sessionKeyHash invalid");
  }
  const event: ShadowRouteEvent = {
    schema: SHADOW_EVENT_SCHEMA,
    event: SHADOW_EVENT_NAME,
    runIdDigest: params.runIdDigest,
    ...(params.sessionKeyHash ? { sessionKeyHash: params.sessionKeyHash } : {}),
    reasonCode: params.decision.reasonCode,
    apply: false,
    confidence: params.decision.confidence,
    skillCandidates: params.decision.skillCandidates.map((row) => ({
      nameDigest: row.nameDigest,
      score: row.score,
      rank: row.rank,
    })),
    toolCandidates: params.decision.toolCandidates.map((row) => ({
      nameDigest: row.nameDigest,
      score: row.score,
      rank: row.rank,
    })),
    flags: { ...PHASE1_FLAGS },
  };
  assertNoSensitiveFields(event as unknown as Record<string, unknown>);
  const hits = scanForbiddenSubstrings(JSON.stringify(event));
  if (hits.length > 0) {
    throw new Error(`shadow event privacy hits: ${hits.join(",")}`);
  }
  return event;
}
