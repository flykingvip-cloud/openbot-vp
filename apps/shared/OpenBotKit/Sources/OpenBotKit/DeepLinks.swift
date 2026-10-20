import Foundation

public enum DeepLinkSchemeSupport {
    public static let canonicalScheme = "openbot"
    public static var acceptedSchemes: Set<String> {
        [canonicalScheme]
    }
}

public enum DeepLinkRoute: Sendable, Equatable {
    case agent(AgentDeepLink)
    case gateway(GatewayConnectDeepLink)
    case workspace(WorkspacePickerDeepLink)
    // Employee deep-link grammar v1 (see contracts/deeplink-grammar.md). These
    // are additive; the existing agent/gateway/workspace semantics are unchanged.
    case employee(EmployeeDeepLink)
    case chat(ChatDeepLink)
    case space(SpaceDeepLink)
    case knowledge(KnowledgeDeepLink)
}

/// Canonical employee-shell surfaces that may be embedded as web routes. Kept in
/// sync with `EMPLOYEE_EMBED_SURFACES` (`ui/src/ui/employee-shell/embed-routes.ts`).
public enum EmployeeEmbedSurface: String, Codable, Sendable, Equatable, CaseIterable {
    case overview
    case workspace
    case knowledge
    case growth
    case me
}

/// `…://employee/<surface>` — navigates the embedded employee shell. Unknown
/// surfaces fall back to `.overview` (never passed through raw).
public struct EmployeeDeepLink: Codable, Sendable, Equatable {
    public let surface: EmployeeEmbedSurface

    public init(surface: EmployeeEmbedSurface) {
        self.surface = surface
    }
}

/// `…://chat?sessionKey=&agentId=` — opens native chat. Both params optional;
/// no params means "open current/default session".
public struct ChatDeepLink: Codable, Sendable, Equatable {
    public let sessionKey: String?
    public let agentId: String?

    public init(sessionKey: String?, agentId: String?) {
        self.sessionKey = sessionKey
        self.agentId = agentId
    }
}

/// `…://space/<spaceId>` — opens a space (bridge `openSpace`). `spaceId` required.
public struct SpaceDeepLink: Codable, Sendable, Equatable {
    public let spaceId: String

    public init(spaceId: String) {
        self.spaceId = spaceId
    }
}

/// `…://knowledge/<objectId>?kind=` — opens a knowledge object
/// (bridge `openKnowledgeObject`). `objectId` required; `kind` optional.
public struct KnowledgeDeepLink: Codable, Sendable, Equatable {
    public let objectId: String
    public let kind: String?

    public init(objectId: String, kind: String?) {
        self.objectId = objectId
        self.kind = kind
    }
}

public struct GatewayConnectDeepLink: Codable, Sendable, Equatable {
    public let host: String
    public let port: Int
    public let tls: Bool
    public let token: String?
    public let password: String?

    public init(host: String, port: Int, tls: Bool, token: String?, password: String?) {
        self.host = host
        self.port = port
        self.tls = tls
        self.token = token
        self.password = password
    }

    public var websocketURL: URL? {
        let scheme = self.tls ? "wss" : "ws"
        return URL(string: "\(scheme)://\(self.host):\(self.port)")
    }

    /// Parse a device-pair setup code (base64url-encoded JSON: `{url, token?, password?}`).
    public static func fromSetupCode(_ code: String) -> GatewayConnectDeepLink? {
        guard let data = Self.decodeBase64Url(code) else { return nil }
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        guard let urlString = json["url"] as? String,
              let parsed = URLComponents(string: urlString),
              let hostname = parsed.host, !hostname.isEmpty
        else { return nil }

        let scheme = (parsed.scheme ?? "ws").lowercased()
        guard scheme == "ws" || scheme == "wss" else { return nil }
        let tls = scheme == "wss"
        if !tls, !LoopbackHost.isLoopbackHost(hostname) {
            return nil
        }
        let port = parsed.port ?? (tls ? 443 : 18789)
        let token = json["token"] as? String
        let password = json["password"] as? String
        return GatewayConnectDeepLink(host: hostname, port: port, tls: tls, token: token, password: password)
    }

    private static func decodeBase64Url(_ input: String) -> Data? {
        var base64 = input
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let remainder = base64.count % 4
        if remainder > 0 {
            base64.append(contentsOf: String(repeating: "=", count: 4 - remainder))
        }
        return Data(base64Encoded: base64)
    }
}

public struct AgentDeepLink: Codable, Sendable, Equatable {
    public let message: String
    public let sessionKey: String?
    public let thinking: String?
    public let deliver: Bool
    public let to: String?
    public let channel: String?
    public let timeoutSeconds: Int?
    public let key: String?

    public init(
        message: String,
        sessionKey: String?,
        thinking: String?,
        deliver: Bool,
        to: String?,
        channel: String?,
        timeoutSeconds: Int?,
        key: String?)
    {
        self.message = message
        self.sessionKey = sessionKey
        self.thinking = thinking
        self.deliver = deliver
        self.to = to
        self.channel = channel
        self.timeoutSeconds = timeoutSeconds
        self.key = key
    }
}

public enum WorkspacePickerMode: String, Codable, Sendable, Equatable {
    case defaultLocal = "default-local"
    case sharedLocal = "shared-local"
}

