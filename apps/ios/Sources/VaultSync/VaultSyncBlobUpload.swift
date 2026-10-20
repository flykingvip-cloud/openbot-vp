import Foundation

/// Pure helpers for vault-sync ciphertext upload sessions (Wave I).
enum VaultSyncBlobUpload {
    struct ChunkRange: Equatable {
        var chunkIndex: Int
        var start: Int
        var end: Int
    }

    static func iterChunkRanges(totalSizeBytes: Int, chunkSize: Int, chunkCount: Int) -> [ChunkRange] {
        precondition(totalSizeBytes >= 0)
        precondition(chunkSize > 0)
        precondition(chunkCount >= 0)
        var ranges: [ChunkRange] = []
        ranges.reserveCapacity(chunkCount)
        for chunkIndex in 0..<chunkCount {
            let start = chunkIndex * chunkSize
            let end = min(start + chunkSize, totalSizeBytes)
            ranges.append(ChunkRange(chunkIndex: chunkIndex, start: start, end: end))
        }
        return ranges
    }

    static func buildChunkPutURL(
        template: String,
        vaultId: String,
        uploadId: String,
        chunkIndex: Int,
        httpOrigin: String
    ) throws -> URL {
        let encodedVault =
            vaultId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? vaultId
        let encodedUpload =
            uploadId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? uploadId
        let path = template
            .replacingOccurrences(of: "{vaultId}", with: encodedVault)
            .replacingOccurrences(of: "{uploadId}", with: encodedUpload)
            .replacingOccurrences(of: "{chunkIndex}", with: String(chunkIndex))
        if path.hasPrefix("http://") || path.hasPrefix("https://") {
            guard let url = URL(string: path) else {
                throw VaultSyncRunnerError.badResponse
            }
            return url
        }
        let origin = httpOrigin.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        guard !origin.isEmpty else {
            throw VaultSyncRunnerError.httpOriginRequired
        }
        let joined = path.hasPrefix("/") ? "\(origin)\(path)" : "\(origin)/\(path)"
        guard let url = URL(string: joined) else {
            throw VaultSyncRunnerError.badResponse
        }
        return url
    }

    static func preferredChunkSize(httpAvailable: Bool) -> Int {
        httpAvailable ? VaultSyncConstants.httpChunkSize : VaultSyncConstants.defaultChunkSize
    }
}
