import Foundation

/// Parses cursor-agent / codex stream-json (jsonl) lines into supervisor progress events.
enum MacSupervisorStreamJsonParser {
    struct Event: Equatable, Sendable {
        var progressType: String
        var phase: String?
        var data: String?
        /// Text fragment appended to the final dispatch summary.
        var summaryFragment: String?
    }

    static func parseLine(_ line: String) -> Event? {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return nil
        }

        if let item = object["item"] as? [String: Any] {
            let itemType = (item["type"] as? String ?? "message").lowercased()
            if let text = Self.extractText(item), !text.isEmpty {
                return Event(
                    progressType: "progress",
                    phase: Self.normalizePhase(itemType),
                    data: Self.clip(text),
                    summaryFragment: text)
            }
        }

        let rootType = (object["type"] as? String ?? "").lowercased()
        if rootType.contains("tool") {
            let name = (object["name"] as? String)
                ?? (object["tool"] as? String)
                ?? (object["tool_name"] as? String)
            let detail = name.map { "tool: \($0)" } ?? "tool call"
            return Event(progressType: "progress", phase: "tool", data: detail, summaryFragment: nil)
        }

        if let text = Self.extractText(object), !text.isEmpty {
            let phase = rootType.isEmpty ? "message" : Self.normalizePhase(rootType)
            return Event(
                progressType: "progress",
                phase: phase,
                data: Self.clip(text),
                summaryFragment: text)
        }

        if object["usage"] != nil || ["completed", "done", "finished", "error"].contains(rootType) {
            return Event(
                progressType: "status",
                phase: rootType.isEmpty ? "terminal" : rootType,
                data: nil,
                summaryFragment: nil)
        }

        return nil
    }

    private static func normalizePhase(_ raw: String) -> String {
        let lower = raw.lowercased()
        if lower.contains("tool") { return "tool" }
        if lower.contains("think") { return "thinking" }
        if lower.contains("assistant") || lower.contains("message") { return "message" }
        if lower.contains("error") { return "error" }
        return lower.isEmpty ? "message" : lower
    }

    private static func extractText(_ value: Any?) -> String? {
        guard let value else { return nil }
        if let text = value as? String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        if let array = value as? [Any] {
            let joined = array.compactMap { Self.extractText($0) }.joined()
            return joined.isEmpty ? nil : joined
        }
        guard let object = value as? [String: Any] else { return nil }

        if let text = object["text"] as? String {
            let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty { return trimmed }
        }
        if let content = object["content"] {
            if let nested = Self.extractText(content) { return nested }
        }
        if let message = object["message"] {
            if let nested = Self.extractText(message) { return nested }
        }
        if let result = object["result"] {
            if let nested = Self.extractText(result) { return nested }
        }
        return nil
    }

    private static func clip(_ text: String, maxLen: Int = 800) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > maxLen else { return trimmed }
        let start = trimmed.index(trimmed.endIndex, offsetBy: -maxLen)
        return String(trimmed[start...])
    }
}

/// Buffers partial stdout chunks into newline-delimited jsonl records.
final class MacSupervisorStreamLineBuffer: @unchecked Sendable {
    private var pending = ""

    func append(_ chunk: String) -> [String] {
        self.pending.append(chunk)
        var lines: [String] = []
        while let newline = self.pending.firstIndex(of: "\n") {
            let line = String(self.pending[..<newline])
            self.pending = String(self.pending[self.pending.index(after: newline)...])
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            if !trimmed.isEmpty {
                lines.append(trimmed)
            }
        }
        return lines
    }

    func flush() -> String? {
        let trimmed = self.pending.trimmingCharacters(in: .whitespacesAndNewlines)
        self.pending = ""
        return trimmed.isEmpty ? nil : trimmed
    }
}
