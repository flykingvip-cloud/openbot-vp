//
//  EmployeeNotificationRouter.swift
//  Local/system notification click-through → deep link (task 1.7-ios).
//
//  iOS already installs a single `UNUserNotificationCenterDelegate`
//  (`OpenBotAppDelegate`), so rather than competing for the delegate slot this
//  is a small helper the existing delegate calls: it extracts a carried deep-link
//  URL from a tapped notification's `userInfo`. The URL is then routed through the
//  same `EmployeeShellController.handleDeepLink` as external deep links, so it is
//  auth-gated + account-scoped (deferred to login when signed out).
//
//  Wave 1 is local/system notifications only; employee server push lands in Wave 2.
//  Key name matches the macOS router (`deepLink`) for a shared notification contract.
//

import Foundation

enum EmployeeNotificationRouter {
    /// userInfo key carrying an `openbot://` deep link string.
    static let deepLinkKey = "deepLink"

    /// Extract a deep-link URL from a tapped notification's userInfo, if present.
    static func deepLinkURL(from userInfo: [AnyHashable: Any]) -> URL? {
        guard let raw = userInfo[self.deepLinkKey] as? String else { return nil }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : URL(string: trimmed)
    }
}
