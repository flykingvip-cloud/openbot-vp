import Foundation

struct VaultSyncLocalFile: Sendable {
    var relativePath: String
    var fileName: String
    var sizeBytes: Int64
    var mtimeMs: Int64
    var url: URL
}

enum VaultSyncFileWalker {
    static func walk(vaultFilesURL: URL) -> [VaultSyncLocalFile] {
        let fm = FileManager.default
        guard let enumerator = fm.enumerator(
            at: vaultFilesURL,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey],
            options: [.skipsHiddenFiles]
        ) else { return [] }
        var out: [VaultSyncLocalFile] = []
        for case let url as URL in enumerator {
            let values = try? url.resourceValues(forKeys: [
                .isRegularFileKey, .fileSizeKey, .contentModificationDateKey,
            ])
            guard values?.isRegularFile == true else { continue }
            let rootPath = vaultFilesURL.standardizedFileURL.path
            var rel = url.standardizedFileURL.path
            if rel.hasPrefix(rootPath) {
                rel = String(rel.dropFirst(rootPath.count))
            }
            rel = VaultSyncPathPolicy.normalize(rel)
            guard VaultSyncPathPolicy.isSafeRelativePath(rel) else { continue }
            let size = Int64(values?.fileSize ?? 0)
            let mtime = Int64(((values?.contentModificationDate?.timeIntervalSince1970) ?? 0) * 1000)
            out.append(
                VaultSyncLocalFile(
                    relativePath: rel,
                    fileName: url.lastPathComponent,
                    sizeBytes: size,
                    mtimeMs: mtime,
                    url: url
                )
            )
        }
        return out.sorted { $0.relativePath < $1.relativePath }
    }

    static func guessMime(fileName: String) -> String {
        let lower = fileName.lowercased()
        if lower.hasSuffix(".md") || lower.hasSuffix(".markdown") { return "text/markdown" }
        if lower.hasSuffix(".txt") { return "text/plain" }
        if lower.hasSuffix(".json") { return "application/json" }
        if lower.hasSuffix(".png") { return "image/png" }
        if lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") { return "image/jpeg" }
        if lower.hasSuffix(".pdf") { return "application/pdf" }
        return "application/octet-stream"
    }
}
