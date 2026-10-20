import {
  createCloudNonce,
  type CloudAuthContext,
  type CloudIntelligenceClient,
  type CloudPullItem,
} from "./cloud-client.js";
import type { LocalIntelligenceMirror, MirrorPullBatchItem } from "./local-mirror.js";

/**
 * CW2-P5-03 async pull into Local Intelligence Mirror.
 * Failures leave last-good mirror intact and mark freshness stale/never_synced.
 */

export type PullIntoMirrorResult =
  | {
      ok: true;
      applied: number;
      skipped: number;
      itemCount: number;
      nextCursor: string;
      fullSnapshot: boolean;
    }
  | {
      ok: false;
      code: string;
      message: string;
      /** Last-good mirror remains queryable. */
      preserved: true;
    };

function toBatchItems(items: ReadonlyArray<CloudPullItem>): MirrorPullBatchItem[] {
  return items.map((item) =>
    item.kind === "live"
      ? { kind: "live", envelope: item.envelope, etag: item.etag }
      : {
          kind: "tombstone",
          atomId: item.atomId,
          atomVersion: item.atomVersion,
          etag: item.etag,
        },
  );
}

export async function pullIntoMirror(params: {
  client: CloudIntelligenceClient;
  mirror: LocalIntelligenceMirror;
  auth: CloudAuthContext;
  nowMs?: number;
  limit?: number;
  /** Override cursor; default uses mirror-stored cursor. */
  cursor?: string | null;
}): Promise<PullIntoMirrorResult> {
  const nowMs = params.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const cursor =
    params.cursor === null ? undefined : (params.cursor ?? (await params.mirror.getCursor()));

  try {
    const pulled = await params.client.pull(
      {
        cursor,
        nonce: createCloudNonce(),
        timestampMs: nowMs,
        limit: params.limit,
      },
      params.auth,
    );

    if (!pulled.ok) {
      await params.mirror.markPullAttempt({
        ok: false,
        now,
        error: `${pulled.code}:${pulled.message}`,
      });
      return {
        ok: false,
        code: pulled.code,
        message: pulled.message,
        preserved: true,
      };
    }

    const batch = await params.mirror.applyPullBatch({
      tenantId: params.auth.tenantId,
      items: toBatchItems(pulled.items),
      cursor: pulled.nextCursor,
      now,
    });
    await params.mirror.markPullAttempt({
      ok: true,
      cursor: pulled.nextCursor,
      now,
    });

    return {
      ok: true,
      applied: batch.applied,
      skipped: batch.skipped,
      itemCount: pulled.items.length,
      nextCursor: pulled.nextCursor,
      fullSnapshot: pulled.fullSnapshot,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await params.mirror.markPullAttempt({
      ok: false,
      now,
      error: message,
    });
    return {
      ok: false,
      code: "PULL_ERROR",
      message,
      preserved: true,
    };
  }
}
