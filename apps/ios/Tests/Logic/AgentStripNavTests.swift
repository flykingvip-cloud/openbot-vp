import Foundation
import Testing

@Suite struct AgentStripNavTests {
    @Test func seedsStewardFirstWhenAgentsListIsEmpty() {
        let model = buildAgentStripNavModel(
            agents: [],
            sessions: [],
            activeSessionKey: "main",
            mainSessionKey: "main")
        #expect(model.stripItems.first?.id == builtinStewardNavID)
        #expect(model.stripItems.first?.rawTitle == builtinStewardName)
        #expect(model.stripItems.first?.selectionKey == "main")
        #expect(model.stripItems.first?.active == true)
        #expect(model.stripItems.allSatisfy { $0.id != "+" && $0.title != "+" })
    }

    @Test func keepsButlerAheadOfOtherAssistants() {
        let model = buildAgentStripNavModel(
            agents: [
                AgentStripAgent(id: "writer", name: "写作助手"),
                AgentStripAgent(id: "main", name: "大白管家"),
            ],
            sessions: [],
            activeSessionKey: "main",
            mainSessionKey: "main")
        #expect(model.assistantItems.map(\.id) == [builtinStewardNavID, "assistant:writer"])
        #expect(model.assistantItems[0].active == true)
        #expect(model.assistantItems[1].active == false)
        #expect(model.assistantItems[1].selectionKey == "agent:writer:main")
    }

    @Test func switchesActiveSessionWithoutToHeaderData() {
        let model = buildAgentStripNavModel(
            agents: [AgentStripAgent(id: "main", name: "大白管家")],
            sessions: [
                AgentStripSession(key: "space:design", displayName: "设计组", updatedAtMs: 10),
            ],
            activeSessionKey: "space:design",
            mainSessionKey: "main")
        #expect(model.spaceItems.first?.active == true)
        #expect(model.assistantItems.first?.active == false)
        #expect(model.stripItems.contains { $0.rawTitle.hasPrefix("TO:") } == false)
    }

    @Test func collapsesDuplicatedStewardSuffix() {
        #expect(sanitizeWorkbenchPeerTitle("大白管家家") == "大白管家")
        #expect(sanitizeWorkbenchPeerTitle("大白管家") == "大白管家")
    }

    @Test func capsBadgeAtNine() {
        #expect(formatAgentStripBadge(nil) == nil)
        #expect(formatAgentStripBadge(0) == nil)
        #expect(formatAgentStripBadge(12) == "9")
    }
}
