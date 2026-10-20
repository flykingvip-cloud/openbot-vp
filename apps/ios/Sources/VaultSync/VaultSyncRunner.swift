import Foundation
import OpenBotKit

/// Real iOS vault sync runner (Wave E/I / P3): unlock → push (direct/HTTP) → pull apply.
final class VaultSyncRunner: VaultSyncRunning, @unchecked Sendable {
    private let gateway: VaultSyncGatewayClient
    private let fileStore: VaultSyncLocalFileStore
    private let secureStoreBackend: VaultSyncSecureStoreBackend

    init(
        gateway: VaultSyncGatewayClient,
        fileStore: VaultSyncLocalFileStore = VaultSyncLocalFileStore(),
        secureStoreBackend: VaultSyncSecureStoreBackend = KeychainVaultSyncSecureStoreBackend()
    ) {
        self.gateway = gateway
        self.fileStore = fileStore
        self.secureStoreBackend = secureStoreBackend
    }

    func runSync(trigger: VaultSyncTrigger) async -> VaultSyncRunResult {
        let bindings = VaultSyncSecureStore.listBindings(backend: self.secureStoreBackend)
        if bindings.isEmpty {
            return VaultSyncRunResult(ok: true, uploaded: 0, downloaded: 0, message: "no vault bindings")
        }
        var uploaded = 0
        var downloaded = 0
        var errors: [String] = []
        for binding in bindings {
            let password =
                VaultSyncUnlockMemory.shared.password(vaultId: binding.vaultId)
                ?? (binding.rememberPassword
                    ? VaultSyncSecureStore.loadPassword(
                        vaultId: binding.vaultId,
                        backend: self.secureStoreBackend
                    )
                    : nil)
            guard let password, !password.isEmpty else {
                errors.append("\(binding.vaultId): locked")
                continue
            }
            do {
                let result = try await self.syncVault(binding: binding, password: password)
                uploaded += result.uploaded
                downloaded += result.downloaded
                errors.append(contentsOf: result.errors)
            } catch {
                errors.append("\(binding.vaultId): \(error.localizedDescription)")
            }
        }
        let ok = errors.isEmpty || uploaded + downloaded > 0
        return VaultSyncRunResult(
            ok: ok,
            uploaded: uploaded,
            downloaded: downloaded,
            message: errors.isEmpty ? nil : errors.prefix(3).joined(separator: "; ")
        )
    }

    private struct VaultResult {
        var uploaded: Int
        var downloaded: Int
        var errors: [String]
    }

    private func syncVault(binding: VaultSyncBinding, password: String) async throws -> VaultResult {
        _ = try self.fileStore.ensureVaultLayout(vaultId: binding.vaultId, deviceId: binding.deviceId)
        let status = try await self.gateway.status(vaultId: binding.vaultId)
        let keys = try VaultSyncCrypto.unlockVaultKeys(
            password: password,
            saltB64: status.saltB64,
            encryptionVersion: status.encryptionVersion
        )
        let push = try await self.pushVault(
            binding: binding,
            keys: keys,
            encryptionVersion: status.encryptionVersion
        )
        let pull = try await self.pullVault(binding: binding, keys: keys)
        return VaultResult(
            uploaded: push.uploaded,
            downloaded: pull.downloaded,
            errors: push.errors + pull.errors
        )
    }

