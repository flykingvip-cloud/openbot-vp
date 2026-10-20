import ActivityKit
import Foundation
import os

/// Minimal Live Activity lifecycle focused on connection health + stale cleanup.
@MainActor
final class LiveActivityManager {
    static let shared = LiveActivityManager()

    private let logger = Logger(subsystem: "ai.openbot.ios", category: "LiveActivity")
    private var currentActivityID: String?
    private var activityStartDate: Date = .now

    private init() {
        self.hydrateCurrentAndPruneDuplicates()
    }

    var isActive: Bool {
        guard let activity = self.resolvedCurrentActivity() else {
            self.currentActivityID = nil
            return false
        }
        guard activity.activityState == .active else {
            self.currentActivityID = nil
            return false
        }
        return true
    }

    func startActivity(agentName: String, sessionKey: String) {
        self.hydrateCurrentAndPruneDuplicates()

        if self.currentActivityID != nil {
            self.handleConnecting()
            return
        }

        let authInfo = ActivityAuthorizationInfo()
        guard authInfo.areActivitiesEnabled else {
            self.logger.info("Live Activities disabled; skipping start")
            return
        }

        self.activityStartDate = .now
        let attributes = OpenBotActivityAttributes(agentName: agentName, sessionKey: sessionKey)

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: ActivityContent(state: self.connectingState(), staleDate: nil),
                pushType: nil)
            self.currentActivityID = activity.id
            self.logger.info("started live activity id=\(activity.id, privacy: .public)")
        } catch {
            self.logger.error("failed to start live activity: \(error.localizedDescription, privacy: .public)")
        }
    }

    func handleConnecting() {
        self.scheduleUpdate(state: self.connectingState())
    }

    func handleReconnect() {
        self.scheduleUpdate(state: self.idleState())
    }

    func handleDisconnect() {
        self.scheduleUpdate(state: self.disconnectedState())
    }

    private func hydrateCurrentAndPruneDuplicates() {
        let active = Activity<OpenBotActivityAttributes>.activities
        guard !active.isEmpty else {
            self.currentActivityID = nil
            return
        }

        let keeper = active.max { lhs, rhs in
            lhs.content.state.startedAt < rhs.content.state.startedAt
        } ?? active[0]

        self.currentActivityID = keeper.id
        self.activityStartDate = keeper.content.state.startedAt

        let staleIDs = active.filter { $0.id != keeper.id }.map(\.id)
        let state = self.disconnectedState()
        guard !staleIDs.isEmpty else { return }
        Task {
            await Self.endActivities(ids: staleIDs, state: state)
        }
    }

    private func scheduleUpdate(state: OpenBotActivityAttributes.ContentState) {
        guard let id = self.currentActivityID else { return }
        Task {
            await Self.updateActivity(id: id, state: state)
        }
    }

    private func resolvedCurrentActivity() -> Activity<OpenBotActivityAttributes>? {
        guard let id = self.currentActivityID else { return nil }
        return Activity<OpenBotActivityAttributes>.activities.first { $0.id == id }
    }

    nonisolated private static func updateActivity(
        id: String,
        state: OpenBotActivityAttributes.ContentState) async
    {
        guard let activity = Activity<OpenBotActivityAttributes>.activities.first(where: { $0.id == id }) else {
            return
        }
        await activity.update(ActivityContent(state: state, staleDate: nil))
    }

    nonisolated private static func endActivities(
        ids: [String],
        state: OpenBotActivityAttributes.ContentState) async
    {
        let content = ActivityContent(state: state, staleDate: nil)
        let idSet = Set(ids)
        for activity in Activity<OpenBotActivityAttributes>.activities where idSet.contains(activity.id) {
            await activity.end(content, dismissalPolicy: .immediate)
        }
    }

    private func connectingState() -> OpenBotActivityAttributes.ContentState {
        OpenBotActivityAttributes.ContentState(
            statusText: "Connecting...",
            isIdle: false,
            isDisconnected: false,
            isConnecting: true,
            startedAt: self.activityStartDate)
    }

    private func idleState() -> OpenBotActivityAttributes.ContentState {
        OpenBotActivityAttributes.ContentState(
            statusText: "Idle",
            isIdle: true,
            isDisconnected: false,
            isConnecting: false,
            startedAt: self.activityStartDate)
    }

    private func disconnectedState() -> OpenBotActivityAttributes.ContentState {
        OpenBotActivityAttributes.ContentState(
            statusText: "Disconnected",
            isIdle: false,
            isDisconnected: true,
            isConnecting: false,
            startedAt: self.activityStartDate)
    }
}
