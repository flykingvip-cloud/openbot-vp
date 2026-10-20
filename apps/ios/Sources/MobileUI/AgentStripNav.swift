import Foundation

/// Agent Strip roster for the iOS chat tab.
/// Port of Android `AgentStripNav.kt` / Web workbench chrome:
/// assistants from `agents.list` (管家 first) then space-scoped sessions.
/// There is intentionally no strip "+" create chip (create lives under 我的 → 更多).
enum AgentStripModule: String, Equatable, Sendable {
    case assistant
    case collaboration
}

enum AgentStripIconKey: String, Equatable, Sendable {
    case brain
    case sparkles
    case messageSquare
    case zap
    case star
    case radio
    case mic
    case users
    case messagesSquare
    case calendar
    case clipboardCheck
}

struct AgentStripAgent: Equatable, Sendable {
    var id: String
    var name: String?
}

struct AgentStripSession: Equatable, Sendable {
    var key: String
    var displayName: String?
    var updatedAtMs: Double?
}

struct AgentStripItem: Equatable, Sendable, Identifiable {
    var id: String
    var selectionKey: String
    var title: String
    var rawTitle: String
    var module: AgentStripModule
    var iconKey: AgentStripIconKey
    var active: Bool
    var count: Int?
}

struct AgentStripNavModel: Equatable, Sendable {
    var assistantItems: [AgentStripItem]
    var spaceItems: [AgentStripItem]

    var stripItems: [AgentStripItem] {
        self.assistantItems + self.spaceItems
    }
}

let builtinStewardName = "大白管家"
let builtinStewardNavID = "daibai"
let builtinStewardAgentID = "main"
let agentStripBadgeCap = 9

private let assistantIconCycle: [AgentStripIconKey] = [
    .sparkles,
    .messageSquare,
    .zap,
    .star,
    .radio,
    .mic,
]

private let spaceIconCycle: [AgentStripIconKey] = [
    .users,
    .messagesSquare,
    .calendar,
    .clipboardCheck,
]

func sanitizeWorkbenchPeerTitle(_ title: String) -> String {
    var text = title
    while text.hasSuffix("管家家") {
        text.removeLast()
    }
    let collapsed = text.split(whereSeparator: { $0.isWhitespace }).joined(separator: " ")
    return collapsed.trimmingCharacters(in: .whitespacesAndNewlines)
}

func isSpaceScopedSessionKey(_ key: String) -> Bool {
    let raw = key.trimmingCharacters(in: .whitespacesAndNewlines)
    return raw.hasPrefix("space:") || raw.hasPrefix("group:") || raw.contains(":space:")
}

func isBuiltinStewardSessionKey(_ sessionKey: String, mainSessionKey: String) -> Bool {
    let raw = sessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw.isEmpty { return false }
    let mainKey = mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "main"
        : mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
    if raw == mainKey || raw == "main" || raw == "agent:main" || raw.lowercased() == "global" {
        return true
    }
    return raw == "agent:main:main"
}

func isBuiltinStewardAgentID(_ agentID: String) -> Bool {
    let id = agentID.trimmingCharacters(in: .whitespacesAndNewlines)
    return id.isEmpty || id == builtinStewardAgentID || id.lowercased() == "daibai"
}

func formatAgentStripBadge(_ count: Int?) -> String? {
    guard let count, count > 0 else { return nil }
    return String(min(count, agentStripBadgeCap))
}

func friendlySessionName(_ key: String) -> String {
    let stripped = key.split(separator: ":").last.map(String.init) ?? key
    let cleaned = stripped.hasPrefix("g-") ? String(stripped.dropFirst(2)) : stripped
    var seen = Set<String>()
    var words: [String] = []
    for part in cleaned.split(whereSeparator: { $0 == "-" || $0 == "_" }) {
        let word = String(part)
        guard !word.isEmpty else { continue }
        let titled = word.prefix(1).uppercased() + word.dropFirst()
        if seen.insert(titled).inserted {
            words.append(titled)
        }
    }
    let result = words.joined(separator: " ")
    return result.isEmpty ? key : result
}

func resolveAgentPrimarySessionKey(
    agentID: String,
    sessions: [AgentStripSession],
    mainSessionKey: String) -> String
{
    let id = agentID.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? builtinStewardAgentID
        : agentID.trimmingCharacters(in: .whitespacesAndNewlines)
    let mainKey = mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "main"
        : mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
    if isBuiltinStewardAgentID(id) {
        let direct = sessions.filter { !isSpaceScopedSessionKey($0.key) }
        if let match = direct.first(where: { isBuiltinStewardSessionKey($0.key, mainSessionKey: mainKey) }) {
            return match.key
        }
        return mainKey
    }
    let canonical = "agent:\(id):main"
    if sessions.contains(where: { $0.key == canonical }) {
        return canonical
    }
    if let match = sessions.first(where: { session in
        let key = session.key
        return !isSpaceScopedSessionKey(key) && (key == "agent:\(id)" || key.hasPrefix("agent:\(id):"))
    }) {
        return match.key
    }
    return canonical
}

