import Testing
@testable import OpenBot

struct MacSupervisorStreamJsonParserTests {
    @Test func `parseLine extracts cursor item message`() {
        let line = #"{"item":{"type":"assistant_message","text":"Patch applied"}}"#
        let event = MacSupervisorStreamJsonParser.parseLine(line)
        #expect(event?.progressType == "progress")
        #expect(event?.phase == "message")
        #expect(event?.data == "Patch applied")
        #expect(event?.summaryFragment == "Patch applied")
    }

    @Test func `parseLine extracts tool call phase`() {
        let line = #"{"type":"tool_call","name":"shell"}"#
        let event = MacSupervisorStreamJsonParser.parseLine(line)
        #expect(event?.progressType == "progress")
        #expect(event?.phase == "tool")
        #expect(event?.data == "tool: shell")
    }

    @Test func `parseLine ignores invalid json`() {
        #expect(MacSupervisorStreamJsonParser.parseLine("not-json") == nil)
    }

    @Test func `line buffer splits partial chunks`() {
        let buffer = MacSupervisorStreamLineBuffer()
        let first = buffer.append(#"{"type":"tool_call","name":"a"}"#)
        #expect(first.isEmpty)
        let second = buffer.append("\n{\"item\":{\"type\":\"assistant_message\",\"text\":\"ok\"}}\n")
        #expect(second.count == 2)
        #expect(second[0].contains("tool_call"))
        #expect(second[1].contains("assistant_message"))
    }
}
