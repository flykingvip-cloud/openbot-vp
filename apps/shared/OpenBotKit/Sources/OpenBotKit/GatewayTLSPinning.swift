import CryptoKit
import Foundation
import Security

public struct GatewayTLSParams: Sendable {
    public let required: Bool
    public let expectedFingerprint: String?
    public let allowTOFU: Bool
    public let storeKey: String?

    public init(required: Bool, expectedFingerprint: String?, allowTOFU: Bool, storeKey: String?) {
        self.required = required
        self.expectedFingerprint = expectedFingerprint
        self.allowTOFU = allowTOFU
        self.storeKey = storeKey
    }
}

public enum GatewayTLSStore {
    private static let keychainService = "ai.openbot.tls-pinning"
    /// Single generic-password account holding all TOFU fingerprints as JSON.
    private static let bundleAccount = "fingerprints"

    // Legacy UserDefaults location used before Keychain migration.
    private static let suiteName = "ai.openbot.shared"
    private static let legacyKeyPrefix = "gateway.tls."

    public static func loadFingerprint(stableID: String) -> String? {
        self.migrateIntoBundleIfNeeded(stableID: stableID)
        let map = self.loadBundle()
        let raw = map[stableID]?.trimmingCharacters(in: .whitespacesAndNewlines)
        if raw?.isEmpty == false {
            return raw
        }
        return nil
    }

    public static func saveFingerprint(_ value: String, stableID: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.migrateIntoBundleIfNeeded(stableID: stableID)
        var map = self.loadBundle()
        map[stableID] = trimmed
        self.saveBundle(map)
    }

    public static func removeFingerprint(stableID: String) {
        var map = self.loadBundle()
        map.removeValue(forKey: stableID)
        if map.isEmpty {
            _ = GenericPasswordKeychainStore.delete(
                service: self.keychainService, account: self.bundleAccount)
        } else {
            self.saveBundle(map)
        }
        _ = GenericPasswordKeychainStore.delete(service: self.keychainService, account: stableID)
        if let defaults = UserDefaults(suiteName: self.suiteName) {
            defaults.removeObject(forKey: self.legacyKeyPrefix + stableID)
        }
    }

    // MARK: - Bundle + migration

    private static func loadBundle() -> [String: String] {
        guard let data = GenericPasswordKeychainStore.loadData(
            service: self.keychainService,
            account: self.bundleAccount),
            let map = try? JSONDecoder().decode([String: String].self, from: data)
        else {
            return [:]
        }
        return map
    }

    private static func saveBundle(_ map: [String: String]) {
        guard let data = try? JSONEncoder().encode(map) else { return }
        _ = GenericPasswordKeychainStore.saveData(
            data,
            service: self.keychainService,
            account: self.bundleAccount)
    }

    /// Fold legacy per-stableID Keychain accounts and UserDefaults pins into the
    /// unified `fingerprints` item (SecItemUpdate thereafter — one ACL path).
    private static func migrateIntoBundleIfNeeded(stableID: String) {
        var map = self.loadBundle()
        var changed = false

        if map[stableID] == nil,
           let perAccount = GenericPasswordKeychainStore.loadString(
               service: self.keychainService, account: stableID)?
               .trimmingCharacters(in: .whitespacesAndNewlines),
           !perAccount.isEmpty
        {
            map[stableID] = perAccount
            changed = true
        }

        if let defaults = UserDefaults(suiteName: self.suiteName) {
            let legacyKey = self.legacyKeyPrefix + stableID
            if map[stableID] == nil,
               let existing = defaults.string(forKey: legacyKey)?
                   .trimmingCharacters(in: .whitespacesAndNewlines),
               !existing.isEmpty
            {
                map[stableID] = existing
                changed = true
            }
            defaults.removeObject(forKey: legacyKey)
        }

        if changed {
            self.saveBundle(map)
        }
        // Drop legacy per-id Keychain account once the bundle owns the value.
        if map[stableID] != nil {
            _ = GenericPasswordKeychainStore.delete(service: self.keychainService, account: stableID)
        }
    }
}

public final class GatewayTLSPinningSession: NSObject, WebSocketSessioning, URLSessionDelegate, @unchecked Sendable {
    private let params: GatewayTLSParams
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.waitsForConnectivity = true
        return URLSession(configuration: config, delegate: self, delegateQueue: nil)
    }()

    public init(params: GatewayTLSParams) {
        self.params = params
        super.init()
    }

    public func makeWebSocketTask(url: URL) -> WebSocketTaskBox {
        let task = self.session.webSocketTask(with: url)
        task.maximumMessageSize = 16 * 1024 * 1024
        return WebSocketTaskBox(task: task)
    }

    public func urlSession(
        _ session: URLSession,
        didReceive challenge: URLAuthenticationChallenge,
        completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
    ) {
        guard challenge.protectionSpace.authenticationMethod == NSURLAuthenticationMethodServerTrust,
              let trust = challenge.protectionSpace.serverTrust
        else {
            completionHandler(.performDefaultHandling, nil)
            return
        }

        let expected = params.expectedFingerprint.map(normalizeFingerprint)
        if let fingerprint = certificateFingerprint(trust) {
            if let expected {
                if fingerprint == expected {
                    completionHandler(.useCredential, URLCredential(trust: trust))
                } else {
                    completionHandler(.cancelAuthenticationChallenge, nil)
                }
                return
            }
            if params.allowTOFU {
                if let storeKey = params.storeKey {
                    GatewayTLSStore.saveFingerprint(fingerprint, stableID: storeKey)
                }
                completionHandler(.useCredential, URLCredential(trust: trust))
                return
            }
        }

        let ok = SecTrustEvaluateWithError(trust, nil)
        if ok || !params.required {
            completionHandler(.useCredential, URLCredential(trust: trust))
        } else {
            completionHandler(.cancelAuthenticationChallenge, nil)
        }
    }
}

private func certificateFingerprint(_ trust: SecTrust) -> String? {
    guard let chain = SecTrustCopyCertificateChain(trust) as? [SecCertificate],
          let cert = chain.first
    else {
        return nil
    }
    return sha256Hex(SecCertificateCopyData(cert) as Data)
}

private func sha256Hex(_ data: Data) -> String {
    let digest = SHA256.hash(data: data)
    return digest.map { String(format: "%02x", $0) }.joined()
}

private func normalizeFingerprint(_ raw: String) -> String {
    let stripped = raw.replacingOccurrences(
        of: #"(?i)^sha-?256\s*:?\s*"#,
        with: "",
        options: .regularExpression)
    return stripped.lowercased().filter(\.isHexDigit)
}
