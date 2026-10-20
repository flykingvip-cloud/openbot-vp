import Foundation
import Testing
@testable import OpenBot

struct WechatPersonalSidecarSupervisorTests {
    @Test func `decode command args and null cwd`() throws {
        let json = """
        {"proxyUrl":"http://127.0.0.1:3000","command":"/opt/sidecar","args":["--listen"],"cwd":null}
        """
        let parsed = try JSONDecoder().decode(WechatPersonalSidecarFileConfig.self, from: Data(json.utf8))
        #expect(parsed.proxyUrl == "http://127.0.0.1:3000")
        #expect(parsed.command == "/opt/sidecar")
        #expect(parsed.args == ["--listen"])
        #expect(parsed.cwd == nil)
    }

    @Test func `decode without command keeps proxyUrl required`() throws {
        let json = #"{"proxyUrl":"http://127.0.0.1:3000"}"#
        let parsed = try JSONDecoder().decode(WechatPersonalSidecarFileConfig.self, from: Data(json.utf8))
        #expect(parsed.proxyUrl == "http://127.0.0.1:3000")
        #expect(parsed.command == nil)
        #expect(parsed.args == nil)
        #expect(parsed.cwd == nil)
    }

    @Test func `does not spawn when already online`() {
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: "/opt/sidecar",
                probeOnline: true,
                unreachable: true) == false)
    }

    @Test func `does not spawn without command`() {
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: nil,
                probeOnline: false,
                unreachable: true) == false)
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: "  ",
                probeOnline: false,
                unreachable: true) == false)
    }

    @Test func `does not spawn relative command`() {
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: "sidecar",
                probeOnline: false,
                unreachable: true) == false)
    }

    @Test func `spawns on unreachable when command is absolute`() {
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: "/opt/sidecar",
                probeOnline: false,
                unreachable: true))
    }

    @Test func `does not spawn on non-unreachable offline`() {
        #expect(
            WechatPersonalSidecarSpawnDecision.shouldSpawn(
                command: "/opt/sidecar",
                probeOnline: false,
                unreachable: false) == false)
    }

    @Test func `unreachable detects connection refused not 401`() {
        #expect(WechatPersonalSidecarSpawnDecision.isUnreachableError(URLError(.cannotConnectToHost)))
        #expect(WechatPersonalSidecarSpawnDecision.isUnreachableError(URLError(.cannotFindHost)))
        #expect(
            WechatPersonalSidecarSpawnDecision.isUnreachableError(URLError(.userAuthenticationRequired))
                == false)
    }

    @Test func `launchSpec requires absolute command`() {
        #expect(WechatPersonalSidecarSpawnDecision.launchSpec(command: nil, args: nil, cwd: nil) == nil)
        #expect(WechatPersonalSidecarSpawnDecision.launchSpec(command: "rel", args: [], cwd: nil) == nil)
        let spec = WechatPersonalSidecarSpawnDecision.launchSpec(
            command: "/opt/sidecar",
            args: ["--a"],
            cwd: "/tmp")
        #expect(spec?.command == "/opt/sidecar")
        #expect(spec?.args == ["--a"])
        #expect(spec?.cwd == "/tmp")
        #expect(spec?.executableURL?.path == "/opt/sidecar")
    }
}
