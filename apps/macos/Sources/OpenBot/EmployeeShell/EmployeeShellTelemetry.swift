//
//  EmployeeShellTelemetry.swift
//  Wave 1 internal-beta metrics for the employee shell (task 1.11 / 1.9-macos).
//
//  Captures the R-Matrix client metrics we can measure on-device:
//   - M-COLD: app process start → first employee shell ready (cold start).
//   - M-TTI:  bootstrap begin → embed first paint (time-to-interactive).
//   - login success rate: successful logins / attempts.
//  Values are logged (unified logging) and kept in-memory for a status readout.
//
//  crash-free rate is intentionally NOT computed here: it requires a crash
//  reporter (OS/Sparkle do not surface it to the app). That metric is collected
//  out-of-band by the release owner; see release-internal-beta.md.
//

import Foundation
import os

@MainActor
final class EmployeeShellTelemetry {
    static let shared = EmployeeShellTelemetry()

    private let logger = Logger(subsystem: "ai.openbot", category: "employee-telemetry")

    /// Process start (approx cold-start origin). ProcessInfo.systemUptime baseline
    /// captured at first access of this singleton (app launch wires it early).
    private let processStart = Date()
    private var coldStartLogged = false

    /// Bootstrap start timestamps keyed by a token (per shell attempt).
    private var bootstrapStarts: [String: Date] = [:]

    private(set) var loginAttempts = 0
    private(set) var loginSuccesses = 0
    private(set) var lastColdStartSeconds: Double?
    private(set) var lastTTISeconds: Double?

    /// M-COLD: call once when the first employee shell becomes ready.
    func recordColdStartReady() {
        guard !self.coldStartLogged else { return }
        self.coldStartLogged = true
        let seconds = Date().timeIntervalSince(self.processStart)
        self.lastColdStartSeconds = seconds
        let text = String(format: "%.2f", seconds)
        self.logger.info("M-COLD cold-start ready in \(text, privacy: .public)s")
    }

    /// M-TTI begin: bootstrap started for `token`.
    func recordBootstrapBegin(token: String) {
        self.bootstrapStarts[token] = Date()
    }

    /// M-TTI end: embed first paint for `token`.
    func recordEmbedReady(token: String) {
        guard let start = self.bootstrapStarts.removeValue(forKey: token) else { return }
        let seconds = Date().timeIntervalSince(start)
        self.lastTTISeconds = seconds
        let text = String(format: "%.2f", seconds)
        self.logger.info("M-TTI embed ready in \(text, privacy: .public)s")
    }

    /// Login success rate accounting.
    func recordLoginAttempt() {
        self.loginAttempts += 1
    }

    func recordLoginSuccess() {
        self.loginSuccesses += 1
        self.logger.info(
            "login success rate \(self.loginSuccesses)/\(self.loginAttempts)")
    }

    /// Successful-login ratio in [0, 1] (1.0 when no attempts yet).
    var loginSuccessRate: Double {
        self.loginAttempts == 0 ? 1.0 : Double(self.loginSuccesses) / Double(self.loginAttempts)
    }
}
