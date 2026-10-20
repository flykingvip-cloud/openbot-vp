//
//  EmployeeShellDeepLinkRouting.swift
//  Stage 54 — pure maps from employee-grammar deep links → embed paths, plus
//  the auth-gate decision used before opening the shell (deferred deep link).
//
//  Keeps EmployeeShellController thin and unit-testable without AppKit windows.
//  Non-employee routes (agent / gateway / workspace) return nil — those stay
//  with DeepLinkHandler. employee session ≠ node pairing.
//

import Foundation
import OpenBotKit

enum EmployeeShellAuthGateDecision: Equatable {
    /// Signed out: stash path and present employee login.
    case presentLogin(pendingPath: String)
    /// Signed in: open / navigate the employee Web shell window.
    case openShell(path: String)
}

enum EmployeeShellDeepLinkRouting {
    /// Embed path for an employee-grammar deep link, or nil for non-employee hosts.
    static func embedPath(for route: DeepLinkRoute) -> String? {
        switch route {
        case let .employee(link):
            return EmployeeEmbedRouting.embedPath(forSurface: link.surface.rawValue)
        case let .chat(link):
            return EmployeeEmbedRouting.embedPath(forChat: link.sessionKey, agentId: link.agentId)
        case let .space(link):
            return EmployeeEmbedRouting.embedPath(forSpace: link.spaceId)
        case let .knowledge(link):
            return EmployeeEmbedRouting.embedPath(forKnowledge: link.objectId, kind: link.kind)
        case .agent, .gateway, .workspace:
            return nil
        }
    }

    /// Auth gate used by deferred deep links and menu open when signed out.
    static func authGate(isLoggedIn: Bool, targetPath: String) -> EmployeeShellAuthGateDecision {
        if isLoggedIn {
            return .openShell(path: targetPath)
        }
        return .presentLogin(pendingPath: targetPath)
    }
}
