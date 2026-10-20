import Foundation

public enum OpenBotCameraCommand: String, Codable, Sendable {
    case list = "camera.list"
    case snap = "camera.snap"
    case clip = "camera.clip"
}

public enum OpenBotCameraFacing: String, Codable, Sendable {
    case back
    case front
}

public enum OpenBotCameraImageFormat: String, Codable, Sendable {
    case jpg
    case jpeg
}

public enum OpenBotCameraVideoFormat: String, Codable, Sendable {
    case mp4
}

public struct OpenBotCameraSnapParams: Codable, Sendable, Equatable {
    public var facing: OpenBotCameraFacing?
    public var maxWidth: Int?
    public var quality: Double?
    public var format: OpenBotCameraImageFormat?
    public var deviceId: String?
    public var delayMs: Int?

    public init(
        facing: OpenBotCameraFacing? = nil,
        maxWidth: Int? = nil,
        quality: Double? = nil,
        format: OpenBotCameraImageFormat? = nil,
        deviceId: String? = nil,
        delayMs: Int? = nil)
    {
        self.facing = facing
        self.maxWidth = maxWidth
        self.quality = quality
        self.format = format
        self.deviceId = deviceId
        self.delayMs = delayMs
    }
}

public struct OpenBotCameraClipParams: Codable, Sendable, Equatable {
    public var facing: OpenBotCameraFacing?
    public var durationMs: Int?
    public var includeAudio: Bool?
    public var format: OpenBotCameraVideoFormat?
    public var deviceId: String?

    public init(
        facing: OpenBotCameraFacing? = nil,
        durationMs: Int? = nil,
        includeAudio: Bool? = nil,
        format: OpenBotCameraVideoFormat? = nil,
        deviceId: String? = nil)
    {
        self.facing = facing
        self.durationMs = durationMs
        self.includeAudio = includeAudio
        self.format = format
        self.deviceId = deviceId
    }
}
