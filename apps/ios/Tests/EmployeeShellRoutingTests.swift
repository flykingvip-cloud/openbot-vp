import Foundation
import Testing
@testable import OpenBot

@Suite struct EmployeeShellBridgeParseTests {
    private func json(_ raw: String) -> String { raw }

    @Test func parsesReadyIntent() {
        let body = #"{"version":1,"type":"ready","payload":{"surface":"overview"}}"#
        #expect(EmployeeShellBridge.parse(body) == .ready(surface: "overview"))
    }

    @Test func parsesOpenChatWithOptionalFields() {
        let body = #"{"version":1,"type":"openChat","payload":{"sessionKey":"s1","agentId":"a1"}}"#
        #expect(EmployeeShellBridge.parse(body) == .openChat(sessionKey: "s1", agentId: "a1"))
    }

    @Test func parsesOpenChatWithNoParams() {
        let body = #"{"version":1,"type":"openChat","payload":{}}"#
        #expect(EmployeeShellBridge.parse(body) == .openChat(sessionKey: nil, agentId: nil))
    }

    @Test func parsesOpenSpaceRequiresSpaceId() {
        let ok = #"{"version":1,"type":"openSpace","payload":{"spaceId":"sp_1"}}"#
        #expect(EmployeeShellBridge.parse(ok) == .openSpace(spaceId: "sp_1"))
        let missing = #"{"version":1,"type":"openSpace","payload":{}}"#
        #expect(EmployeeShellBridge.parse(missing) == nil)
        let blank = #"{"version":1,"type":"openSpace","payload":{"spaceId":"   "}}"#
        #expect(EmployeeShellBridge.parse(blank) == nil)
    }

    @Test func parsesKnowledgeWithKind() {
        let body = #"{"version":1,"type":"openKnowledgeObject","payload":{"objectId":"o1","kind":"doc"}}"#
        #expect(EmployeeShellBridge.parse(body) == .openKnowledgeObject(objectId: "o1", kind: "doc"))
    }

    @Test func rejectsWrongVersion() {
        let body = #"{"version":2,"type":"ready","payload":{}}"#
        #expect(EmployeeShellBridge.parse(body) == nil)
    }

    @Test func rejectsUnknownType() {
        let body = #"{"version":1,"type":"nope","payload":{}}"#
        #expect(EmployeeShellBridge.parse(body) == nil)
    }

    @Test func rejectsGarbage() {
        #expect(EmployeeShellBridge.parse("not-json") == nil)
        #expect(EmployeeShellBridge.parse(42) == nil)
    }
}

@Suite struct EmployeeEmbedRoutingTests {
    @Test func spaceIntentRoutesToWorkspaceEmbed() {
        let action = EmployeeEmbedRouting.action(for: .openSpace(spaceId: "sp_1"))
        #expect(action == .embedNavigation(path: "/embed/employee/workspace?session=space:sp_1"))
    }

    @Test func knowledgeIntentRoutesToKnowledgeEmbed() {
        let action = EmployeeEmbedRouting.action(for: .openKnowledgeObject(objectId: "o1", kind: "doc"))
        #expect(action == .embedNavigation(path: "/embed/employee/knowledge?objectId=o1&kind=doc"))
    }

    @Test func knowledgeWithoutKindOmitsKindQuery() {
        let action = EmployeeEmbedRouting.action(for: .openKnowledgeObject(objectId: "o1", kind: nil))
        #expect(action == .embedNavigation(path: "/embed/employee/knowledge?objectId=o1"))
    }

    @Test func chatAndAssistantReuseTheWwwEmbed() {
        #expect(EmployeeEmbedRouting.action(for: .openChat(sessionKey: "agent:bot-2:main", agentId: nil))
            == .embedNavigation(path: "/embed/employee/overview?session=agent:bot-2:main"))
        #expect(EmployeeEmbedRouting.action(for: .openChat(sessionKey: "space:alpha", agentId: nil))
            == .embedNavigation(path: "/embed/employee/workspace?session=space:alpha"))
        #expect(EmployeeEmbedRouting.action(for: .openAssistant(agentId: "a1"))
            == .embedNavigation(path: "/embed/employee/overview?session=agent:a1:main"))
        #expect(EmployeeEmbedRouting.action(for: .openDeviceSettings(section: nil))
            == .native(.openDeviceSettings(section: nil)))
        #expect(EmployeeEmbedRouting.action(for: .ready(surface: nil))
            == .native(.ready(surface: nil)))
    }

    @Test func surfaceEmbedPath() {
        #expect(EmployeeEmbedRouting.embedPath(forSurface: "me") == "/embed/employee/me")
    }
}
