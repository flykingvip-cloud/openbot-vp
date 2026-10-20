import Foundation

/// Decode shape for ~/.openbot/wechat-personal-worker.json (proxyUrl required).
struct WechatPersonalSidecarFileConfig: Decodable, Equatable, Sendable {
    var proxyUrl: String
    var apiKey: String?
    var deviceType: String?
    var webhookPort: Int?
    var webhookPath: String?
    var command: String?
    var args: [String]?
    var cwd: String?
}

struct WechatPersonalSidecarLaunchSpec: Equatable, Sendable {
    var command: String
    var args: [String]
    var cwd: String?

    var executableURL: URL? {
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("/") else { return nil }
        return URL(fileURLWithPath: trimmed)
    }
}

enum WechatPersonalSidecarSpawnDecision: Sendable {
    /// Spawn only when command is set, the probe is not already online, and the
    /// failure looks like connection-refused / host-unreachable (never 401).
    static func shouldSpawn(command: String?, probeOnline: Bool, unreachable: Bool) -> Bool {
        guard let command else { return false }
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.hasPrefix("/") else { return false }
        if probeOnline { return false }
        return unreachable
    }

    static func isUnreachableError(_ error: Error) -> Bool {
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return true
            default:
                break
            }
        }
        let ns = error as NSError
        if ns.domain == NSPOSIXErrorDomain {
            let code = Int32(ns.code)
            if code == ECONNREFUSED || code == EHOSTUNREACH || code == ENETUNREACH {
                return true
            }
        }
        if ns.domain == NSURLErrorDomain {
            switch URLError.Code(rawValue: ns.code) {
            case .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
                return true
            default:
                break
            }
        }
        if let underlying = ns.userInfo[NSUnderlyingErrorKey] as? Error {
            return isUnreachableError(underlying)
        }
        return false
    }

    static func launchSpec(command: String?, args: [String]?, cwd: String?) -> WechatPersonalSidecarLaunchSpec? {
        guard let command else { return nil }
        let trimmed = command.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, trimmed.hasPrefix("/") else { return nil }
        let cwdTrimmed = cwd?.trimmingCharacters(in: .whitespacesAndNewlines)
        return WechatPersonalSidecarLaunchSpec(
            command: trimmed,
            args: args ?? [],
            cwd: (cwdTrimmed?.isEmpty == false) ? cwdTrimmed : nil)
    }
}

/// Best-effort loopback sidecar process. Never starts a non-loopback URL.
actor WechatPersonalSidecarProcess {
    static let shared = WechatPersonalSidecarProcess()

    private var process: Process?

    func spawnIfNeeded(spec: WechatPersonalSidecarLaunchSpec) -> Bool {
        if let existing = process, existing.isRunning {
            return false
        }
        guard let url = spec.executableURL else { return false }
        let proc = Process()
        proc.executableURL = url
        proc.arguments = spec.args
        if let cwd = spec.cwd, !cwd.isEmpty {
            proc.currentDirectoryURL = URL(fileURLWithPath: cwd)
        }
        proc.standardInput = FileHandle.nullDevice
        proc.standardOutput = FileHandle.nullDevice
        proc.standardError = FileHandle.nullDevice
        do {
            try proc.run()
            process = proc
            return true
        } catch {
            return false
        }
    }

    func isRunning() -> Bool {
        process?.isRunning == true
    }
}
