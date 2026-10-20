import Foundation

public enum OpenBotSupervisorWorkerCommand: String, Codable, Sendable {
    case dispatch = "supervisor.worker.dispatch"
    case probe = "supervisor.worker.probe"
    case cancel = "supervisor.worker.cancel"
}

public enum OpenBotSupervisorWorkerCredentialStatus: String, Codable, Sendable {
    case missing
    case configured
    case validated
    case expired
    case invalid
}

public struct OpenBotSupervisorWorkerDispatchParams: Codable, Sendable, Equatable {
    public var runId: String
    public var taskId: String
    public var workerId: String
    public var model: String?
    public var prompt: String
    public var goal: String?
    public var workspaceDir: String
    public var identityPolicy: String?

    public init(
        runId: String,
        taskId: String,
        workerId: String,
        model: String? = nil,
        prompt: String,
        goal: String? = nil,
        workspaceDir: String,
        identityPolicy: String? = nil)
    {
        self.runId = runId
        self.taskId = taskId
        self.workerId = workerId
        self.model = model
        self.prompt = prompt
        self.goal = goal
        self.workspaceDir = workspaceDir
        self.identityPolicy = identityPolicy
    }
}

public struct OpenBotSupervisorWorkerDispatchResult: Codable, Sendable, Equatable {
    public var summary: String?
    public var exitCode: Int?
    public var usage: OpenBotSupervisorWorkerUsage?

    public init(summary: String? = nil, exitCode: Int? = nil, usage: OpenBotSupervisorWorkerUsage? = nil) {
        self.summary = summary
        self.exitCode = exitCode
        self.usage = usage
    }
}

public struct OpenBotSupervisorWorkerUsage: Codable, Sendable, Equatable {
    public var input: Int?
    public var output: Int?

    public init(input: Int? = nil, output: Int? = nil) {
        self.input = input
        self.output = output
    }
}

public struct OpenBotSupervisorWorkerProbeParams: Codable, Sendable, Equatable {
    public var workerId: String

    public init(workerId: String) {
        self.workerId = workerId
    }
}

public struct OpenBotSupervisorWorkerProbeResult: Codable, Sendable, Equatable {
    public var installed: Bool
    public var authenticated: Bool
    public var status: OpenBotSupervisorWorkerCredentialStatus?
    public var reason: String?

    public init(
        installed: Bool,
        authenticated: Bool,
        status: OpenBotSupervisorWorkerCredentialStatus? = nil,
        reason: String? = nil)
    {
        self.installed = installed
        self.authenticated = authenticated
        self.status = status
        self.reason = reason
    }
}

public struct OpenBotSupervisorWorkerCancelParams: Codable, Sendable, Equatable {
    public var runId: String
    public var taskId: String
    public var workerId: String

    public init(runId: String, taskId: String, workerId: String) {
        self.runId = runId
        self.taskId = taskId
        self.workerId = workerId
    }
}

public enum OpenBotSupervisorWorkerProgressEvent {
    public static let name = "supervisor.worker.progress"
}

public struct OpenBotSupervisorWorkerProgressPayload: Codable, Sendable, Equatable {
    public var runId: String
    public var taskId: String
    public var workerId: String
    public var type: String
    public var data: String?
    public var phase: String?

    public init(
        runId: String,
        taskId: String,
        workerId: String,
        type: String,
        data: String? = nil,
        phase: String? = nil)
    {
        self.runId = runId
        self.taskId = taskId
        self.workerId = workerId
        self.type = type
        self.data = data
        self.phase = phase
    }
}