public struct WorkspacePickerDeepLink: Codable, Sendable, Equatable {
    public let mode: WorkspacePickerMode
    public let path: String?

    public init(mode: WorkspacePickerMode, path: String?) {
        self.mode = mode
        self.path = path
    }
}

public enum DeepLinkParser {
    public static func parse(_ url: URL) -> DeepLinkRoute? {
        guard let scheme = url.scheme?.lowercased(),
              DeepLinkSchemeSupport.acceptedSchemes.contains(scheme)
        else {
            return nil
        }
        guard let host = url.host?.lowercased(), !host.isEmpty else { return nil }
        guard let comps = URLComponents(url: url, resolvingAgainstBaseURL: false) else { return nil }

        let query = (comps.queryItems ?? []).reduce(into: [String: String]()) { dict, item in
            guard let value = item.value else { return }
            dict[item.name] = value
        }

        // First path segment (path form is preferred over query form for the
        // employee grammar), percent-decoded. Empty segments are dropped so a
        // trailing slash (`space/`) yields no segment (→ reject downstream).
        let pathSegments = comps.percentEncodedPath
            .split(separator: "/", omittingEmptySubsequences: true)
            .map { String($0).removingPercentEncoding ?? String($0) }
        let firstPathSegment = pathSegments.first

        switch host {
        case "agent":
            guard let message = query["message"],
                  !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            let deliver = (query["deliver"] as NSString?)?.boolValue ?? false
            let timeoutSeconds = query["timeoutSeconds"].flatMap { Int($0) }.flatMap { $0 >= 0 ? $0 : nil }
            return .agent(
                .init(
                    message: message,
                    sessionKey: query["sessionKey"],
                    thinking: query["thinking"],
                    deliver: deliver,
                    to: query["to"],
                    channel: query["channel"],
                    timeoutSeconds: timeoutSeconds,
                    key: query["key"]))

        case "gateway":
            guard let hostParam = query["host"],
                  !hostParam.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            else {
                return nil
            }
            let port = query["port"].flatMap { Int($0) } ?? 18789
            let tls = (query["tls"] as NSString?)?.boolValue ?? false
            if !tls, !LoopbackHost.isLoopbackHost(hostParam) {
                return nil
            }
            return .gateway(
                .init(
                    host: hostParam,
                    port: port,
                    tls: tls,
                    token: query["token"],
                    password: query["password"]))

        case "workspace":
            guard let modeRaw = query["mode"],
                  let mode = WorkspacePickerMode(rawValue: modeRaw)
            else {
                return nil
            }
            return .workspace(.init(mode: mode, path: query["path"]))

        // --- Employee deep-link grammar v1 (additive) --------------------------
        case "employee":
            // Surface from the first path segment (preferred), else `?surface=`.
            let surfaceRaw = firstPathSegment ?? query["surface"]
            // Reject injection/traversal in an explicitly provided surface; a
            // safe-but-unknown surface falls back to `.overview` (per grammar).
            if let surfaceRaw, !Self.isSafeParameterValue(surfaceRaw) {
                return nil
            }
            let surface = surfaceRaw
                .flatMap { EmployeeEmbedSurface(rawValue: $0.lowercased()) } ?? .overview
            return .employee(.init(surface: surface))

        case "chat":
            let sessionKey = query["sessionKey"]
            let agentId = query["agentId"]
            if let sessionKey, !Self.isSafeParameterValue(sessionKey) { return nil }
            if let agentId, !Self.isSafeParameterValue(agentId) { return nil }
            return .chat(.init(sessionKey: sessionKey, agentId: agentId))

        case "space":
            guard let spaceId = firstPathSegment ?? query["spaceId"],
                  !spaceId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  Self.isSafeParameterValue(spaceId)
            else {
                return nil
            }
            return .space(.init(spaceId: spaceId))

        case "knowledge":
            guard let objectId = firstPathSegment ?? query["objectId"],
                  !objectId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
                  Self.isSafeParameterValue(objectId)
            else {
                return nil
            }
            let kind = query["kind"]
            if let kind, !Self.isSafeParameterValue(kind) { return nil }
            return .knowledge(.init(objectId: objectId, kind: kind))

        default:
            // Unknown / future hosts are rejected (not crashed), so older clients
            // gracefully ignore deep links they do not understand.
            return nil
        }
    }

    /// Maximum accepted length for a single employee-grammar parameter value.
    private static let maxParameterValueLength = 2048

    /// Reject path-traversal / injection in employee-grammar values: dot-segments
    /// (`..`), control characters, embedded schemes (`javascript:`/`data:`/`x://`),
    /// protocol-relative prefixes (`//`), and over-long values.
    private static func isSafeParameterValue(_ value: String) -> Bool {
        if value.isEmpty || value.count > maxParameterValueLength { return false }
        if value.contains("..") { return false }
        if value.hasPrefix("//") { return false }
        for scalar in value.unicodeScalars {
            if scalar.value < 0x20 || scalar.value == 0x7f { return false }
        }
        let lowered = value.lowercased()
        if lowered.contains("://") { return false }
        if lowered.hasPrefix("javascript:") || lowered.hasPrefix("data:") { return false }
        return true
    }
}
