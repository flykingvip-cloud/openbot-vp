import Foundation

protocol VaultSyncRpcClient: AnyObject, Sendable {
    func request(method: String, paramsJSON: String) async throws -> Data
}

struct VaultSyncStatusSnapshot: Sendable {
    var saltB64: String
    var encryptionVersion: Int
}

struct VaultSyncRevisionWire: Sendable {
    var vaultId: String
    var opaquePathId: String
    var revisionId: String
    var parentRevisionIds: [String]
    var deviceId: String
    var deviceSequence: UInt64
    var encryptedMetadataB64: String
    var ciphertextBlobId: String?
    var plaintextSize: Int64
    var ciphertextHash: String
    var tombstone: Bool
    var createdAt: String
    var protocolVersion: Int
    var encryptionVersion: Int
}

/// Thin JSON-RPC client for vault-sync over operator gateway.
final class VaultSyncGatewayClient: @unchecked Sendable {
    private let rpc: any VaultSyncRpcClient
    private let httpOriginProvider: @Sendable () -> String?
    private let urlSession: URLSession

    init(
        rpc: any VaultSyncRpcClient,
        httpOriginProvider: @escaping @Sendable () -> String? = { nil },
        urlSession: URLSession = .shared
    ) {
        self.rpc = rpc
        self.httpOriginProvider = httpOriginProvider
        self.urlSession = urlSession
    }

