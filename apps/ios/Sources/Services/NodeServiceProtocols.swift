import CoreLocation
import Foundation
import OpenBotKit
import UIKit

typealias OpenBotCameraSnapResult = (format: String, base64: String, width: Int, height: Int)
typealias OpenBotCameraClipResult = (format: String, base64: String, durationMs: Int, hasAudio: Bool)

protocol CameraServicing: Sendable {
    func listDevices() async -> [CameraController.CameraDeviceInfo]
    func snap(params: OpenBotCameraSnapParams) async throws -> OpenBotCameraSnapResult
    func clip(params: OpenBotCameraClipParams) async throws -> OpenBotCameraClipResult
}

protocol ScreenRecordingServicing: Sendable {
    func record(
        screenIndex: Int?,
        durationMs: Int?,
        fps: Double?,
        includeAudio: Bool?,
        outPath: String?) async throws -> String
}

@MainActor
protocol LocationServicing: Sendable {
    func authorizationStatus() -> CLAuthorizationStatus
    func accuracyAuthorization() -> CLAccuracyAuthorization
    func ensureAuthorization(mode: OpenBotLocationMode) async -> CLAuthorizationStatus
    func currentLocation(
        params: OpenBotLocationGetParams,
        desiredAccuracy: OpenBotLocationAccuracy,
        maxAgeMs: Int?,
        timeoutMs: Int?) async throws -> CLLocation
    func startLocationUpdates(
        desiredAccuracy: OpenBotLocationAccuracy,
        significantChangesOnly: Bool) -> AsyncStream<CLLocation>
    func stopLocationUpdates()
    func startMonitoringSignificantLocationChanges(onUpdate: @escaping @Sendable (CLLocation) -> Void)
    func stopMonitoringSignificantLocationChanges()
}

@MainActor
protocol DeviceStatusServicing: Sendable {
    func status() async throws -> OpenBotDeviceStatusPayload
    func info() -> OpenBotDeviceInfoPayload
}

protocol PhotosServicing: Sendable {
    func latest(params: OpenBotPhotosLatestParams) async throws -> OpenBotPhotosLatestPayload
}

protocol ContactsServicing: Sendable {
    func search(params: OpenBotContactsSearchParams) async throws -> OpenBotContactsSearchPayload
    func add(params: OpenBotContactsAddParams) async throws -> OpenBotContactsAddPayload
}

protocol CalendarServicing: Sendable {
    func events(params: OpenBotCalendarEventsParams) async throws -> OpenBotCalendarEventsPayload
    func add(params: OpenBotCalendarAddParams) async throws -> OpenBotCalendarAddPayload
}

protocol RemindersServicing: Sendable {
    func list(params: OpenBotRemindersListParams) async throws -> OpenBotRemindersListPayload
    func add(params: OpenBotRemindersAddParams) async throws -> OpenBotRemindersAddPayload
}

protocol MotionServicing: Sendable {
    func activities(params: OpenBotMotionActivityParams) async throws -> OpenBotMotionActivityPayload
    func pedometer(params: OpenBotPedometerParams) async throws -> OpenBotPedometerPayload
}

struct WatchMessagingStatus: Sendable, Equatable {
    var supported: Bool
    var paired: Bool
    var appInstalled: Bool
    var reachable: Bool
    var activationState: String
}

struct WatchQuickReplyEvent: Sendable, Equatable {
    var replyId: String
    var promptId: String
    var actionId: String
    var actionLabel: String?
    var sessionKey: String?
    var note: String?
    var sentAtMs: Int?
    var transport: String
}

struct WatchNotificationSendResult: Sendable, Equatable {
    var deliveredImmediately: Bool
    var queuedForDelivery: Bool
    var transport: String
}

protocol WatchMessagingServicing: AnyObject, Sendable {
    func status() async -> WatchMessagingStatus
    func setReplyHandler(_ handler: (@Sendable (WatchQuickReplyEvent) -> Void)?)
    func sendNotification(
        id: String,
        params: OpenBotWatchNotifyParams) async throws -> WatchNotificationSendResult
}

extension CameraController: CameraServicing {}
extension ScreenRecordService: ScreenRecordingServicing {}
extension LocationService: LocationServicing {}
