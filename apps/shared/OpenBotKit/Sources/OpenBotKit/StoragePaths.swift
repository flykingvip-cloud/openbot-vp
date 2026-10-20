import Foundation

/// On-disk node storage under Application Support / Caches.
/// Folder name is `OpenBot` only. A one-shot rename from legacy `OpenClaw`
/// runs when the legacy folder exists and `OpenBot` does not; after that
/// legacy is not read again.
public enum OpenBotNodeStorage {
    private static let folderName = "OpenBot"
    private static let legacyFolderName = "OpenClaw"

    private static func resolveDir(base: URL, create: Bool = true) throws -> URL {
        let fm = FileManager.default
        let primary = base.appendingPathComponent(folderName, isDirectory: true)
        let legacy = base.appendingPathComponent(legacyFolderName, isDirectory: true)
        if fm.fileExists(atPath: primary.path) {
            return primary
        }
        if fm.fileExists(atPath: legacy.path) {
            try fm.moveItem(at: legacy, to: primary)
            return primary
        }
        if create {
            try fm.createDirectory(at: primary, withIntermediateDirectories: true)
        }
        return primary
    }

    public static func appSupportDir() throws -> URL {
        let base = FileManager().urls(for: .applicationSupportDirectory, in: .userDomainMask).first
        guard let base else {
            throw NSError(domain: "OpenBotNodeStorage", code: 1, userInfo: [
                NSLocalizedDescriptionKey: "Application Support directory unavailable",
            ])
        }
        return try resolveDir(base: base)
    }

    public static func canvasRoot(sessionKey: String) throws -> URL {
        let root = try appSupportDir().appendingPathComponent("canvas", isDirectory: true)
        let safe = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let session = safe.isEmpty ? "main" : safe
        return root.appendingPathComponent(session, isDirectory: true)
    }

    public static func cachesDir() throws -> URL {
        let base = FileManager().urls(for: .cachesDirectory, in: .userDomainMask).first
        guard let base else {
            throw NSError(domain: "OpenBotNodeStorage", code: 2, userInfo: [
                NSLocalizedDescriptionKey: "Caches directory unavailable",
            ])
        }
        return try resolveDir(base: base)
    }

    public static func canvasSnapshotsRoot(sessionKey: String) throws -> URL {
        let root = try cachesDir().appendingPathComponent("canvas-snapshots", isDirectory: true)
        let safe = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
        let session = safe.isEmpty ? "main" : safe
        return root.appendingPathComponent(session, isDirectory: true)
    }
}
