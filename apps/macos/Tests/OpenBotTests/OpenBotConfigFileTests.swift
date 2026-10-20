import Foundation
import Testing
@testable import OpenBot

@Suite(.serialized)
struct OpenBotConfigFileTests {
    private func makeConfigOverridePath() -> String {
        FileManager().temporaryDirectory
            .appendingPathComponent("openbot-config-\(UUID().uuidString)")
            .appendingPathComponent("openbot.json")
            .path
    }

    @Test
    func `config path respects env override`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            #expect(OpenBotConfigFile.url().path == override)
        }
    }

    @MainActor
    @Test
    func `remote gateway port parses and matches host`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            OpenBotConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "ws://gateway.ts.net:19999",
                    ],
                ],
            ])
            #expect(OpenBotConfigFile.remoteGatewayPort() == 19999)
            #expect(OpenBotConfigFile.remoteGatewayPort(matchingHost: "gateway.ts.net") == 19999)
            #expect(OpenBotConfigFile.remoteGatewayPort(matchingHost: "gateway") == 19999)
            #expect(OpenBotConfigFile.remoteGatewayPort(matchingHost: "other.ts.net") == nil)
        }
    }

    @MainActor
    @Test
    func `set remote gateway url preserves scheme`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            OpenBotConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                    ],
                ],
            ])
            OpenBotConfigFile.setRemoteGatewayUrl(host: "new-host", port: 2222)
            let root = OpenBotConfigFile.loadDict()
            let url = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any])?["url"] as? String
            #expect(url == "wss://new-host:2222")
        }
    }

    @MainActor
    @Test
    func `clear remote gateway url removes only url field`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            OpenBotConfigFile.saveDict([
                "gateway": [
                    "remote": [
                        "url": "wss://old-host:111",
                        "token": "tok",
                    ],
                ],
            ])
            OpenBotConfigFile.clearRemoteGatewayUrl()
            let root = OpenBotConfigFile.loadDict()
            let remote = ((root["gateway"] as? [String: Any])?["remote"] as? [String: Any]) ?? [:]
            #expect((remote["url"] as? String) == nil)
            #expect((remote["token"] as? String) == "tok")
        }
    }

    @Test
    func `state dir override sets config path`() async {
        let dir = FileManager().temporaryDirectory
            .appendingPathComponent("openbot-state-\(UUID().uuidString)", isDirectory: true)
            .path

        await TestIsolation.withEnvValues([
            "OPENBOT_CONFIG_PATH": nil,
            "OPENBOT_STATE_DIR": dir,
        ]) {
            #expect(OpenBotConfigFile.stateDirURL().path == dir)
            #expect(OpenBotConfigFile.url().path == "\(dir)/openbot.json")
        }
    }

    @MainActor
    @Test
    func `save dict appends config audit log`() async throws {
        let stateDir = FileManager().temporaryDirectory
            .appendingPathComponent("openbot-state-\(UUID().uuidString)", isDirectory: true)
        let configPath = stateDir.appendingPathComponent("openbot.json")
        let auditPath = stateDir.appendingPathComponent("logs/config-audit.jsonl")

        defer { try? FileManager().removeItem(at: stateDir) }

        try await TestIsolation.withEnvValues([
            "OPENBOT_STATE_DIR": stateDir.path,
            "OPENBOT_CONFIG_PATH": configPath.path,
        ]) {
            OpenBotConfigFile.saveDict([
                "gateway": ["mode": "local"],
            ])

            let configData = try Data(contentsOf: configPath)
            let configRoot = try JSONSerialization.jsonObject(with: configData) as? [String: Any]
            #expect((configRoot?["meta"] as? [String: Any]) != nil)

            let rawAudit = try String(contentsOf: auditPath, encoding: .utf8)
            let lines = rawAudit
                .split(whereSeparator: \.isNewline)
                .map(String.init)
            #expect(!lines.isEmpty)
            guard let last = lines.last else {
                Issue.record("Missing config audit line")
                return
            }
            let auditRoot = try JSONSerialization.jsonObject(with: Data(last.utf8)) as? [String: Any]
            #expect(auditRoot?["source"] as? String == "macos-openbot-config-file")
            #expect(auditRoot?["event"] as? String == "config.write")
            #expect(auditRoot?["result"] as? String == "success")
            #expect(auditRoot?["configPath"] as? String == configPath.path)
        }
    }

    @MainActor
    @Test
    func `apply cloud direct remote url clears shared secrets`() async {
        let override = self.makeConfigOverridePath()

        await TestIsolation.withEnvValues(["OPENBOT_CONFIG_PATH": override]) {
            OpenBotConfigFile.saveDict([
                "gateway": [
                    "mode": "local",
                    "remote": [
                        "url": "wss://old-host:111",
                        "token": "tok",
                        "password": "pw",
                        "sshTarget": "user@host",
                    ],
                ],
            ])
            OpenBotConfigFile.applyCloudDirectRemoteURL("wss://www.openbot.love")
            let root = OpenBotConfigFile.loadDict()
            let gateway = root["gateway"] as? [String: Any] ?? [:]
            let remote = gateway["remote"] as? [String: Any] ?? [:]
            #expect((gateway["mode"] as? String) == "remote")
            #expect((remote["transport"] as? String) == "direct")
            #expect((remote["url"] as? String) == "wss://www.openbot.love")
            #expect(remote["token"] == nil)
            #expect(remote["password"] == nil)
            #expect(remote["sshTarget"] == nil)
        }
    }
}