    private func pushVault(
        binding: VaultSyncBinding,
        keys: VaultSyncKeySet,
        encryptionVersion: Int
    ) async throws -> (uploaded: Int, errors: [String]) {
        var errors: [String] = []
        var uploaded = 0
        var deviceSequence = try await self.gateway.deviceLastSequence(
            vaultId: binding.vaultId,
            deviceId: binding.deviceId
        )
        var baseline = VaultSyncInventoryBaseline.load(
            fileStore: self.fileStore,
            vaultId: binding.vaultId,
            deviceId: binding.deviceId
        )
        let files = VaultSyncFileWalker.walk(
            vaultFilesURL: self.fileStore.vaultFilesURL(vaultId: binding.vaultId)
        )
        for entry in files {
            if !VaultSyncInventoryBaseline.changed(
                baseline,
                relativePath: entry.relativePath,
                sizeBytes: entry.sizeBytes,
                mtimeMs: entry.mtimeMs
            ) {
                continue
            }
            do {
                deviceSequence += 1
                let plaintext = try Data(contentsOf: entry.url)
                let opaquePathId = try VaultSyncCrypto.computeOpaquePathId(
                    pathLookupKey: keys.pathLookupKey,
                    relativePath: entry.relativePath
                )
                let parents = try await self.gateway.headsForPath(
                    vaultId: binding.vaultId,
                    opaquePathId: opaquePathId
                )
                let contentAad = VaultSyncCrypto.buildContentAad(
                    vaultId: binding.vaultId,
                    opaquePathId: opaquePathId,
                    deviceId: binding.deviceId,
                    deviceSequence: deviceSequence,
                    encryptionVersion: encryptionVersion
                )
                let body = try VaultSyncCrypto.encryptAead(
                    key: keys.contentKey,
                    plaintext: plaintext,
                    vaultId: binding.vaultId,
                    opaquePathId: opaquePathId,
                    revisionId: "content",
                    encryptionVersion: encryptionVersion,
                    aad: contentAad
                )
                let bodyHash = VaultSyncCrypto.sha256Hex(body)
                let revisionId = VaultSyncCrypto.computeRevisionId(
                    vaultId: binding.vaultId,
                    opaquePathId: opaquePathId,
                    deviceId: binding.deviceId,
                    deviceSequence: deviceSequence,
                    ciphertextHash: bodyHash,
                    parentRevisionIds: parents
                )
                let blobId = try await self.gateway.storeCiphertextBlob(
                    vaultId: binding.vaultId,
                    deviceId: binding.deviceId,
                    ciphertextHash: bodyHash,
                    ciphertext: body
                )
                let meta: [String: Any] = [
                    "relativePath": entry.relativePath,
                    "fileName": entry.fileName,
                    "mimeType": VaultSyncFileWalker.guessMime(fileName: entry.fileName),
                    "mtimeMs": entry.mtimeMs,
                ]
                let metaData = try JSONSerialization.data(withJSONObject: meta)
                let metaEnc = try VaultSyncCrypto.encryptAead(
                    key: keys.metadataKey,
                    plaintext: metaData,
                    vaultId: binding.vaultId,
                    opaquePathId: opaquePathId,
                    revisionId: revisionId,
                    encryptionVersion: encryptionVersion
                )
                let revision: [String: Any] = [
                    "vaultId": binding.vaultId,
                    "opaquePathId": opaquePathId,
                    "revisionId": revisionId,
                    "parentRevisionIds": parents,
                    "deviceId": binding.deviceId,
                    "deviceSequence": deviceSequence,
                    "encryptedMetadataB64": VaultSyncCrypto.bytesToBase64(metaEnc),
                    "ciphertextBlobId": blobId,
                    "plaintextSize": plaintext.count,
                    "ciphertextHash": bodyHash,
                    "tombstone": false,
                    "createdAt": ISO8601DateFormatter().string(from: Date()),
                    "protocolVersion": VaultSyncConstants.protocolVersion,
                    "encryptionVersion": encryptionVersion,
                ]
                let status = try await self.gateway.commitRevision(
                    revision: revision,
                    idempotencyKey: "\(binding.deviceId):\(deviceSequence)"
                )
                if status == "accepted" || status == "duplicate" || status == "conflict" {
                    if status != "conflict" { uploaded += 1 }
                    baseline.entries[entry.relativePath] = VaultSyncBaselineEntry(
                        relativePath: entry.relativePath,
                        sizeBytes: entry.sizeBytes,
                        mtimeMs: entry.mtimeMs,
                        lastRevisionId: revisionId
                    )
                } else {
                    errors.append("\(entry.relativePath): commit \(status)")
                }
            } catch {
                errors.append("\(entry.relativePath): \(error.localizedDescription)")
            }
        }
        try VaultSyncInventoryBaseline.save(baseline, fileStore: self.fileStore)
        return (uploaded, errors)
    }

