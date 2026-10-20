import Foundation

public enum OpenBotDeviceCommand: String, Codable, Sendable {
    case status = "device.status"
    case info = "device.info"
    case permissionsRequest = "device.permissions.request"
}

public enum OpenBotDevicePermissionKind: String, Codable, Sendable {
    case notifications
    case accessibility
    case appleScript
    case screenRecording
    case microphone
}

public struct OpenBotDevicePermissionsRequestParams: Codable, Sendable, Equatable {
    public var capability: OpenBotDevicePermissionKind
    public var interactive: Bool

    public init(capability: OpenBotDevicePermissionKind, interactive: Bool = true) {
        self.capability = capability
        self.interactive = interactive
    }
}

public struct OpenBotDevicePermissionsRequestPayload: Codable, Sendable, Equatable {
    public var capability: OpenBotDevicePermissionKind
    public var granted: Bool

    public init(capability: OpenBotDevicePermissionKind, granted: Bool) {
        self.capability = capability
        self.granted = granted
    }
}

public enum OpenBotBatteryState: String, Codable, Sendable {
    case unknown
    case unplugged
    case charging
    case full
}

public enum OpenBotThermalState: String, Codable, Sendable {
    case nominal
    case fair
    case serious
    case critical
}

public enum OpenBotNetworkPathStatus: String, Codable, Sendable {
    case satisfied
    case unsatisfied
    case requiresConnection
}

public enum OpenBotNetworkInterfaceType: String, Codable, Sendable {
    case wifi
    case cellular
    case wired
    case other
}

public struct OpenBotBatteryStatusPayload: Codable, Sendable, Equatable {
    public var level: Double?
    public var state: OpenBotBatteryState
    public var lowPowerModeEnabled: Bool

    public init(level: Double?, state: OpenBotBatteryState, lowPowerModeEnabled: Bool) {
        self.level = level
        self.state = state
        self.lowPowerModeEnabled = lowPowerModeEnabled
    }
}

public struct OpenBotThermalStatusPayload: Codable, Sendable, Equatable {
    public var state: OpenBotThermalState

    public init(state: OpenBotThermalState) {
        self.state = state
    }
}

public struct OpenBotStorageStatusPayload: Codable, Sendable, Equatable {
    public var totalBytes: Int64
    public var freeBytes: Int64
    public var usedBytes: Int64

    public init(totalBytes: Int64, freeBytes: Int64, usedBytes: Int64) {
        self.totalBytes = totalBytes
        self.freeBytes = freeBytes
        self.usedBytes = usedBytes
    }
}

public struct OpenBotNetworkStatusPayload: Codable, Sendable, Equatable {
    public var status: OpenBotNetworkPathStatus
    public var isExpensive: Bool
    public var isConstrained: Bool
    public var interfaces: [OpenBotNetworkInterfaceType]

    public init(
        status: OpenBotNetworkPathStatus,
        isExpensive: Bool,
        isConstrained: Bool,
        interfaces: [OpenBotNetworkInterfaceType])
    {
        self.status = status
        self.isExpensive = isExpensive
        self.isConstrained = isConstrained
        self.interfaces = interfaces
    }
}

public struct OpenBotDeviceStatusPayload: Codable, Sendable, Equatable {
    public var battery: OpenBotBatteryStatusPayload
    public var thermal: OpenBotThermalStatusPayload
    public var storage: OpenBotStorageStatusPayload
    public var network: OpenBotNetworkStatusPayload
    public var uptimeSeconds: Double

    public init(
        battery: OpenBotBatteryStatusPayload,
        thermal: OpenBotThermalStatusPayload,
        storage: OpenBotStorageStatusPayload,
        network: OpenBotNetworkStatusPayload,
        uptimeSeconds: Double)
    {
        self.battery = battery
        self.thermal = thermal
        self.storage = storage
        self.network = network
        self.uptimeSeconds = uptimeSeconds
    }
}

public struct OpenBotDeviceInfoPayload: Codable, Sendable, Equatable {
    public var deviceName: String
    public var modelIdentifier: String
    public var systemName: String
    public var systemVersion: String
    public var appVersion: String
    public var appBuild: String
    public var locale: String

    public init(
        deviceName: String,
        modelIdentifier: String,
        systemName: String,
        systemVersion: String,
        appVersion: String,
        appBuild: String,
        locale: String)
    {
        self.deviceName = deviceName
        self.modelIdentifier = modelIdentifier
        self.systemName = systemName
        self.systemVersion = systemVersion
        self.appVersion = appVersion
        self.appBuild = appBuild
        self.locale = locale
    }
}
