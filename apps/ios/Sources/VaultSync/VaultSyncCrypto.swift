import CryptoKit
import Foundation

enum VaultSyncCryptoError: Error, Equatable {
    case kdfFailed
    case encryptionFailed
    case decryptionFailed
    case invalidPath
}

struct VaultSyncKeySet: Sendable {
    var contentKey: SymmetricKey
    var metadataKey: SymmetricKey
    var pathLookupKey: Data
    var manifestAuthKey: Data

    var contentKeyBytes: Data { self.contentKey.withUnsafeBytes { Data($0) } }
    var metadataKeyBytes: Data { self.metadataKey.withUnsafeBytes { Data($0) } }
}

/// iOS port of `ui/src/ui/vault-sync/client-crypto.ts`.
enum VaultSyncCrypto {
    static let protocolVersion = VaultSyncConstants.protocolVersion

    private static let infoContent = "openbot-vault-sync/content/v1"
    private static let infoMetadata = "openbot-vault-sync/metadata/v1"
    private static let infoPathLookup = "openbot-vault-sync/path-lookup/v1"
    private static let infoManifest = "openbot-vault-sync/manifest-auth/v1"

    static func utf8(_ s: String) -> Data { Data(s.utf8) }

    static func bytesToBase64(_ data: Data) -> String { data.base64EncodedString() }

    static func base64ToBytes(_ b64: String) -> Data {
        Data(base64Encoded: b64) ?? Data()
    }