    func status(vaultId: String) async throws -> VaultSyncStatusSnapshot {
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.status",
            paramsJSON: #"{"vaultId":\#(Self.jsonString(vaultId))}"#
        )
        let obj = try Self.jsonObject(data)
        guard let salt = obj["saltB64"] as? String, !salt.isEmpty else {
            throw VaultSyncRunnerError.saltUnavailable
        }
        let epoch = (obj["encryptionVersion"] as? Int) ?? 1
        return VaultSyncStatusSnapshot(saltB64: salt, encryptionVersion: epoch)
    }

    func deviceLastSequence(vaultId: String, deviceId: String) async throws -> UInt64 {
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.devices.list",
            paramsJSON: #"{"vaultId":\#(Self.jsonString(vaultId))}"#
        )
        let obj = try Self.jsonObject(data)
        let devices = obj["devices"] as? [[String: Any]] ?? []
        for row in devices {
            if (row["deviceId"] as? String) == deviceId {
                if let n = row["lastSequence"] as? NSNumber { return n.uint64Value }
                if let i = row["lastSequence"] as? Int { return UInt64(i) }
            }
        }
        return 0
    }

    func headsForPath(vaultId: String, opaquePathId: String) async throws -> [String] {
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.inventory",
            paramsJSON: #"{"vaultId":\#(Self.jsonString(vaultId)),"cursor":null,"limit":2000}"#
        )
        let obj = try Self.jsonObject(data)
        let items = obj["items"] as? [[String: Any]] ?? []
        for row in items where (row["opaquePathId"] as? String) == opaquePathId {
            return row["heads"] as? [String] ?? []
        }
        return []
    }

    func putBlob(vaultId: String, deviceId: String, ciphertextHash: String, contentBase64: String) async throws -> String {
        let params: [String: Any] = [
            "vaultId": vaultId,
            "deviceId": deviceId,
            "ciphertextHash": ciphertextHash,
            "contentBase64": contentBase64,
        ]
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.put",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        guard let blobId = obj["blobId"] as? String, !blobId.isEmpty else {
            throw VaultSyncRunnerError.blobRejected
        }
        return blobId
    }

    /// Store ciphertext: direct put ≤1MiB; larger uses upload-session (HTTP binary preferred).
    func storeCiphertextBlob(
        vaultId: String,
        deviceId: String,
        ciphertextHash: String,
        ciphertext: Data
    ) async throws -> String {
        if ciphertext.count <= VaultSyncConstants.directPutMaxBytes {
            return try await self.putBlob(
                vaultId: vaultId,
                deviceId: deviceId,
                ciphertextHash: ciphertextHash,
                contentBase64: VaultSyncCrypto.bytesToBase64(ciphertext)
            )
        }
        let httpOrigin = (self.httpOriginProvider() ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let httpAvailable = !httpOrigin.isEmpty
        let chunkSize = VaultSyncBlobUpload.preferredChunkSize(httpAvailable: httpAvailable)
        let created = try await self.createUploadSession(
            vaultId: vaultId,
            deviceId: deviceId,
            ciphertextHash: ciphertextHash,
            totalSizeBytes: ciphertext.count,
            chunkSize: chunkSize
        )
        do {
            if let objectUpload = created.objectUpload {
                try await self.putObjectUploadDirect(objectUpload: objectUpload, ciphertext: ciphertext)
                return try await self.completeUploadSession(
                    vaultId: vaultId,
                    uploadId: created.session.uploadId
                )
            }
            let useHttp = httpAvailable && created.http != nil
            let ranges = VaultSyncBlobUpload.iterChunkRanges(
                totalSizeBytes: ciphertext.count,
                chunkSize: created.session.chunkSize,
                chunkCount: created.session.chunkCount
            )
            for range in ranges {
                let chunk = ciphertext.subdata(in: range.start..<range.end)
                if useHttp, let http = created.http {
                    try await self.putUploadChunkHttp(
                        vaultId: vaultId,
                        uploadId: created.session.uploadId,
                        chunkIndex: range.chunkIndex,
                        bytes: chunk,
                        uploadToken: http.token,
                        chunkPutPathTemplate: http.chunkPutPathTemplate,
                        httpOrigin: httpOrigin
                    )
                } else {
                    try await self.putUploadChunkWs(
                        vaultId: vaultId,
                        uploadId: created.session.uploadId,
                        chunkIndex: range.chunkIndex,
                        contentBase64: VaultSyncCrypto.bytesToBase64(chunk)
                    )
                }
            }
            return try await self.completeUploadSession(
                vaultId: vaultId,
                uploadId: created.session.uploadId
            )
        } catch {
            try? await self.abortUploadSession(vaultId: vaultId, uploadId: created.session.uploadId)
            throw error
        }
    }

    private struct CreatedUpload {
        var session: (uploadId: String, chunkSize: Int, chunkCount: Int)
        var http: (token: String, chunkPutPathTemplate: String)?
        var objectUpload: (url: URL, headers: [String: String])?
    }

    private func createUploadSession(
        vaultId: String,
        deviceId: String,
        ciphertextHash: String,
        totalSizeBytes: Int,
        chunkSize: Int
    ) async throws -> CreatedUpload {
        let params: [String: Any] = [
            "vaultId": vaultId,
            "deviceId": deviceId,
            "ciphertextHash": ciphertextHash,
            "totalSizeBytes": totalSizeBytes,
            "chunkSize": chunkSize,
        ]
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.upload-session.create",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        guard
            let session = obj["session"] as? [String: Any],
            let uploadId = session["uploadId"] as? String,
            !uploadId.isEmpty
        else {
            throw VaultSyncRunnerError.uploadSessionFailed
        }
        let resolvedChunkSize = (session["chunkSize"] as? Int) ?? chunkSize
        let chunkCount = (session["chunkCount"] as? Int) ?? 1
        var http: (token: String, chunkPutPathTemplate: String)?
        if let httpUpload = obj["httpUpload"] as? [String: Any],
           let token = httpUpload["token"] as? String,
           !token.isEmpty
        {
            let template =
                (httpUpload["chunkPutPathTemplate"] as? String)
                ?? VaultSyncConstants.httpChunkPathTemplate
            http = (token, template)
        }
        var objectUpload: (url: URL, headers: [String: String])?
        if let objectUploadObj = obj["objectUpload"] as? [String: Any],
           let put = objectUploadObj["put"] as? [String: Any],
           let urlString = put["url"] as? String,
           let url = URL(string: urlString)
        {
            let headers = (put["headers"] as? [String: String]) ?? [:]
            objectUpload = (url, headers)
        }
        return CreatedUpload(
            session: (uploadId, resolvedChunkSize, chunkCount),
            http: http,
            objectUpload: objectUpload
        )
    }

    private func putObjectUploadDirect(
        objectUpload: (url: URL, headers: [String: String]),
        ciphertext: Data
    ) async throws {
        var request = URLRequest(url: objectUpload.url)
        request.httpMethod = "PUT"
        for (key, value) in objectUpload.headers {
            request.setValue(value, forHTTPHeaderField: key)
        }
        request.httpBody = ciphertext
        let (_, response) = try await self.urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
            throw VaultSyncRunnerError.uploadSessionFailed
        }
    }

    private func putUploadChunkWs(
        vaultId: String,
        uploadId: String,
        chunkIndex: Int,
        contentBase64: String
    ) async throws {
        let params: [String: Any] = [
            "vaultId": vaultId,
            "uploadId": uploadId,
            "chunkIndex": chunkIndex,
            "contentBase64": contentBase64,
        ]
        _ = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.upload-session.put-chunk",
            paramsJSON: try Self.jsonParams(params)
        )
    }

    private func putUploadChunkHttp(
        vaultId: String,
        uploadId: String,
        chunkIndex: Int,
        bytes: Data,
        uploadToken: String,
        chunkPutPathTemplate: String,
        httpOrigin: String
    ) async throws {
        let url = try VaultSyncBlobUpload.buildChunkPutURL(
            template: chunkPutPathTemplate,
            vaultId: vaultId,
            uploadId: uploadId,
            chunkIndex: chunkIndex,
            httpOrigin: httpOrigin
        )
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/octet-stream", forHTTPHeaderField: "Content-Type")
        request.setValue(uploadToken, forHTTPHeaderField: "X-OpenBot-Vault-Upload-Token")
        request.httpBody = bytes
        let (_, response) = try await self.urlSession.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            throw VaultSyncRunnerError.uploadSessionFailed
        }
    }

    private func completeUploadSession(vaultId: String, uploadId: String) async throws -> String {
        let params: [String: Any] = ["vaultId": vaultId, "uploadId": uploadId]
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.upload-session.complete",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        guard let blobId = obj["blobId"] as? String, !blobId.isEmpty else {
            throw VaultSyncRunnerError.uploadSessionFailed
        }
        return blobId
    }

    private func abortUploadSession(vaultId: String, uploadId: String) async throws {
        let params: [String: Any] = ["vaultId": vaultId, "uploadId": uploadId]
        _ = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.upload-session.abort",
            paramsJSON: try Self.jsonParams(params)
        )
    }

    func getBlob(vaultId: String, blobId: String) async throws -> Data {
        let params: [String: Any] = ["vaultId": vaultId, "blobId": blobId]
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.blobs.get",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        guard let b64 = obj["contentBase64"] as? String, !b64.isEmpty else {
            throw VaultSyncRunnerError.blobMissing
        }
        return VaultSyncCrypto.base64ToBytes(b64)
    }

    func commitRevision(revision: [String: Any], idempotencyKey: String) async throws -> String {
        let params: [String: Any] = ["revision": revision, "idempotencyKey": idempotencyKey]
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.revisions.commit",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        let result = obj["result"] as? [String: Any]
        return (result?["status"] as? String) ?? "rejected"
    }

    func listRevisionsSince(vaultId: String, cursor: String?, limit: Int = 100) async throws -> (
        [VaultSyncRevisionWire], String?
    ) {
        var params: [String: Any] = ["vaultId": vaultId, "limit": limit]
        if let cursor { params["cursor"] = cursor } else { params["cursor"] = NSNull() }
        let data = try await self.rpc.request(
            method: "knowledge.vault-sync.revisions.list-since",
            paramsJSON: try Self.jsonParams(params)
        )
        let obj = try Self.jsonObject(data)
        let rows = obj["revisions"] as? [[String: Any]] ?? []
        let revisions: [VaultSyncRevisionWire] = rows.compactMap { r in
            guard
                let vaultId = r["vaultId"] as? String,
                let opaquePathId = r["opaquePathId"] as? String,
                let revisionId = r["revisionId"] as? String,
                let deviceId = r["deviceId"] as? String,
                let encryptedMetadataB64 = r["encryptedMetadataB64"] as? String,
                let ciphertextHash = r["ciphertextHash"] as? String,
                let createdAt = r["createdAt"] as? String
            else { return nil }
            let seq: UInt64 = {
                if let n = r["deviceSequence"] as? NSNumber { return n.uint64Value }
                if let i = r["deviceSequence"] as? Int { return UInt64(i) }
                return 0
            }()
            let size: Int64 = {
                if let n = r["plaintextSize"] as? NSNumber { return n.int64Value }
                if let i = r["plaintextSize"] as? Int { return Int64(i) }
                return 0
            }()
            return VaultSyncRevisionWire(
                vaultId: vaultId,
                opaquePathId: opaquePathId,
                revisionId: revisionId,
                parentRevisionIds: r["parentRevisionIds"] as? [String] ?? [],
                deviceId: deviceId,
                deviceSequence: seq,
                encryptedMetadataB64: encryptedMetadataB64,
                ciphertextBlobId: r["ciphertextBlobId"] as? String,
                plaintextSize: size,
                ciphertextHash: ciphertextHash,
                tombstone: (r["tombstone"] as? Bool) ?? false,
                createdAt: createdAt,
                protocolVersion: (r["protocolVersion"] as? Int) ?? 1,
                encryptionVersion: (r["encryptionVersion"] as? Int) ?? 1
            )
        }
        return (revisions, obj["nextCursor"] as? String)
    }

    private static func jsonObject(_ data: Data) throws -> [String: Any] {
        let any = try JSONSerialization.jsonObject(with: data)
        guard let obj = any as? [String: Any] else {
            throw VaultSyncRunnerError.badResponse
        }
        return obj
    }

    private static func jsonParams(_ obj: [String: Any]) throws -> String {
        let data = try JSONSerialization.data(withJSONObject: obj)
        return String(data: data, encoding: .utf8) ?? "{}"
    }

    private static func jsonString(_ s: String) -> String {
        let data = try? JSONSerialization.data(withJSONObject: s)
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "\"\""
    }
}

enum VaultSyncRunnerError: Error, Equatable {
    case saltUnavailable
    case blobRejected
    case blobMissing
    case badResponse
    case locked
    case noBindings
    case httpOriginRequired
    case uploadSessionFailed
}
