import Foundation
import Testing

@Suite struct VaultSyncBlobUploadTests {
    @Test func iterChunkRangesCoversExactAndPartialTail() {
        let ranges = VaultSyncBlobUpload.iterChunkRanges(
            totalSizeBytes: 10,
            chunkSize: 4,
            chunkCount: 3
        )
        #expect(ranges.map { ($0.start, $0.end) } == [(0, 4), (4, 8), (8, 10)])
    }

    @Test func buildChunkPutURLJoinsOrigin() throws {
        let url = try VaultSyncBlobUpload.buildChunkPutURL(
            template: VaultSyncConstants.httpChunkPathTemplate,
            vaultId: "vault-1",
            uploadId: "upload-2",
            chunkIndex: 3,
            httpOrigin: "https://gw.example:18789/"
        )
        #expect(url.absoluteString.hasPrefix("https://gw.example:18789/__openbot/vault-sync/v1/"))
        #expect(url.absoluteString.contains("/chunks/3"))
    }

    @Test func preferredChunkSizePicksHttpWhenAvailable() {
        #expect(
            VaultSyncBlobUpload.preferredChunkSize(httpAvailable: true)
                == VaultSyncConstants.httpChunkSize
        )
        #expect(
            VaultSyncBlobUpload.preferredChunkSize(httpAvailable: false)
                == VaultSyncConstants.defaultChunkSize
        )
    }
}