func buildAgentStripNavModel(
    agents: [AgentStripAgent],
    sessions: [AgentStripSession],
    activeSessionKey: String,
    mainSessionKey: String) -> AgentStripNavModel
{
    let mainKey = mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        ? "main"
        : mainSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
    let trimmedActive = activeSessionKey.trimmingCharacters(in: .whitespacesAndNewlines)
    let activeKey: String = {
        if trimmedActive == "main", mainKey != "main" { return mainKey }
        if trimmedActive.isEmpty { return mainKey }
        return trimmedActive
    }()

    var assistants: [AgentStripItem] = []
    var spaces: [AgentStripItem] = []
    var nonDaibaiIndex = 0
    var spaceIndex = 0
    var seenAssistantIDs = Set<String>()
    var seenSpaceTitles = Set<String>()

    let ordered = agents.sorted { lhs, rhs in
        let left = isBuiltinStewardAgentID(lhs.id) ? 0 : 1
        let right = isBuiltinStewardAgentID(rhs.id) ? 0 : 1
        return left < right
    }
    let hasSteward = ordered.contains { isBuiltinStewardAgentID($0.id) }
    let agentRows = hasSteward
        ? ordered
        : [AgentStripAgent(id: builtinStewardAgentID, name: builtinStewardName)] + ordered

    for agent in agentRows {
        let agentID = agent.id.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? builtinStewardAgentID
            : agent.id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard seenAssistantIDs.insert(agentID.lowercased()).inserted else { continue }
        let isSteward = isBuiltinStewardAgentID(agentID)
        let selectionKey = resolveAgentPrimarySessionKey(
            agentID: agentID,
            sessions: sessions,
            mainSessionKey: mainKey)
        let named = agent.name?.trimmingCharacters(in: .whitespacesAndNewlines)
        let sessionName = sessions.first { $0.key == selectionKey }?.displayName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = isSteward ? builtinStewardName : agentID
        let rawSource = [named, sessionName, fallback].compactMap { value -> String? in
            guard let value, !value.isEmpty else { return nil }
            return value
        }.first ?? fallback
        let rawTitle = {
            let sanitized = sanitizeWorkbenchPeerTitle(rawSource)
            return sanitized.isEmpty ? fallback : sanitized
        }()
        let icon: AgentStripIconKey
        if isSteward {
            icon = .brain
        } else {
            icon = assistantIconCycle[nonDaibaiIndex % assistantIconCycle.count]
            nonDaibaiIndex += 1
        }
        let active: Bool
        if isSteward {
            active = isBuiltinStewardSessionKey(activeKey, mainSessionKey: mainKey) || activeKey == selectionKey
        } else {
            active = activeKey == selectionKey
                || activeKey == "agent:\(agentID):main"
                || activeKey.hasPrefix("agent:\(agentID):")
        }
        assistants.append(
            AgentStripItem(
                id: isSteward ? builtinStewardNavID : "assistant:\(agentID)",
                selectionKey: selectionKey,
                title: truncateStripTitle(rawTitle),
                rawTitle: rawTitle,
                module: .assistant,
                iconKey: icon,
                active: active,
                count: nil))
    }

    let spaceSessions = sessions
        .filter { isSpaceScopedSessionKey($0.key) }
        .sorted { ($0.updatedAtMs ?? 0) > ($1.updatedAtMs ?? 0) }
    for entry in spaceSessions {
        let key = entry.key.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { continue }
        let named = entry.displayName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let rawSource = (named?.isEmpty == false ? named : nil) ?? friendlySessionName(key)
        let sanitized = sanitizeWorkbenchPeerTitle(rawSource)
        let rawTitle = sanitized.isEmpty ? friendlySessionName(key) : sanitized
        let titleKey = rawTitle.lowercased()
        guard seenSpaceTitles.insert(titleKey).inserted else { continue }
        let icon = spaceIconCycle[spaceIndex % spaceIconCycle.count]
        spaceIndex += 1
        spaces.append(
            AgentStripItem(
                id: key,
                selectionKey: key,
                title: truncateStripTitle(rawTitle),
                rawTitle: rawTitle,
                module: .collaboration,
                iconKey: icon,
                active: !isBuiltinStewardSessionKey(activeKey, mainSessionKey: mainKey) && key == activeKey,
                count: nil))
    }

    let knownAssistant = assistants.contains {
        $0.selectionKey == activeKey || $0.id == "assistant:\(activeKey)"
    }
    let knownSpace = spaces.contains { $0.selectionKey == activeKey }
    if !activeKey.isEmpty,
       !isBuiltinStewardSessionKey(activeKey, mainSessionKey: mainKey),
       !knownAssistant,
       !knownSpace
    {
        let named = sessions.first { $0.key == activeKey }?.displayName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let rawSource = (named?.isEmpty == false ? named : nil) ?? friendlySessionName(activeKey)
        let rawTitle = sanitizeWorkbenchPeerTitle(rawSource)
        if isSpaceScopedSessionKey(activeKey) {
            spaces.append(
                AgentStripItem(
                    id: activeKey,
                    selectionKey: activeKey,
                    title: truncateStripTitle(rawTitle),
                    rawTitle: rawTitle,
                    module: .collaboration,
                    iconKey: spaceIconCycle[spaceIndex % spaceIconCycle.count],
                    active: true,
                    count: nil))
        } else {
            assistants.append(
                AgentStripItem(
                    id: "assistant:\(activeKey)",
                    selectionKey: activeKey,
                    title: truncateStripTitle(rawTitle),
                    rawTitle: rawTitle,
                    module: .assistant,
                    iconKey: assistantIconCycle[nonDaibaiIndex % assistantIconCycle.count],
                    active: true,
                    count: nil))
        }
    }

    return AgentStripNavModel(assistantItems: assistants, spaceItems: spaces)
}

private func truncateStripTitle(_ title: String, maxChars: Int = 6) -> String {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.count <= maxChars { return trimmed }
    let end = trimmed.index(trimmed.startIndex, offsetBy: maxChars - 1)
    return String(trimmed[..<end]) + "…"
}
