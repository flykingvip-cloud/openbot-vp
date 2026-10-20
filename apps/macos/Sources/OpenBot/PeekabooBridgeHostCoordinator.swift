import Foundation
import os
import PeekabooAutomationKit
import PeekabooBridge
import Security

/// Hosts PeekabooBridge inside OpenBot.app so `peekaboo` reuses this signed bundle's TCC grants.
@MainActor
final class PeekabooBridgeHostCoordinator {
    static let shared = PeekabooBridgeHostCoordinator()

    private let logger = Logger(subsystem: "ai.openbot.mac", category: "PeekabooBridge")

    private var host: PeekabooBridgeHost?
    private var services: PeekabooEmbeddedBridgeServices?

    private static let legacySocketDirectoryNames = ["OpenBot", "clawdbot", "clawdis", "moltbot"]

    private(set) var isAvailable = false
    private(set) var lastError: String?

    private static var openbotSocketPath: String {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return Self.makeSocketPath(for: "OpenBot", in: base)
    }

    private static func makeSocketPath(for directoryName: String, in baseDirectory: URL) -> String {
        baseDirectory
            .appendingPathComponent(directoryName, isDirectory: true)
            .appendingPathComponent(PeekabooBridgeConstants.socketName, isDirectory: false)
            .path
    }

    private static var legacySocketPaths: [String] {
        let fileManager = FileManager.default
        let base = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? fileManager.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support")
        return Self.legacySocketDirectoryNames.map { Self.makeSocketPath(for: $0, in: base) }
    }

    func setEnabled(_ enabled: Bool) async {
        if enabled {
            await self.startIfNeeded()
        } else {
            await self.stop()
        }
    }

    func stop() async {
        guard let host else {
            self.isAvailable = false
            return
        }
        _ = await host.stop()
        self.host = nil
        self.services = nil
        self.isAvailable = false
        self.logger.info("PeekabooBridge host stopped")
    }

    private func startIfNeeded() async {
        guard self.host == nil else { return }

        var allowlistedTeamIDs = PeekabooBridgeConstants.trustedReleaseTeamIDs
        if let teamID = Self.currentTeamID() {
            allowlistedTeamIDs.insert(teamID)
        }
        // Team allowlist is the gate; empty bundles let Homebrew-signed peekaboo CLIs
        // connect without a hard-coded bundle ID.
        let allowlistedBundles: Set<String> = []

        self.ensureLegacySocketSymlinks()

        let services = PeekabooEmbeddedBridgeServices()
        do {
            let host = try await PeekabooBridgeBootstrap.startHostChecked(
                services: services,
                hostKind: .gui,
                socketPath: Self.openbotSocketPath,
                allowlistedTeams: allowlistedTeamIDs,
                allowlistedBundles: allowlistedBundles,
                allowedOperations: PeekabooBridgeOperation.embeddedDefaultAllowlist)
            self.services = services
            self.host = host
            self.isAvailable = true
            self.lastError = nil
            self.logger.info("PeekabooBridge host started at \(Self.openbotSocketPath, privacy: .public)")
        } catch {
            self.services = nil
            self.host = nil
            self.isAvailable = false
            self.lastError = error.localizedDescription
            self.logger.error("PeekabooBridge host failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func ensureLegacySocketSymlinks() {
        for legacyPath in Self.legacySocketPaths {
            self.ensureLegacySocketSymlink(at: legacyPath)
        }
    }

    private func ensureLegacySocketSymlink(at legacyPath: String) {
        let fileManager = FileManager.default
        let legacyDirectory = (legacyPath as NSString).deletingLastPathComponent
        do {
            let directoryAttributes: [FileAttributeKey: Any] = [
                .posixPermissions: 0o700,
            ]
            try fileManager.createDirectory(
                atPath: legacyDirectory,
                withIntermediateDirectories: true,
                attributes: directoryAttributes)
            let linkURL = URL(fileURLWithPath: legacyPath)
            let linkValues = try? linkURL.resourceValues(forKeys: [.isSymbolicLinkKey])
            if linkValues?.isSymbolicLink == true {
                let destination = try FileManager.default.destinationOfSymbolicLink(atPath: legacyPath)
                let destinationURL = URL(fileURLWithPath: destination, relativeTo: linkURL.deletingLastPathComponent())
                    .standardizedFileURL
                if destinationURL.path == URL(fileURLWithPath: Self.openbotSocketPath).standardizedFileURL.path {
                    return
                }
                try fileManager.removeItem(atPath: legacyPath)
            } else if fileManager.fileExists(atPath: legacyPath) {
                try fileManager.removeItem(atPath: legacyPath)
            }
            try fileManager.createSymbolicLink(atPath: legacyPath, withDestinationPath: Self.openbotSocketPath)
        } catch {
            let message = "Failed to create legacy PeekabooBridge socket symlink: \(error.localizedDescription)"
            self.logger.debug("\(message, privacy: .public)")
        }
    }

    private static func currentTeamID() -> String? {
        var code: SecCode?
        guard SecCodeCopySelf(SecCSFlags(), &code) == errSecSuccess,
              let code
        else {
            return nil
        }

        var staticCode: SecStaticCode?
        guard SecCodeCopyStaticCode(code, SecCSFlags(), &staticCode) == errSecSuccess,
              let staticCode
        else {
            return nil
        }

        var infoCF: CFDictionary?
        guard SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &infoCF) == errSecSuccess,
            let info = infoCF as? [String: Any]
        else {
            return nil
        }

        return info[kSecCodeInfoTeamIdentifier as String] as? String
    }
}
