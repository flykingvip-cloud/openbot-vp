/**
 * Browser client ciphertext blob upload — direct put or chunked upload session.
 */
import { bytesToBase64 } from "./bytes.ts";
import { ciphertextToBase64, DIRECT_PUT_MAX_BYTES } from "./client-crypto.ts";
import type { VaultSyncClientGateway } from "./client-sync-types.ts";

export const VAULT_SYNC_DEFAULT_CHUNK_SIZE = 256 * 1024;

export type BlobUploadSessionWire = {
  uploadId: string;
  vaultId: string;
  deviceId: string;
  ciphertextHash: string;
  totalSizeBytes: number;
  chunkSize: number;
  chunkCount: number;
  receivedChunkIndexes?: number[];
  status?: string;
};

export function iterCiphertextChunkRanges(params: {
  totalSizeBytes: number;
  chunkSize: number;
  chunkCount: number;
}): Array<{ chunkIndex: number; start: number; end: number }> {
  const ranges: Array<{ chunkIndex: number; start: number; end: number }> = [];
  for (let chunkIndex = 0; chunkIndex < params.chunkCount; chunkIndex += 1) {
    const start = chunkIndex * params.chunkSize;
    const end = Math.min(start + params.chunkSize, params.totalSizeBytes);
    ranges.push({ chunkIndex, start, end });
  }
  return ranges;
}

export async function storeCiphertextBlob(params: {
  gateway: VaultSyncClientGateway;
  vaultId: string;
  deviceId: string;
  ciphertext: Uint8Array;
  ciphertextHash: string;
}): Promise<{ blobId: string }> {
  if (params.ciphertext.length <= DIRECT_PUT_MAX_BYTES) {
    const blob = await params.gateway.putVaultSyncBlob({
      vaultId: params.vaultId,
      deviceId: params.deviceId,
      ciphertextHash: params.ciphertextHash,
      contentBase64: ciphertextToBase64(params.ciphertext),
    });
    if (!blob.blobId) {
      throw new Error("blob upload rejected");
    }
    return { blobId: blob.blobId };
  }
  if (
    !params.gateway.createVaultSyncUploadSession ||
    !params.gateway.putVaultSyncUploadChunk ||
    !params.gateway.completeVaultSyncUploadSession
  ) {
    throw new Error("upload session RPC unavailable");
  }

  const created = await params.gateway.createVaultSyncUploadSession({
    vaultId: params.vaultId,
    deviceId: params.deviceId,
    ciphertextHash: params.ciphertextHash,
    totalSizeBytes: params.ciphertext.length,
    chunkSize: VAULT_SYNC_DEFAULT_CHUNK_SIZE,
  });
  const session = created.session as BlobUploadSessionWire | undefined;
  if (!session?.uploadId) {
    throw new Error("upload session create failed");
  }

  try {
    for (const range of iterCiphertextChunkRanges({
      totalSizeBytes: params.ciphertext.length,
      chunkSize: session.chunkSize,
      chunkCount: session.chunkCount,
    })) {
      const chunk = params.ciphertext.subarray(range.start, range.end);
      await params.gateway.putVaultSyncUploadChunk({
        vaultId: params.vaultId,
        uploadId: session.uploadId,
        chunkIndex: range.chunkIndex,
        contentBase64: bytesToBase64(chunk),
      });
    }
    const completed = await params.gateway.completeVaultSyncUploadSession({
      vaultId: params.vaultId,
      uploadId: session.uploadId,
    });
    if (!completed.blobId) {
      throw new Error("upload session complete failed");
    }
    return { blobId: completed.blobId };
  } catch (error) {
    await params.gateway
      .abortVaultSyncUploadSession?.({
        vaultId: params.vaultId,
        uploadId: session.uploadId,
      })
      .catch(() => undefined);
    throw error;
  }
}
