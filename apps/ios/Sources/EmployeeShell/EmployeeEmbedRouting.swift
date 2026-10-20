//
//  EmployeeEmbedRouting.swift
//  Maps a decoded bridge intent to either an in-WebView embed navigation or a
//  native host action (task 1.5-ios). Pure + testable.
//
//  Per dispatch (ios): chat/assistant/space/knowledge reuse the same Control UI
//  embed as https://www.openbot.love/. deviceSettings stays native/host-owned.
//

import Foundation

/// What the host should do with a decoded intent.
enum EmployeeShellRouteAction: Equatable {
    /// Navigate the SAME WebView to a site-internal embed path (session already set).
    case embedNavigation(path: String)
    /// Forward to the native host (chat/assistant/device-settings/ready).
    case native(EmployeeShellIntent)
}

enum EmployeeEmbedRouting {
    static let embedPrefix = "/embed/employee"

    /// `/embed/employee/<surface>`.
    static func embedPath(forSurface surface: String) -> String {
        "\(self.embedPrefix)/\(surface)"
    }

    /// `space/<spaceId>` → workspace surface bound to the same `space:<id>` store as www.
    static func embedPath(forSpace spaceId: String) -> String {
        self.pathWithQuery(
            surface: "workspace",
            items: [URLQueryItem(name: "session", value: self.collaborationSessionKey(forSpaceId: spaceId))]
        )
    }

    static func collaborationSessionKey(forSpaceId spaceId: String) -> String {
        var identity = spaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        while identity.lowercased().hasPrefix("space:") {
            identity = String(identity.dropFirst(6)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return "space:\(identity)"
    }

    /// `knowledge/<objectId>` → knowledge surface carrying object id (+ optional kind).
    static func embedPath(forKnowledge objectId: String, kind: String?) -> String {
        var items = [URLQueryItem(name: "objectId", value: objectId)]
        if let kind, !kind.isEmpty {
            items.append(URLQueryItem(name: "kind", value: kind))
        }
        return self.pathWithQuery(surface: "knowledge", items: items)
    }

    /// 1:1 chat lands on overview; collaboration `space:` keys land on workspace.
    static func embedPath(forChat sessionKey: String?, agentId: String?) -> String {
        let key = sessionKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let trimmedAgent = agentId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let resolved = !key.isEmpty ? key : (trimmedAgent.isEmpty ? "" : "agent:\(trimmedAgent):main")
        let surface = resolved.hasPrefix("space:") ? "workspace" : "overview"
        guard !resolved.isEmpty else {
            return self.embedPath(forSurface: surface)
        }
        return self.pathWithQuery(surface: surface, items: [URLQueryItem(name: "session", value: resolved)])
    }

    /// Route an intent to an embed navigation or a native action.
    static func action(for intent: EmployeeShellIntent) -> EmployeeShellRouteAction {
        switch intent {
        case let .openSpace(spaceId):
            return .embedNavigation(path: self.embedPath(forSpace: spaceId))
        case let .openKnowledgeObject(objectId, kind):
            return .embedNavigation(path: self.embedPath(forKnowledge: objectId, kind: kind))
        case let .openChat(sessionKey, agentId):
            return .embedNavigation(path: self.embedPath(forChat: sessionKey, agentId: agentId))
        case let .openAssistant(agentId):
            return .embedNavigation(path: self.embedPath(forChat: nil, agentId: agentId))
        case .openDeviceSettings, .ready:
            return .native(intent)
        }
    }

    private static func pathWithQuery(surface: String, items: [URLQueryItem]) -> String {
        var components = URLComponents()
        components.path = self.embedPath(forSurface: surface)
        components.queryItems = items
        return components.string ?? self.embedPath(forSurface: surface)
    }
}
