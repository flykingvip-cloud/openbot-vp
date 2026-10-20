import Foundation

enum OpenBotEnv {
    static func path(_ key: String) -> String? {
        guard let raw = getenv(key) else { return nil }
        let value = String(cString: raw).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        return value
    }
}

enum OpenBotPaths {
    private static let configPathEnv = ["OPENBOT_CONFIG_PATH"]
    private static let stateDirEnv = ["OPENBOT_STATE_DIR"]

    /// One-shot: rename `~/.openclaw` → `~/.openbot` when primary missing.
    private static func migrateLegacyStateDirIfNeeded(primary: URL, legacy: URL) {
        let fm = FileManager()
        guard !fm.fileExists(atPath: primary.path), fm.fileExists(atPath: legacy.path) else { return }
        try? fm.moveItem(at: legacy, to: primary)
    }

    /// One-shot: rename `openclaw.json` → `openbot.json` inside state dir.
    private static func migrateLegacyConfigIfNeeded(in dir: URL) {
        let fm = FileManager()
        let primary = dir.appendingPathComponent("openbot.json")
        let legacy = dir.appendingPathComponent("openclaw.json")
        guard !fm.fileExists(atPath: primary.path), fm.fileExists(atPath: legacy.path) else { return }
        try? fm.moveItem(at: legacy, to: primary)
    }

    static var stateDirURL: URL {
        for key in self.stateDirEnv {
            if let override = OpenBotEnv.path(key) {
                return URL(fileURLWithPath: override, isDirectory: true)
            }
        }
        let home = FileManager().homeDirectoryForCurrentUser
        let primary = home.appendingPathComponent(".openbot", isDirectory: true)
        let legacy = home.appendingPathComponent(".openclaw", isDirectory: true)
        self.migrateLegacyStateDirIfNeeded(primary: primary, legacy: legacy)
        return primary
    }

    static var configURL: URL {
        for key in self.configPathEnv {
            if let override = OpenBotEnv.path(key) {
                return URL(fileURLWithPath: override)
            }
        }
        let stateDir = self.stateDirURL
        self.migrateLegacyConfigIfNeeded(in: stateDir)
        return stateDir.appendingPathComponent("openbot.json")
    }

    static var workspaceURL: URL {
        self.stateDirURL.appendingPathComponent("workspace", isDirectory: true)
    }
}
