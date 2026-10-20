import Foundation

/// Local path policy for vault sync — mirrors `src/vault-sync/journal/excludes.ts`.
enum VaultSyncPathPolicy {
    private static let alwaysExcludeSubstrings: [String] = [
        "/.openbot/",
        "/node_modules/",
        "/.git/",
        "/embeddings/",
        "/.vault-sync/",
    ]

    private static let alwaysExcludeSuffixes: [String] = [
        ".DS_Store",
        "~",
        ".swp",
        ".swo",
        ".lock",
    ]

    static func normalize(_ relativePath: String) -> String {
        relativePath
            .replacingOccurrences(of: "\\", with: "/")
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    }

    static func isAlwaysExcluded(_ relativePath: String) -> Bool {
        let norm = "/" + self.normalize(relativePath) + "/"
        if self.alwaysExcludeSubstrings.contains(where: { norm.contains($0) }) {
            return true
        }
        let base = self.normalize(relativePath)
        if base.hasPrefix(".openbot/") || base.hasPrefix("embeddings/") || base.hasPrefix(".vault-sync/") {
            return true
        }
        return self.alwaysExcludeSuffixes.contains { base.hasSuffix($0) }
    }

    static func isSafeRelativePath(_ relativePath: String) -> Bool {
        let norm = self.normalize(relativePath)
        guard !norm.isEmpty else { return false }
        if norm.contains("..") { return false }
        return !self.isAlwaysExcluded(norm)
    }
}