    static func bytesToBase64Url(_ data: Data) -> String {
        bytesToBase64(data)
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    static func bytesToHex(_ data: Data) -> String {
        data.map { String(format: "%02x", $0) }.joined()
    }

    static func hexToBytes(_ hex: String) -> Data {
        var data = Data()
        var idx = hex.startIndex
        while idx < hex.endIndex {
            let next = hex.index(idx, offsetBy: 2)
            if let b = UInt8(hex[idx..<next], radix: 16) {
                data.append(b)
            }
            idx = next
        }
        return data
    }

    static func sha256(_ data: Data) -> Data {
        Data(SHA256.hash(data: data))
    }

    static func sha256Hex(_ data: Data) -> String { bytesToHex(sha256(data)) }

    static func hmacSha256(key: Data, data: Data) -> Data {
        let mac = HMAC<SHA256>.authenticationCode(for: data, using: SymmetricKey(data: key))
        return Data(mac)
    }

    static func hkdfSha256(ikm: Data, salt: Data, info: Data, length: Int) -> Data {
        // Match browser: PRK = HMAC(salt, ikm); expand with counter.
        let prk = hmacSha256(key: salt, data: ikm)
        var out = Data()
        var prev = Data()
        var counter: UInt8 = 1
        while out.count < length {
            var blockInput = Data()
            blockInput.append(prev)
            blockInput.append(info)
            blockInput.append(counter)
            let block = hmacSha256(key: prk, data: blockInput)
            out.append(block)
            prev = block
            counter &+= 1
        }
        return out.prefix(length)
    }

    private static func hkdfInfoLabel(_ base: String, encryptionVersion: Int) -> Data {
        if encryptionVersion <= 1 {
            return utf8(base)
        }
        return utf8("\(base)/epoch/\(encryptionVersion)")
    }

    static func deriveBaseKey(password: String, salt: Data, N: Int = 16384, r: Int = 8, p: Int = 1, dkLen: Int = 32) throws -> Data {
        guard !password.isEmpty else { throw VaultSyncCryptoError.kdfFailed }
        return try VaultSyncScrypt.derive(
            password: utf8(password),
            salt: salt,
            N: N,
            r: r,
            p: p,
            dkLen: dkLen
        )
    }

    static func deriveVaultKeySet(baseKey: Data, encryptionVersion: Int = 1) -> VaultSyncKeySet {
        let salt = Data(count: 32)
        let content = hkdfSha256(
            ikm: baseKey,
            salt: salt,
            info: hkdfInfoLabel(self.infoContent, encryptionVersion: encryptionVersion),
            length: 32
        )
        let metadata = hkdfSha256(
            ikm: baseKey,
            salt: salt,
            info: hkdfInfoLabel(self.infoMetadata, encryptionVersion: encryptionVersion),
            length: 32
        )
        let pathLookup = hkdfSha256(
            ikm: baseKey,
            salt: salt,
            info: hkdfInfoLabel(self.infoPathLookup, encryptionVersion: encryptionVersion),
            length: 32
        )
        let manifest = hkdfSha256(
            ikm: baseKey,
            salt: salt,
            info: hkdfInfoLabel(self.infoManifest, encryptionVersion: encryptionVersion),
            length: 32
        )
        return VaultSyncKeySet(
            contentKey: SymmetricKey(data: content),
            metadataKey: SymmetricKey(data: metadata),
            pathLookupKey: pathLookup,
            manifestAuthKey: manifest
        )
    }

    static func unlockVaultKeys(
        password: String,
        saltB64: String,
        encryptionVersion: Int = 1,
        baseKey: Data? = nil
    ) throws -> VaultSyncKeySet {
        let resolved = try baseKey ?? deriveBaseKey(password: password, salt: base64ToBytes(saltB64))
        return deriveVaultKeySet(baseKey: resolved, encryptionVersion: encryptionVersion)
    }

    static func buildAad(
        vaultId: String,
        opaquePathId: String,
        revisionId: String,
        encryptionVersion: Int = 1
    ) -> Data {
        utf8("\(vaultId)|\(opaquePathId)|\(revisionId)|\(encryptionVersion)")
    }

    static func buildContentAad(
        vaultId: String,
        opaquePathId: String,
        deviceId: String,
        deviceSequence: UInt64,
        encryptionVersion: Int = 1
    ) -> Data {
        utf8("\(vaultId)|\(opaquePathId)|\(deviceId)|\(deviceSequence)|\(encryptionVersion)")
    }

    static func encryptAead(
        key: SymmetricKey,
        plaintext: Data,
        vaultId: String,
        opaquePathId: String,
        revisionId: String,
        encryptionVersion: Int = 1,
        nonce: Data? = nil,
        aad: Data? = nil
    ) throws -> Data {
        let ivData = nonce ?? Data((0..<12).map { _ in UInt8.random(in: 0...255) })
        guard ivData.count == 12 else { throw VaultSyncCryptoError.encryptionFailed }
        let associated = aad ?? buildAad(
            vaultId: vaultId,
            opaquePathId: opaquePathId,
            revisionId: revisionId,
            encryptionVersion: encryptionVersion
        )
        let nonceObj = try AES.GCM.Nonce(data: ivData)
        let sealed = try AES.GCM.seal(plaintext, using: key, nonce: nonceObj, authenticating: associated)
        var out = Data()
        out.append(ivData)
        out.append(sealed.ciphertext)
        out.append(sealed.tag)
        return out
    }

    static func decryptAead(
        key: SymmetricKey,
        ciphertext: Data,
        vaultId: String,
        opaquePathId: String,
        revisionId: String,
        encryptionVersion: Int = 1,
        aad: Data? = nil
    ) throws -> Data {
        guard ciphertext.count >= 12 + 16 else { throw VaultSyncCryptoError.decryptionFailed }
        let iv = ciphertext.prefix(12)
        let tag = ciphertext.suffix(16)
        let body = ciphertext.dropFirst(12).dropLast(16)
        let associated = aad ?? buildAad(
            vaultId: vaultId,
            opaquePathId: opaquePathId,
            revisionId: revisionId,
            encryptionVersion: encryptionVersion
        )
        do {
            let box = try AES.GCM.SealedBox(
                nonce: AES.GCM.Nonce(data: iv),
                ciphertext: body,
                tag: tag
            )
            return try AES.GCM.open(box, using: key, authenticating: associated)
        } catch {
            throw VaultSyncCryptoError.decryptionFailed
        }
    }

    static func computeOpaquePathId(pathLookupKey: Data, relativePath: String) throws -> String {
        var normalized = relativePath.replacingOccurrences(of: "\\", with: "/")
        if normalized.hasPrefix("./") { normalized.removeFirst(2) }
        if normalized.hasPrefix("/") { normalized.removeFirst() }
        normalized = normalized.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalized.isEmpty, !normalized.contains("..") else {
            throw VaultSyncCryptoError.invalidPath
        }
        return bytesToBase64Url(hmacSha256(key: pathLookupKey, data: utf8(normalized)))
    }

    static func encodeUint64Be(_ n: UInt64) -> Data {
        var be = n.bigEndian
        return Data(bytes: &be, count: 8)
    }

    static func computeRevisionId(
        vaultId: String,
        opaquePathId: String,
        deviceId: String,
        deviceSequence: UInt64,
        ciphertextHash: String,
        parentRevisionIds: [String],
        protocolVersion: Int = protocolVersion
    ) -> String {
        let parents = parentRevisionIds.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
        var parts = Data()
        parts.append(utf8(vaultId))
        parts.append(0)
        parts.append(utf8(opaquePathId))
        parts.append(0)
        parts.append(utf8(deviceId))
        parts.append(0)
        parts.append(encodeUint64Be(deviceSequence))
        parts.append(0)
        parts.append(utf8(ciphertextHash))
        parts.append(0)
        parts.append(utf8(parents.joined(separator: "\n")))
        parts.append(0)
        parts.append(utf8(String(protocolVersion)))
        return bytesToBase64Url(sha256(parts))
    }
}
