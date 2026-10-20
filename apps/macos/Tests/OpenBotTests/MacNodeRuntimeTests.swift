import CoreLocation
import Foundation
import OpenBotKit
import os
import Testing
@testable import OpenBot

struct MacNodeRuntimeTests {
    @Test func `handle invoke rejects unknown command`() async {
        let runtime = MacNodeRuntime()
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-1", command: "unknown.command"))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects empty system run`() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenBotSystemRunParams(command: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2", command: OpenBotSystemCommand.run.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects empty system which`() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenBotSystemWhichParams(bins: [])
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-2b", command: OpenBotSystemCommand.which.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke rejects empty notification`() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenBotSystemNotifyParams(title: "", body: "")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-3", command: OpenBotSystemCommand.notify.rawValue, paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke camera list requires enabled camera`() async {
        await TestIsolation.withUserDefaultsValues([cameraEnabledKey: false]) {
            let runtime = MacNodeRuntime()
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(id: "req-4", command: OpenBotCameraCommand.list.rawValue))
            #expect(response.ok == false)
            #expect(response.error?.message.contains("CAMERA_DISABLED") == true)
        }
    }

    @Test func `handle invoke screen record uses injected services`() async throws {
        @MainActor
        final class FakeMainActorServices: MacNodeRuntimeMainActorServices, @unchecked Sendable {
            func recordScreen(
                screenIndex: Int?,
                durationMs: Int?,
                fps: Double?,
                includeAudio: Bool?,
                outPath: String?) async throws -> (path: String, hasAudio: Bool)
            {
                let url = FileManager().temporaryDirectory
                    .appendingPathComponent("openbot-test-screen-record-\(UUID().uuidString).mp4")
                try Data("ok".utf8).write(to: url)
                return (path: url.path, hasAudio: false)
            }

            func locationAuthorizationStatus() -> CLAuthorizationStatus {
                .authorizedAlways
            }

            func locationAccuracyAuthorization() -> CLAccuracyAuthorization {
                .fullAccuracy
            }

            func currentLocation(
                desiredAccuracy: OpenBotLocationAccuracy,
                maxAgeMs: Int?,
                timeoutMs: Int?) async throws -> CLLocation
            {
                CLLocation(latitude: 0, longitude: 0)
            }
        }

        let services = await MainActor.run { FakeMainActorServices() }
        let runtime = MacNodeRuntime(makeMainActorServices: { services })

        let params = MacNodeScreenRecordParams(durationMs: 250)
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(id: "req-5", command: MacNodeScreenCommand.record.rawValue, paramsJSON: json))
        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)

        struct Payload: Decodable {
            var format: String
            var base64: String
        }
        let payload = try JSONDecoder().decode(Payload.self, from: Data(payloadJSON.utf8))
        #expect(payload.format == "mp4")
        #expect(!payload.base64.isEmpty)
    }

    @Test func `handle invoke browser proxy uses injected request`() async {
        let runtime = MacNodeRuntime(browserProxyRequest: { paramsJSON in
            #expect(paramsJSON?.contains("/tabs") == true)
            return #"{"result":{"ok":true,"tabs":[{"id":"tab-1"}]}}"#
        })
        let paramsJSON = #"{"method":"GET","path":"/tabs","timeoutMs":2500}"#
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-browser",
                command: OpenBotBrowserCommand.proxy.rawValue,
                paramsJSON: paramsJSON))

        #expect(response.ok == true)
        #expect(response.payloadJSON == #"{"result":{"ok":true,"tabs":[{"id":"tab-1"}]}}"#)
    }

    @Test func `handle invoke browser proxy rejects disabled browser control`() async throws {
        let override = TestIsolation.tempConfigPath()
        try await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            try JSONSerialization.data(withJSONObject: ["browser": ["enabled": false]])
                .write(to: URL(fileURLWithPath: override))

            let runtime = MacNodeRuntime(browserProxyRequest: { _ in
                Issue.record("browserProxyRequest should not run when browser control is disabled")
                return "{}"
            })
            let response = await runtime.handleInvoke(
                BridgeInvokeRequest(
                    id: "req-browser-disabled",
                    command: OpenBotBrowserCommand.proxy.rawValue,
                    paramsJSON: #"{"method":"GET","path":"/tabs"}"#))

            #expect(response.ok == false)
            #expect(response.error?.message.contains("BROWSER_DISABLED") == true)
        }
    }

    @Test func `handle invoke supervisor worker probe rejects empty worker id`() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenBotSupervisorWorkerProbeParams(workerId: "  ")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-supervisor-probe",
                command: OpenBotSupervisorWorkerCommand.probe.rawValue,
                paramsJSON: json))
        #expect(response.ok == false)
    }

    @Test func `handle invoke supervisor worker probe uses injected shell`() async throws {
        let executables = MacSupervisorWorkerRunner.ExecutablePort { name, _ in
            name == "cursor-agent" ? "/tmp/cursor-agent" : nil
        }
        let shell = MacSupervisorWorkerRunner.ShellPort { command, _, _, _ in
            #expect(command.first == "/tmp/cursor-agent")
            #expect(command.contains("--version"))
            return ShellExecutor.ShellResult(
                stdout: "cursor-agent 1.0.0",
                stderr: "",
                exitCode: 0,
                timedOut: false,
                success: true,
                errorMessage: nil)
        }
        let runner = MacSupervisorWorkerRunner(shell: shell, executables: executables)
        let runtime = MacNodeRuntime(supervisorWorkerRunner: runner)

        let params = OpenBotSupervisorWorkerProbeParams(workerId: "cursor-cli")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-supervisor-probe-ok",
                command: OpenBotSupervisorWorkerCommand.probe.rawValue,
                paramsJSON: json))

        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)
        let payload = try JSONDecoder().decode(
            OpenBotSupervisorWorkerProbeResult.self,
            from: Data(payloadJSON.utf8))
        #expect(payload.installed == true)
        #expect(payload.status == .configured)
    }

    @Test func `handle invoke supervisor worker probe grok-cli uses models auth probe`() async throws {
        let executables = MacSupervisorWorkerRunner.ExecutablePort { name, _ in
            name == "grok" ? "/tmp/grok" : nil
        }
        // Thread-safe call counter: the ShellPort closure is @Sendable, so a
        // captured `var` mutation is a data race under Swift 6.3 strict
        // concurrency. An OSAllocatedUnfairLock keeps the count Sendable-safe.
        let callIndex = OSAllocatedUnfairLock(initialState: 0)
        let shell = MacSupervisorWorkerRunner.ShellPort { command, _, _, _ in
            #expect(command.first == "/tmp/grok")
            let currentCall = callIndex.withLock { count -> Int in
                count += 1
                return count
            }
            if currentCall == 1 {
                #expect(command.contains("version"))
                return ShellExecutor.ShellResult(
                    stdout: "grok 0.2.93",
                    stderr: "",
                    exitCode: 0,
                    timedOut: false,
                    success: true,
                    errorMessage: nil)
            }
            #expect(command.contains("models"))
            return ShellExecutor.ShellResult(
                stdout: "You are logged in with grok.com.",
                stderr: "",
                exitCode: 0,
                timedOut: false,
                success: true,
                errorMessage: nil)
        }
        let runner = MacSupervisorWorkerRunner(shell: shell, executables: executables)
        let runtime = MacNodeRuntime(supervisorWorkerRunner: runner)

        let params = OpenBotSupervisorWorkerProbeParams(workerId: "grok-cli")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-supervisor-probe-grok",
                command: OpenBotSupervisorWorkerCommand.probe.rawValue,
                paramsJSON: json))

        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)
        let payload = try JSONDecoder().decode(
            OpenBotSupervisorWorkerProbeResult.self,
            from: Data(payloadJSON.utf8))
        #expect(payload.installed == true)
        #expect(payload.authenticated == true)
        #expect(payload.status == .validated)
    }

    @Test func `handle invoke supervisor worker dispatch uses injected shell`() async throws {
        let executables = MacSupervisorWorkerRunner.ExecutablePort { name, _ in
            name == "devin" ? "/tmp/devin" : nil
        }
        let shell = MacSupervisorWorkerRunner.ShellPort { command, cwd, _, _ in
            #expect(command.first == "/tmp/devin")
            #expect(command.contains("-p"))
            #expect(command.last == "fix the bug")
            #expect(cwd == "/tmp/workspace")
            return ShellExecutor.ShellResult(
                stdout: "done fixing",
                stderr: "",
                exitCode: 0,
                timedOut: false,
                success: true,
                errorMessage: nil)
        }
        let runner = MacSupervisorWorkerRunner(shell: shell, executables: executables)
        let runtime = MacNodeRuntime(supervisorWorkerRunner: runner)

        let params = OpenBotSupervisorWorkerDispatchParams(
            runId: "run-1",
            taskId: "task-1",
            workerId: "devin-cli",
            prompt: "fix the bug",
            workspaceDir: "/tmp/workspace")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-supervisor-dispatch",
                command: OpenBotSupervisorWorkerCommand.dispatch.rawValue,
                paramsJSON: json))

        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)
        let payload = try JSONDecoder().decode(
            OpenBotSupervisorWorkerDispatchResult.self,
            from: Data(payloadJSON.utf8))
        #expect(payload.exitCode == 0)
        #expect(payload.summary == "done fixing")
    }

    @Test func `handle invoke supervisor worker cancel reports cancelled flag`() async throws {
        let runtime = MacNodeRuntime()
        let params = OpenBotSupervisorWorkerCancelParams(runId: "missing-run", taskId: "task-1", workerId: "cursor-cli")
        let json = try String(data: JSONEncoder().encode(params), encoding: .utf8)
        let response = await runtime.handleInvoke(
            BridgeInvokeRequest(
                id: "req-supervisor-cancel",
                command: OpenBotSupervisorWorkerCommand.cancel.rawValue,
                paramsJSON: json))

        #expect(response.ok == true)
        let payloadJSON = try #require(response.payloadJSON)
        struct CancelPayload: Decodable { var cancelled: Bool }
        let payload = try JSONDecoder().decode(CancelPayload.self, from: Data(payloadJSON.utf8))
        #expect(payload.cancelled == false)
    }
}