    private func pullVault(
        binding: VaultSyncBinding,
        keys: VaultSyncKeySet
    ) async throws -> (downloaded: Int, errors: [String]) {
        var errors: [String] = []
        var applied = 0
        var cursor: String?
        var baseline = VaultSyncInventoryBaseline.load(
            fileStore: self.fileStore,
            vaultId: binding.vaultId,
            deviceId: binding.deviceId
        )
        for _ in 0..<50 {
            let (revisions, next) = try await self.gateway.listRevisionsSince(
                vaultId: binding.vaultId,
                cursor: cursor
            )
            for rev in revisions where rev.deviceId != binding.deviceId {
                do {
                    let metaPlain = try VaultSyncCrypto.decryptAead(
                        key: keys.metadataKey,
                        ciphertext: VaultSyncCrypto.base64ToBytes(rev.encryptedMetadataB64),
                        vaultId: rev.vaultId,
                        opaquePathId: rev.opaquePathId,
                        revisionId: rev.revisionId,
                        encryptionVersion: rev.encryptionVersion
                    )
                    let metaAny = try JSONSerialization.jsonObject(with: metaPlain)
                    guard
                        let meta = metaAny as? [String: Any],
                        let relativePath = meta["relativePath"] as? String,
                        !relativePath.isEmpty
                    else {
                        errors.append("\(rev.revisionId): missing relativePath")
                        continue
                    }
                    if rev.tombstone || (rev.ciphertextBlobId?.isEmpty ?? true) {
                        baseline.entries.removeValue(forKey: relativePath)
                        applied += 1
                        continue
                    }
                    let ciphertext = try await self.gateway.getBlob(
                        vaultId: rev.vaultId,
                        blobId: rev.ciphertextBlobId!
                    )
                    let contentAad = VaultSyncCrypto.buildContentAad(
                        vaultId: rev.vaultId,
                        opaquePathId: rev.opaquePathId,
                        deviceId: rev.deviceId,
                        deviceSequence: rev.deviceSequence,
                        encryptionVersion: rev.encryptionVersion
                    )
                    let plaintext = try VaultSyncCrypto.decryptAead(
                        key: keys.contentKey,
                        ciphertext: ciphertext,
                        vaultId: rev.vaultId,
                        opaquePathId: rev.opaquePathId,
                        revisionId: "content",
                        encryptionVersion: rev.encryptionVersion,
                        aad: contentAad
                    )
                    try self.fileStore.writeFile(
                        vaultId: binding.vaultId,
                        relativePath: relativePath,
                        data: plaintext
                    )
                    let mtimeMs: Int64 = {
                        if let n = meta["mtimeMs"] as? NSNumber { return n.int64Value }
                        if let i = meta["mtimeMs"] as? Int { return Int64(i) }
                        return Int64(Date().timeIntervalSince1970 * 1000)
                    }()
                    baseline.entries[relativePath] = VaultSyncBaselineEntry(
                        relativePath: relativePath,
                        sizeBytes: Int64(plaintext.count),
                        mtimeMs: mtimeMs,
                        lastRevisionId: rev.revisionId
                    )
                    applied += 1
                } catch {
                    errors.append("\(rev.revisionId): \(error.localizedDescription)")
                }
            }
            guard let next, !next.isEmpty else { break }
            cursor = next
        }
        try VaultSyncInventoryBaseline.save(baseline, fileStore: self.fileStore)
        return (applied, errors)
    }
}

/// Adapts `GatewayNodeSession` actor to vault-sync RPC.
final class GatewayVaultSyncRpcAdapter: VaultSyncRpcClient, @unchecked Sendable {
    private let session: GatewayNodeSession

    init(session: GatewayNodeSession) {
        self.session = session
    }

    func request(method: String, paramsJSON: String) async throws -> Data {
        try await self.session.request(method: method, paramsJSON: paramsJSON, timeoutSeconds: 30)
    }
}
