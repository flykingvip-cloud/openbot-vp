//
//  EmployeeNotificationRouter.swift
//  System-notification click-through → deep link (task 1.7-macos).
//
//  A UNUserNotificationCenterDelegate that, when the user taps a notification
//  carrying a deep link (`userInfo[EmployeeNotificationRouter.deepLinkKey]`),
//  routes it through the same DeepLinkHandler as external deep links — so it is
//  auth-gated and account-scoped (deferred to login when signed out). Wave 1 is
//  local/system notifications only; employee server push lands in Wave 2.
//
//  The delegate protocol is nonisolated, so the callbacks are `nonisolated` and
//  hop to the main actor to reach the (MainActor) DeepLinkHandler.
//

import Foundation
import UserNotifications

final class EmployeeNotificationRouter: NSObject, UNUserNotificationCenterDelegate, Sendable {
    static let shared = EmployeeNotificationRouter()

    /// userInfo key carrying an `openbot://` deep link string.
    static let deepLinkKey = "deepLink"

    /// Install as the notification-center delegate. Idempotent.
    @MainActor
    func start() {
        UNUserNotificationCenter.current().delegate = self
    }

    // Foreground presentation: still show banners/sound while the app is active.
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        willPresent _: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .sound])
    }

    // Tap handling: route a carried deep link.
    nonisolated func userNotificationCenter(
        _: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        let userInfo = response.notification.request.content.userInfo
        let url = (userInfo[Self.deepLinkKey] as? String).flatMap(URL.init(string:))
        completionHandler()
        guard let url else { return }
        Task { @MainActor in
            await DeepLinkHandler.shared.handle(url: url)
        }
    }
}
