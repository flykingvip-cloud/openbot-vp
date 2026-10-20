import Foundation
import Testing
@testable import OpenBot

struct EmployeeShellBridgeTests {
    private func message(_ type: String, _ payload: [String: Any] = [:], version: Int = 1) -> String {
        let object: [String: Any] = ["version": version, "type": type, "payload": payload]
        let data = try! JSONSerialization.data(withJSONObject: object)
        return String(data: data, encoding: .utf8)!
    }

    @Test func `parses openSpace`() {
        let intent = EmployeeShellBridge.parse(self.message("openSpace", ["spaceId": "sp_1"]))
        #expect(intent == .openSpace(spaceId: "sp_1"))
    }

    @Test func `rejects wrong version`() {
        #expect(EmployeeShellBridge.parse(self.message("ready", version: 2)) == nil)
    }

    @Test func `rejects openSpace without id`() {
        #expect(EmployeeShellBridge.parse(self.message("openSpace")) == nil)
    }

    @Test func `parses openChat with optional fields`() {
        let intent = EmployeeShellBridge.parse(
            self.message("openChat", ["sessionKey": "s1", "agentId": "a1"]))
        #expect(intent == .openChat(sessionKey: "s1", agentId: "a1"))
        #expect(EmployeeShellBridge.parse(self.message("openChat")) == .openChat(sessionKey: nil, agentId: nil))
    }

    // MARK: - Embed routing (space/knowledge → embed; chat → native)

    @Test func `space routes to workspace embed navigation`() {
        let action = EmployeeEmbedRouting.action(for: .openSpace(spaceId: "sp_1"))
        #expect(action == .embedNavigation(path: "/embed/employee/workspace?session=space:sp_1"))
    }

    @Test func `knowledge routes to knowledge embed navigation`() {
        let action = EmployeeEmbedRouting.action(for: .openKnowledgeObject(objectId: "o_9", kind: "doc"))
        #expect(action == .embedNavigation(path: "/embed/employee/knowledge?objectId=o_9&kind=doc"))
    }

    @Test func `chat routes to the www embed`() {
        let intent = EmployeeShellIntent.openChat(sessionKey: "agent:bot-2:main", agentId: nil)
        #expect(
            EmployeeEmbedRouting.action(for: intent)
                == .embedNavigation(path: "/embed/employee/overview?session=agent:bot-2:main"))
    }

    @Test func `device settings routes to native`() {
        let intent = EmployeeShellIntent.openDeviceSettings(section: nil)
        #expect(EmployeeEmbedRouting.action(for: intent) == .native(intent))
    }

    @Test func `parses signOut`() {
        #expect(EmployeeShellBridge.parse(self.message("signOut")) == .signOut)
        #expect(EmployeeShellBridge.parse(self.message("signOut", [:])) == .signOut)
    }

    @Test func `rejects unknown types`() {
        #expect(EmployeeShellBridge.parse(self.message("wipeDevice")) == nil)
    }

    @Test func `signOut routes to native`() {
        #expect(EmployeeEmbedRouting.action(for: .signOut) == .native(.signOut))
    }

    // MARK: - Bootstrap URL building (no shell=mobile on macOS)

    @Test func `bootstrap url has token and target`() {
        let base = URL(string: "https://gw.openbot.love")!
        let url = EmployeeShellBootstrap.bootstrapURL(baseURL: base, token: "t1", target: "/embed/employee/overview")
        #expect(url?.absoluteString.contains("/native/bootstrap") == true)
        #expect(url?.absoluteString.contains("token=t1") == true)
        #expect(url?.absoluteString.contains("shell=mobile") == false)
    }

    @Test func `cloud workbench target is the browser homepage and tray default stays embed`() {
        #expect(EmployeeShellBootstrap.cloudWorkbenchTarget == "/")
        #expect(EmployeeShellBootstrap.defaultTarget == "/embed/employee/overview")
        let base = URL(string: "https://www.openbot.love")!
        let url = EmployeeShellBootstrap.bootstrapURL(
            baseURL: base, token: "t1", target: EmployeeShellBootstrap.cloudWorkbenchTarget)
        #expect(url?.absoluteString.contains("target=%2F") == true || url?.query?.contains("target=/") == true)
        #expect(url?.absoluteString.contains("shell=mobile") == false)
        let homepage = EmployeeShellBootstrap.embedURL(baseURL: base, path: "/")
        #expect(homepage?.path == "/" || homepage?.path == "")
        #expect(homepage?.host == "www.openbot.love")
    }

    @Test func `embed url preserves query`() {
        let base = URL(string: "https://gw.openbot.love")!
        let url = EmployeeShellBootstrap.embedURL(baseURL: base, path: "/embed/employee/workspace?session=space:sp_1")
        #expect(url?.path == "/embed/employee/workspace")
        #expect(url?.query == "session=space:sp_1")
    }

    @Test func `loopback gateway hosts include 127.0.0.1 localhost and ipv6`() {
        #expect(EmployeeShellBootstrap.isLoopbackGateway(URL(string: "http://127.0.0.1:18789")!) == true)
        #expect(EmployeeShellBootstrap.isLoopbackGateway(URL(string: "http://localhost:18789")!) == true)
        #expect(EmployeeShellBootstrap.isLoopbackGateway(URL(string: "http://LOCALHOST:18789")!) == true)
        #expect(EmployeeShellBootstrap.isLoopbackGateway(URL(string: "http://[::1]:18789")!) == true)
        #expect(EmployeeShellBootstrap.isLoopbackGateway(URL(string: "https://gw.openbot.love")!) == false)
    }
}
