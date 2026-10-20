//
//  EmployeePushRegistration.swift
//  Wave 2 employee remote push — register/unregister via platform-auth HTTP
//  (same cookie jar as login). Click path reuses EmployeeNotificationRouter.
//
//  Does NOT call node push.apns.register / node.wake.
//

import Foundation
import OpenBotKit
import UIKit
import os

enum EmployeePushRegistration {
    private static let logger = Logger(subsystem: "ai.openbot.ios", category: "employee-push")

    /// Pending device token from APNs before an employee account is active.
    private static var pendingTokenHex: String?

    static func deviceId() -> String {
        if let id = GatewaySettingsStore.loadStableInstanceID(), !id.isEmpty {
            return id
        }
        return UIDevice.current.identifierForVendor?.uuidString ?? "unknown-device"
    }

    static func apnsEnvironment() -> String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    /// Called from AppDelegate when APNs issues a device token.
    @MainActor
    static func handleDeviceToken(_ tokenData: Data, accounts: EmployeeAccountManager) {
        let tokenHex = tokenData.map { String(format: "%02x", $0) }.joined()
        let trimmed = tokenHex.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        self.pendingTokenHex = trimmed
        guard let account = accounts.activeAccount else { return }
        _ = EmployeeAccountStore.savePushToken(trimmed, for: account.accountId)
        Task {
            await self.registerIfPossible(accounts: accounts)
        }
    }

    /// After employee login / session ready — upsert registration on the gateway.
    @MainActor
    static func registerIfPossible(accounts: EmployeeAccountManager) async {
        guard let account = accounts.activeAccount else { return }
        let container = accounts.container(for: account)
        let token =
            EmployeeAccountStore.loadPushToken(for: account.accountId)
            ?? self.pendingTokenHex
        guard let token, !token.isEmpty else {
            self.logger.info("employee push register skipped: no device token yet")
            return
        }
        _ = EmployeeAccountStore.savePushToken(token, for: account.accountId)

        let topic = Bundle.main.bundleIdentifier ?? ""
        var body: [String: Any] = [
            "accountId": account.accountId,
            "deviceId": self.deviceId(),
            "platform": "ios",
            "token": token,
            "environment": self.apnsEnvironment(),
        ]
        if !topic.isEmpty {
            body["topic"] = topic
        }

        do {
            let client = EmployeeAuthClient(
                gatewayBaseURL: account.gatewayBaseURL, session: container.urlSession)
            try await client.registerEmployeePush(body: body)
            self.logger.info("employee push registered account=\(account.accountId, privacy: .public)")
        } catch {
            self.logger.error(
                "employee push register failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Logout / switch away — revoke server registration for the leaving account.
    @MainActor
    static func unregister(account: EmployeeAccount, session: URLSession, allDevices: Bool = false)
        async
    {
        var body: [String: Any] = [
            "accountId": account.accountId,
            "deviceId": self.deviceId(),
            "platform": "ios",
        ]
        if allDevices {
            body["allDevices"] = true
        }
        do {
            let client = EmployeeAuthClient(
                gatewayBaseURL: account.gatewayBaseURL, session: session)
            try await client.unregisterEmployeePush(body: body)
            EmployeeAccountStore.deletePushToken(for: account.accountId)
            self.logger.info("employee push unregistered account=\(account.accountId, privacy: .public)")
        } catch {
            self.logger.error(
                "employee push unregister failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
