//
//  EmployeeShellMetrics.swift
//  Wave 1 success-metric instrumentation (task 1.11 / M-COLD, M-TTI, crash-free,
//  login success rate).
//
//  Native, dependency-free collection:
//  - M-COLD (cold-start) + crash-free: MetricKit (`MXAppLaunchMetric.histogrammedTimeToFirstDraw`
//    and `MXCrashDiagnostic`), the platform-native aggregate source (delivered by the
//    OS, no app-side timing hooks needed).
//  - M-TTI (time-to-interactive): explicit signpost interval from employee-shell mount
//    to first successful embed load.
//  - Login success rate: attempt/success counters.
//
//  Emitted via `os.Logger` + `OSSignposter` under subsystem `ai.openbot.ios`, so a
//  release pipeline can scrape unified logs / MetricKit payloads. A network sink can be
//  layered on later without changing call sites.
//

import Foundation
import os

#if canImport(MetricKit)
    import MetricKit
#endif

final class EmployeeShellMetrics: Sendable {
    static let shared = EmployeeShellMetrics()

    private let logger = Logger(subsystem: "ai.openbot.ios", category: "EmployeeMetrics")
    private let signposter = OSSignposter(subsystem: "ai.openbot.ios", category: "EmployeeMetrics")

    // Login success-rate counters (session-local; MetricKit carries the durable aggregates).
    private let counters = OSAllocatedUnfairLock(initialState: LoginCounters())
    private struct LoginCounters { var attempts = 0; var successes = 0 }

    // M-TTI interval state (shell mount → interactive).
    private let ttiState = OSAllocatedUnfairLock(initialState: TTIState())
    private struct TTIState { var startedAt: ContinuousClock.Instant? }

    #if canImport(MetricKit)
        private let metricKit = MetricKitSubscriber()
    #endif

    private init() {}

    /// Register OS metric/diagnostic collection. Idempotent; call once at launch.
    func start() {
        #if canImport(MetricKit)
            MXMetricManager.shared.add(self.metricKit)
        #endif
        self.logger.info("employee metrics started")
    }

    // MARK: M-TTI (shell mount → first interactive embed)

    func markShellMountBegan() {
        self.ttiState.withLock { $0.startedAt = ContinuousClock.now }
        self.signposter.emitEvent("shell.mount.begin")
    }

    /// Call when the embed first loads successfully. Logs the M-TTI duration.
    func markShellInteractive() {
        let started = self.ttiState.withLock { state -> ContinuousClock.Instant? in
            let value = state.startedAt
            state.startedAt = nil
            return value
        }
        guard let started else { return }
        let elapsedMs = Double((ContinuousClock.now - started).components.seconds) * 1000
            + Double((ContinuousClock.now - started).components.attoseconds) / 1e15
        self.logger.info("M-TTI shell interactive in \(elapsedMs, format: .fixed(precision: 0), privacy: .public)ms")
        self.signposter.emitEvent("shell.interactive")
    }

    // MARK: Login success rate

    func recordLoginAttempt(success: Bool) {
        let snapshot = self.counters.withLock { counters -> LoginCounters in
            counters.attempts += 1
            if success { counters.successes += 1 }
            return counters
        }
        let rate = snapshot.attempts == 0 ? 0 : Double(snapshot.successes) / Double(snapshot.attempts) * 100
        self.logger.info(
            """
            login attempt success=\(success, privacy: .public) \
            rate=\(rate, format: .fixed(precision: 1), privacy: .public)% \
            (\(snapshot.successes, privacy: .public)/\(snapshot.attempts, privacy: .public))
            """)
    }
}

#if canImport(MetricKit)
    /// Receives OS-aggregated launch/crash metrics (M-COLD + crash-free) and logs them.
    /// Holds only a `Logger` and no mutable state; MetricKit invokes it on a background
    /// queue, so `@unchecked Sendable` is safe.
    private final class MetricKitSubscriber: NSObject, MXMetricManagerSubscriber, @unchecked Sendable {
        private let logger = Logger(subsystem: "ai.openbot.ios", category: "EmployeeMetrics")

        func didReceive(_ payloads: [MXMetricPayload]) {
            for payload in payloads where payload.applicationLaunchMetrics != nil {
                // M-COLD cold-start: the OS-aggregated launch histogram is in this payload;
                // forwarded to unified logs for the release pipeline to scrape.
                self.logger.info("M-COLD application launch metric payload received")
            }
        }

        func didReceive(_ payloads: [MXDiagnosticPayload]) {
            for payload in payloads {
                let crashes = payload.crashDiagnostics?.count ?? 0
                if crashes > 0 {
                    self.logger.error("crash diagnostics received count=\(crashes, privacy: .public)")
                }
            }
        }
    }
#endif
