import Foundation
import OpenBotKit

/// Runs Development Supervisor CLI workers on the Mac Node (local IDE login backends).
actor MacSupervisorWorkerRunner {
    struct ShellPort: Sendable {
        var runDetailed: @Sendable ([String], String?, [String: String]?, Double?) async -> ShellExecutor.ShellResult

        static let live = ShellPort(runDetailed: ShellExecutor.runDetailed)
    }

    struct ExecutablePort: Sendable {
        var find: @Sendable (String, [String]) -> String?

        static let live = ExecutablePort(find: CommandResolver.findExecutable(named:searchPaths:))
    }

    private struct CliBackendSpec: Sendable {
        var command: String
        var baseArgs: [String]
        var modelArg: String?
        var versionProbeArgs: [String]
        var authProbeArgs: [String]?
        var outputFormat: CliOutputFormat
    }

    private enum CliOutputFormat: Sendable {
        case jsonl
        case text
    }

    private final class SummaryCollector: @unchecked Sendable {
        private let lock = NSLock()
        private var fragments: [String] = []

        func append(_ fragment: String) {
            self.lock.lock()
            defer { self.lock.unlock() }
            self.fragments.append(fragment)
        }

        var joined: String {
            self.lock.lock()
            defer { self.lock.unlock() }
            return self.fragments.joined(separator: "\n")
        }
    }

    private final class ActiveRun: @unchecked Sendable {
        let process: Process

        init(process: Process) {
            self.process = process
        }
    }

    private let shell: ShellPort
    private let executables: ExecutablePort
    private var activeRuns: [String: ActiveRun] = [:]

    init(shell: ShellPort = .live, executables: ExecutablePort = .live) {
        self.shell = shell
        self.executables = executables
    }

    func probe(workerId: String) async -> OpenBotSupervisorWorkerProbeResult {
        let normalized = Self.normalizeWorkerId(workerId)
        guard let spec = Self.backendSpec(for: normalized) else {
            return OpenBotSupervisorWorkerProbeResult(
                installed: false,
                authenticated: false,
                status: .missing,
                reason: "Unsupported worker \"\(workerId)\" on Mac Node")
        }

        let searchPaths = CommandResolver.preferredPaths()
        guard let executable = self.executables.find(spec.command, searchPaths) else {
            return OpenBotSupervisorWorkerProbeResult(
                installed: false,
                authenticated: false,
                status: .missing,
                reason: "\(spec.command) not found on PATH")
        }

        let versionResult = await self.shell.runDetailed(
            [executable] + spec.versionProbeArgs,
            nil,
            nil,
            8)
        let installed = versionResult.timedOut == false
            && (versionResult.success || versionResult.exitCode != nil)
        if !installed {
            return OpenBotSupervisorWorkerProbeResult(
                installed: false,
                authenticated: false,
                status: .missing,
                reason: "\(spec.command) failed version probe")
        }

        if let authArgs = spec.authProbeArgs, !authArgs.isEmpty {
            let authResult = await self.shell.runDetailed(
                [executable] + authArgs,
                nil,
                nil,
                45)
            let combined = Self.combinedOutput(authResult)
            if Self.localIdeAuthAuthenticated(
                workerId: normalized,
                combined: combined,
                exitSuccess: authResult.success)
            {
                return OpenBotSupervisorWorkerProbeResult(
                    installed: true,
                    authenticated: true,
                    status: .validated)
            }
            if Self.looksLikeAuthError(combined) || authResult.success {
                return OpenBotSupervisorWorkerProbeResult(
                    installed: true,
                    authenticated: false,
                    status: .configured,
                    reason: "IDE login required for \(spec.command)")
            }
            if authResult.exitCode == nil, authResult.errorMessage?.contains("failed to start") == true {
                return OpenBotSupervisorWorkerProbeResult(
                    installed: true,
                    authenticated: false,
                    status: .configured,
                    reason: "Cannot verify IDE login for \(spec.command)")
            }
        }

        return OpenBotSupervisorWorkerProbeResult(
            installed: true,
            authenticated: false,
            status: .configured,
            reason: "Login status not verified; complete IDE sign-in on this Mac")
    }

    func dispatch(
        params: OpenBotSupervisorWorkerDispatchParams,
        timeoutSec: Double?,
        onProgress: (@Sendable (OpenBotSupervisorWorkerProgressPayload) async -> Void)? = nil) async throws
        -> OpenBotSupervisorWorkerDispatchResult
    {
        let runId = params.runId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !runId.isEmpty else {
            throw MacSupervisorWorkerError.invalidRequest("runId required")
        }
        if self.activeRuns[runId] != nil {
            throw MacSupervisorWorkerError.invalidRequest("runId already active")
        }

        let normalized = Self.normalizeWorkerId(params.workerId)
        guard let spec = Self.backendSpec(for: normalized) else {
            throw MacSupervisorWorkerError.unsupportedWorker(params.workerId)
        }

        let prompt = params.prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else {
            throw MacSupervisorWorkerError.invalidRequest("prompt required")
        }

        let workspace = params.workspaceDir.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !workspace.isEmpty else {
            throw MacSupervisorWorkerError.invalidRequest("workspaceDir required")
        }

        var command = [spec.command]
        command.append(contentsOf: spec.baseArgs)
        if let modelArg = spec.modelArg,
           let model = params.model?.trimmingCharacters(in: .whitespacesAndNewlines),
           !model.isEmpty
        {
            command.append(modelArg)
            command.append(model)
        }
        command.append(prompt)

        let searchPaths = CommandResolver.preferredPaths()
        guard let executable = self.executables.find(spec.command, searchPaths) else {
            throw MacSupervisorWorkerError.missingCli(spec.command)
        }

        var envCommand = command
        envCommand[0] = executable

        let summaryCollector = SummaryCollector()
        let result = await self.runTracked(
            runId: runId,
            command: envCommand,
            cwd: workspace,
            env: nil,
            timeout: timeoutSec,
            outputFormat: spec.outputFormat,
            progressContext: (runId: runId, taskId: params.taskId, workerId: params.workerId),
            summaryCollector: summaryCollector,
            onProgress: onProgress)
        defer { self.activeRuns.removeValue(forKey: runId) }

        let combined = Self.combinedOutput(result)
        if Self.looksLikeAuthError(combined) {
            throw MacSupervisorWorkerError.authFailed(combined)
        }

        let parsedSummary = summaryCollector.joined.trimmingCharacters(in: .whitespacesAndNewlines)
        let summarySource = parsedSummary.isEmpty ? combined : parsedSummary
        let summary = Self.summarizeOutput(summarySource)
        let exitCode = result.exitCode ?? (result.success ? 0 : 1)
        return OpenBotSupervisorWorkerDispatchResult(
            summary: summary.isEmpty ? nil : summary,
            exitCode: exitCode)
    }

    func cancel(runId: String) async -> Bool {
        let trimmed = runId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let active = self.activeRuns[trimmed] else { return false }
        if active.process.isRunning {
            active.process.terminate()
        }
        return true
    }

    private final class OutputAccumulator: @unchecked Sendable {
        private let lock = NSLock()
        var stdout = ""
        var stderr = ""

        func append(stream: String, chunk: String) {
            self.lock.lock()
            defer { self.lock.unlock() }
            if stream == "stderr" {
                self.stderr.append(chunk)
            } else {
                self.stdout.append(chunk)
            }
        }
    }

    private func runTracked(
        runId: String,
        command: [String],
        cwd: String?,
        env: [String: String]?,
        timeout: Double?,
        outputFormat: CliOutputFormat,
        progressContext: (runId: String, taskId: String, workerId: String),
        summaryCollector: SummaryCollector,
        onProgress: (@Sendable (OpenBotSupervisorWorkerProgressPayload) async -> Void)? = nil) async
        -> ShellExecutor.ShellResult
    {
        guard !command.isEmpty else {
            return ShellExecutor.ShellResult(
                stdout: "",
                stderr: "",
                exitCode: nil,
                timedOut: false,
                success: false,
                errorMessage: "empty command")
        }

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = command
        if let cwd { process.currentDirectoryURL = URL(fileURLWithPath: cwd) }
        if let env { process.environment = env }

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        self.activeRuns[runId] = ActiveRun(process: process)
        let accumulator = OutputAccumulator()
        let stdoutLineBuffer = MacSupervisorStreamLineBuffer()

        @Sendable
        func emitProgress(type: String, phase: String?, data: String?) async {
            guard let onProgress else { return }
            let trimmed = data?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard type == "status" || !trimmed.isEmpty else { return }
            let payload = OpenBotSupervisorWorkerProgressPayload(
                runId: progressContext.runId,
                taskId: progressContext.taskId,
                workerId: progressContext.workerId,
                type: type,
                data: trimmed.isEmpty ? nil : Self.summarizeOutput(trimmed, maxLen: 800),
                phase: phase)
            await onProgress(payload)
        }

        @Sendable
        func handleJsonlLines(_ lines: [String]) async {
            for line in lines {
                guard let event = MacSupervisorStreamJsonParser.parseLine(line) else { continue }
                if let fragment = event.summaryFragment {
                    summaryCollector.append(fragment)
                }
                await emitProgress(type: event.progressType, phase: event.phase, data: event.data)
            }
        }

        func attachReader(_ handle: FileHandle, stream: String) {
            handle.readabilityHandler = { fileHandle in
                let data = fileHandle.availableData
                guard !data.isEmpty else { return }
                guard let chunk = String(data: data, encoding: .utf8), !chunk.isEmpty else { return }
                accumulator.append(stream: stream, chunk: chunk)
                if stream == "stdout", outputFormat == .jsonl {
                    let lines = stdoutLineBuffer.append(chunk)
                    if !lines.isEmpty {
                        Task { await handleJsonlLines(lines) }
                    }
                    return
                }
                if stream == "stdout" || stream == "stderr" {
                    Task {
                        await emitProgress(type: stream, phase: nil, data: chunk)
                    }
                }
            }
        }

        do {
            try process.run()
        } catch {
            self.activeRuns.removeValue(forKey: runId)
            return ShellExecutor.ShellResult(
                stdout: "",
                stderr: "",
                exitCode: nil,
                timedOut: false,
                success: false,
                errorMessage: "failed to start: \(error.localizedDescription)")
        }

        attachReader(stdoutPipe.fileHandleForReading, stream: "stdout")
        attachReader(stderrPipe.fileHandleForReading, stream: "stderr")

        let waitTask = Task { () -> ShellExecutor.ShellResult in
            process.waitUntilExit()
            stdoutPipe.fileHandleForReading.readabilityHandler = nil
            stderrPipe.fileHandleForReading.readabilityHandler = nil
            if outputFormat == .jsonl {
                if let trailing = stdoutLineBuffer.flush() {
                    await handleJsonlLines([trailing])
                }
            }
            let status = Int(process.terminationStatus)
            return ShellExecutor.ShellResult(
                stdout: accumulator.stdout,
                stderr: accumulator.stderr,
                exitCode: status,
                timedOut: false,
                success: status == 0,
                errorMessage: status == 0 ? nil : "exit \(status)")
        }

        if let timeout, timeout > 0 {
            let nanos = UInt64(timeout * 1_000_000_000)
            return await withTaskGroup(of: ShellExecutor.ShellResult.self) { group in
                group.addTask { await waitTask.value }
                group.addTask {
                    try? await Task.sleep(nanoseconds: nanos)
                    if process.isRunning { process.terminate() }
                    _ = await waitTask.value
                    return ShellExecutor.ShellResult(
                        stdout: accumulator.stdout,
                        stderr: accumulator.stderr,
                        exitCode: nil,
                        timedOut: true,
                        success: false,
                        errorMessage: "timeout")
                }
                let first = await group.next()!
                group.cancelAll()
                return first
            }
        }

        return await waitTask.value
    }

    private static func normalizeWorkerId(_ workerId: String) -> String {
        let trimmed = workerId.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if trimmed == "windsurf-cli" { return "devin-cli" }
        return trimmed
    }

    private static func backendSpec(for workerId: String) -> CliBackendSpec? {
        switch workerId {
        case "cursor-cli":
            return CliBackendSpec(
                command: "cursor-agent",
                baseArgs: ["--print", "--output-format", "stream-json", "--force", "--approve-mcps"],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: ["whoami"],
                outputFormat: .jsonl)
        case "devin-cli":
            return CliBackendSpec(
                command: "devin",
                baseArgs: ["--sandbox", "--permission-mode", "dangerous", "-p"],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: ["auth", "status"],
                outputFormat: .text)
        case "grok-cli":
            return CliBackendSpec(
                command: "grok",
                baseArgs: [
                    "--no-auto-update", "--always-approve", "--output-format", "streaming-json", "-p",
                ],
                modelArg: "--model",
                versionProbeArgs: ["version"],
                authProbeArgs: ["models"],
                outputFormat: .jsonl)
        case "codex-cli":
            return CliBackendSpec(
                command: "codex",
                baseArgs: [
                    "exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--skip-git-repo-check",
                ],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: ["login", "status"],
                outputFormat: .jsonl)
        case "trae-cli":
            return CliBackendSpec(
                command: "traecli",
                baseArgs: [
                    "exec", "--json", "--color", "never", "--sandbox", "workspace-write", "--skip-git-repo-check",
                ],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: ["login", "status"],
                outputFormat: .jsonl)
        case "kiro-cli":
            return CliBackendSpec(
                command: "kiro-cli",
                baseArgs: ["chat", "--no-interactive", "--trust-all-tools"],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: ["whoami"],
                outputFormat: .text)
        case "claude-cli":
            return CliBackendSpec(
                command: "claude",
                baseArgs: ["-p", "--output-format", "json", "--permission-mode", "bypassPermissions"],
                modelArg: "--model",
                versionProbeArgs: ["--version"],
                authProbeArgs: nil,
                outputFormat: .text)
        default:
            return nil
        }
    }

    private static func combinedOutput(_ result: ShellExecutor.ShellResult) -> String {
        [result.stdout, result.stderr, result.errorMessage]
            .compactMap(\.self)
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    private static func summarizeOutput(_ text: String, maxLen: Int = 2000) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxLen else { return trimmed }
        let start = trimmed.index(trimmed.endIndex, offsetBy: -maxLen)
        return String(trimmed[start...])
    }

    private static func looksLikeAuthError(_ text: String) -> Bool {
        let lower = text.lowercased()
        let needles = [
            "not logged in",
            "not authenticated",
            "login required",
            "please log in",
            "please login",
            "unauthorized",
            "unauthenticated",
            "authentication failed",
            "invalid api key",
            "permission denied",
            "auth token",
            "expired token",
        ]
        return needles.contains { lower.contains($0) }
    }

    private static func localIdeAuthAuthenticated(
        workerId: String,
        combined: String,
        exitSuccess: Bool) -> Bool
    {
        let lower = combined.lowercased()
        switch workerId {
        case "cursor-cli":
            // Positive signals win: whoami prints a transient "Starting login process..." banner
            // even when already authenticated.
            if lower.contains("login successful") || lower.contains("logged in") {
                return !lower.contains("not logged in")
            }
            if lower.contains("not logged in") || lower.contains("starting login process") {
                return false
            }
            return exitSuccess && combined.trimmingCharacters(in: .whitespacesAndNewlines).count > 8
        case "kiro-cli":
            if lower.contains("not logged in") || lower.contains("not authenticated") {
                return false
            }
            return exitSuccess
        case "grok-cli":
            return exitSuccess && lower.contains("logged in")
        case "devin-cli":
            return exitSuccess
        case "codex-cli", "trae-cli":
            if lower.contains("not logged in") || lower.contains("not authenticated") {
                return false
            }
            if lower.contains("logged in") {
                return true
            }
            return exitSuccess
        default:
            return exitSuccess
        }
    }
}

enum MacSupervisorWorkerError: LocalizedError {
    case invalidRequest(String)
    case unsupportedWorker(String)
    case missingCli(String)
    case authFailed(String)

    var errorDescription: String? {
        switch self {
        case let .invalidRequest(message):
            "INVALID_REQUEST: \(message)"
        case let .unsupportedWorker(workerId):
            "UNSUPPORTED_WORKER: \(workerId)"
        case let .missingCli(command):
            "CLI_NOT_FOUND: \(command)"
        case let .authFailed(message):
            message
        }
    }
}
