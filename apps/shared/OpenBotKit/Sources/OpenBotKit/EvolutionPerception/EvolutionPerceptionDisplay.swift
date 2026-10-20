import Foundation

/// How much of a projected change can be told without placeholder metadata.
public enum EvolutionFactSignal: String, Equatable, Sendable {
    case none
    case sparse
    case story
}

public struct EvolutionFactPresentation: Equatable, Sendable {
    public var signal: EvolutionFactSignal
    public var title: String
    public var story: String

    public init(signal: EvolutionFactSignal, title: String, story: String) {
        self.signal = signal
        self.title = title
        self.story = story
    }
}

public struct EvolutionProjectionGroup: Identifiable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var items: [EvolutionTimelineItem]
    public var actions: [EvolutionAutomaticAction]

    public init(
        id: String,
        title: String,
        items: [EvolutionTimelineItem],
        actions: [EvolutionAutomaticAction] = [])
    {
        self.id = id
        self.title = title
        self.items = items
        self.actions = actions
    }
}

/// Read-only presentation for the evolution perception page.
/// Placeholder rows (未指定 / 不可用 / 未知 / 未提供) stay out of the default story.
public enum EvolutionPerceptionDisplay {
    private static let placeholderValues: Set<String> = [
        "未指定",
        "未说明",
        "未知",
        "未提供",
        "前后版本不可用",
        "未命名对象",
        "unavailable",
        "unspecified",
        "unknown",
    ]

    private static let surfaceLabels: [String: String] = [
        "agent.working-dna": "工作风格",
        "knowledge.experience-capsule": "经验胶囊",
        "knowledge.managed-memory": "托管记忆",
        "capability.skill-spec": "技能规格",
        "capability.skill-installation": "技能安装",
        "organization.task-routing": "任务路由",
        "organization.team-composition": "团队组成",
        "system.diagnosis-contract": "诊断契约",
        "system.runtime-binding-governance": "运行绑定治理",
    ]

    public static func isPlaceholder(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty || self.placeholderValues.contains(trimmed)
    }

    public static func surfaceLabel(_ surfaceId: String) -> String {
        let trimmed = surfaceId.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            return "未命名对象"
        }
        if let known = self.surfaceLabels[trimmed] {
            return known
        }
        let leaf = trimmed.split(separator: ".").last.map(String.init) ?? trimmed
        if leaf.isEmpty {
            return "未命名对象"
        }
        if self.looksTechnical(leaf) {
            let mapped = leaf.split { $0 == "-" || $0 == "_" }.map { part -> String in
                switch part {
                case "skill": "技能"
                case "installation": "安装"
                case "spec": "规格"
                case "working": "工作"
                case "dna": "风格"
                default: String(part)
                }
            }.joined()
            return mapped.isEmpty ? "未命名对象" : mapped
        }
        return leaf
    }

    public static func resultLabel(_ result: String) -> String {
        switch result {
        case "verified_effective": "已验证有效"
        case "observing": "观察中"
        case "ineffective": "无效"
        case "rolled_back": "已回滚"
        case "pending": "待决定"
        case "unspecified": "未指定"
        default: self.looksTechnical(result) ? "未指定" : result
        }
    }

    public static func executionLabel(_ mode: String) -> String {
        switch mode {
        case "automatic": "自动"
        case "user_confirmed": "用户确认"
        case "admin_approved": "管理员批准"
        case "platform_release": "平台发布"
        case "unknown": "未知"
        default: self.looksTechnical(mode) ? "未知" : mode
        }
    }

    public static func reasonLabel(_ status: String) -> String {
        switch status {
        case "specified": "已说明"
        case "unspecified": "未说明"
        default: self.looksTechnical(status) ? "未说明" : status
        }
    }

    public static func impactLabel(_ label: String) -> String {
        switch label {
        case "本人", "企业", "平台": label
        case "unspecified": "未指定"
        default: self.looksTechnical(label) ? "未指定" : label
        }
    }

    public static func summaryLabel(_ summary: String) -> String {
        summary == "unavailable" ? "前后版本不可用" : summary
    }

    public static func present(_ item: EvolutionTimelineItem) -> EvolutionFactPresentation {
        let objectLabel = self.surfaceLabel(item.changeObject.surfaceId)
        let beforeLabel = self.summaryLabel(item.beforeAfter.summary)
        let execution = self.executionLabel(item.executionMode)
        let impact = self.impactLabel(item.impactScope.label)
        let objectOk = !self.isPlaceholder(objectLabel)
        let beforeOk = item.beforeAfter.summary.trimmingCharacters(in: .whitespacesAndNewlines) != "unavailable"
            && !self.isPlaceholder(beforeLabel)
        let executionOk = item.executionMode.trimmingCharacters(in: .whitespacesAndNewlines) != "unknown"
            && !self.isPlaceholder(execution)
        let impactOk = item.impactScope.label.trimmingCharacters(in: .whitespacesAndNewlines) != "unspecified"
            && !self.isPlaceholder(impact)
        let meaningful = [objectOk, beforeOk, executionOk, impactOk].filter { $0 }.count
        let signal: EvolutionFactSignal = meaningful == 0 ? .none : (beforeOk || executionOk ? .story : .sparse)
        var parts: [String] = []
        if objectOk { parts.append(objectLabel) }
        if beforeOk { parts.append(beforeLabel) }
        if executionOk { parts.append(execution) }
        if impactOk { parts.append("影响\(impact)") }
        let reason = self.reasonLabel(item.reason.status)
        if !self.isPlaceholder(reason) { parts.append(reason) }
        let result = self.resultLabel(item.result)
        if !self.isPlaceholder(result) { parts.append(result) }
        if signal != .none { parts.append(item.reversible ? "可逆" : "不可逆") }
        return EvolutionFactPresentation(signal: signal, title: self.itemTitle(item), story: parts.joined(separator: " · "))
    }

    public static func visibleGroups(_ panels: EvolutionPerceptionPanels) -> [EvolutionProjectionGroup] {
        var seen = Set<String>()
        func take(_ items: [EvolutionTimelineItem]) -> [EvolutionTimelineItem] {
            var kept: [EvolutionTimelineItem] = []
            for item in items {
                guard self.present(item).signal != .none else { continue }
                let key = self.itemKey(item)
                guard seen.insert(key).inserted else { continue }
                kept.append(item)
            }
            return kept
        }
        var groups: [EvolutionProjectionGroup] = []
        func push(_ id: String, _ title: String, _ items: [EvolutionTimelineItem]) {
            let visible = take(items)
            guard !visible.isEmpty else { return }
            groups.append(EvolutionProjectionGroup(id: id, title: title, items: visible))
        }
        push("learned", EvolutionPerceptionCopy.learnedPanelTitle, panels.learned)
        push("timeline", "时间线", panels.timeline)
        push("digest", "周报", panels.digest)
        push("pending", "待决定", panels.pending)
        var actions: [EvolutionAutomaticAction] = []
        for action in panels.automatic {
            guard self.present(action.item).signal != .none else { continue }
            let key = self.itemKey(action.item)
            guard seen.insert(key).inserted else { continue }
            actions.append(action)
        }
        if !actions.isEmpty {
            groups.append(
                EvolutionProjectionGroup(
                    id: "automatic",
                    title: "自动动作",
                    items: actions.map(\.item),
                    actions: actions))
        }
        push("observation", "观察队列", panels.observation)
        push("rollback", "回滚史", panels.rollback)
        return groups
    }

    /// One line per former chip, only when a meaningful fact is not already on screen.
    public static func foldedNotes(
        _ panels: EvolutionPerceptionPanels,
        shown: [EvolutionTimelineItem]) -> [String]
    {
        var seen = Set(shown.map { self.itemKey($0) })
        var notes: [String] = []
        func push(_ items: [EvolutionTimelineItem], _ label: String) {
            var extra: [EvolutionTimelineItem] = []
            for item in items {
                guard self.present(item).signal != .none else { continue }
                let key = self.itemKey(item)
                guard seen.insert(key).inserted else { continue }
                extra.append(item)
            }
            guard !extra.isEmpty else { return }
            if extra.count == 1, let story = extra.first.map({ self.present($0).story }), !story.isEmpty {
                notes.append("\(label)：\(story)。")
            } else {
                notes.append("\(label)。")
            }
        }
        push(panels.automatic.map(\.item), EvolutionPerceptionCopy.foldedAutomatic)
        push(panels.timeline.filter { $0.bucket == "user_approved" }, EvolutionPerceptionCopy.foldedApproved)
        push(panels.observation, EvolutionPerceptionCopy.foldedObserving)
        push(panels.rollback, EvolutionPerceptionCopy.foldedRolledBack)
        push(
            (panels.timeline + panels.learned).filter(\.isSystemDomain),
            EvolutionPerceptionCopy.foldedPlatform)
        return notes
    }

    public static func visibleCount(_ panels: EvolutionPerceptionPanels) -> Int {
        self.visibleGroups(panels).reduce(0) { total, group in
            total + (group.actions.isEmpty ? group.items.count : group.actions.count)
        }
    }

    public static func successEmptyLead(_ window: EvolutionPerceptionWindow) -> String {
        let from = self.shortPart(window.from)
        let to = self.shortEnd(from: window.from, to: window.to)
        return EvolutionPerceptionCopy.successEmptyLead
            .replacingOccurrences(of: "{from}", with: from)
            .replacingOccurrences(of: "{to}", with: to)
    }

    public static func daySpan(_ window: EvolutionPerceptionWindow) -> Int? {
        guard let from = self.parseInstant(window.from), let to = self.parseInstant(window.to) else {
            return nil
        }
        let seconds = to.timeIntervalSince(from)
        guard seconds > 0 else { return nil }
        let days = Int((seconds / 86_400.0).rounded())
        return days >= 1 ? days : nil
    }

    public static func successEmptyHint(_ window: EvolutionPerceptionWindow) -> String {
        guard let days = self.daySpan(window) else {
            return EvolutionPerceptionCopy.successEmptyHint
        }
        return EvolutionPerceptionCopy.successEmptySpanHint.replacingOccurrences(of: "{days}", with: String(days))
    }

    public static func lastChangeCopy(relativeCount: Int?) -> String {
        if let relativeCount, relativeCount > 0 {
            return EvolutionPerceptionCopy.successEmptyRelativeNext.replacingOccurrences(
                of: "{count}",
                with: String(relativeCount))
        }
        return EvolutionPerceptionCopy.successEmptyLastChangeUnknown
    }

    public static func queryAsOf(_ value: String) -> String? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let date = self.calendarDate(trimmed) else { return nil }
        let day = "\(date.year)-\(date.month)-\(date.day)"
        guard trimmed.count >= 16 else { return day }
        let timeIndex = trimmed.index(trimmed.startIndex, offsetBy: 10)
        let marker = trimmed[timeIndex]
        guard marker == "T" || marker == " " else { return day }
        let hourStart = trimmed.index(timeIndex, offsetBy: 1)
        let hourEnd = trimmed.index(hourStart, offsetBy: 2)
        guard trimmed[hourEnd] == ":" else { return day }
        let minuteStart = trimmed.index(hourEnd, offsetBy: 1)
        guard trimmed.distance(from: minuteStart, to: trimmed.endIndex) >= 2 else { return day }
        let minuteEnd = trimmed.index(minuteStart, offsetBy: 2)
        let hour = String(trimmed[hourStart..<hourEnd])
        let minute = String(trimmed[minuteStart..<minuteEnd])
        guard hour.allSatisfy(\.isNumber), minute.allSatisfy(\.isNumber) else { return day }
        var rest = String(trimmed[minuteEnd...])
        if rest.hasPrefix(":") {
            rest.removeFirst()
            while let first = rest.first, first.isNumber || first == "." {
                rest.removeFirst()
            }
        }
        let zone: String
        if rest == "Z" || rest == "z" {
            zone = " UTC"
        } else if rest.first == "+" || rest.first == "-" {
            zone = " \(rest)"
        } else {
            zone = ""
        }
        return "\(day) \(hour):\(minute)\(zone)"
    }

    public static func freshness(_ window: EvolutionPerceptionWindow) -> String {
        guard let asOf = self.queryAsOf(window.to) else {
            return EvolutionPerceptionCopy.freshnessManual
        }
        return EvolutionPerceptionCopy.freshnessHint.replacingOccurrences(of: "{asOf}", with: asOf)
    }

    public static func windowPrecision(_ window: EvolutionPerceptionWindow) -> String {
        "\(window.from) – \(window.to)"
    }

    public static func windowLabel(_ window: EvolutionPerceptionWindow) -> String {
        guard let from = self.calendarDate(window.from), let to = self.calendarDate(window.to) else {
            return self.windowPrecision(window)
        }
        let start = "\(from.year)-\(from.month)-\(from.day)"
        let end = from.year == to.year ? "\(to.month)-\(to.day)" : "\(to.year)-\(to.month)-\(to.day)"
        return "\(start) – \(end)"
    }

    private static func itemTitle(_ item: EvolutionTimelineItem) -> String {
        let display = item.changeObject.domainDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !display.isEmpty, !self.looksTechnical(display), display != "unspecified" {
            return display
        }
        return self.surfaceLabel(item.changeObject.surfaceId)
    }

    private static func itemKey(_ item: EvolutionTimelineItem) -> String {
        if let id = item.factIds.traceableIds.first, !id.isEmpty {
            return id
        }
        let presentation = self.present(item)
        return "\(presentation.title)|\(presentation.story)"
    }

    private static func looksTechnical(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return false }
        if trimmed.unicodeScalars.contains(where: { (0x4E00...0x9FFF).contains($0.value) }) {
            return false
        }
        if trimmed.contains(":") || trimmed.contains(".") { return true }
        guard let first = trimmed.first, first.isLetter else { return false }
        return trimmed.allSatisfy { character in
            character.isLetter || character.isNumber || character == "_" || character == "-" || character == "."
        }
    }

    private static func calendarDate(_ value: String) -> (year: String, month: String, day: String)? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 10 else { return nil }
        let yearEnd = trimmed.index(trimmed.startIndex, offsetBy: 4)
        let monthStart = trimmed.index(yearEnd, offsetBy: 1)
        let monthEnd = trimmed.index(monthStart, offsetBy: 2)
        let dayStart = trimmed.index(monthEnd, offsetBy: 1)
        let dayEnd = trimmed.index(dayStart, offsetBy: 2)
        guard trimmed[yearEnd] == "-", trimmed[monthEnd] == "-" else { return nil }
        let year = String(trimmed[trimmed.startIndex..<yearEnd])
        let month = String(trimmed[monthStart..<monthEnd])
        let day = String(trimmed[dayStart..<dayEnd])
        guard year.allSatisfy(\.isNumber), month.allSatisfy(\.isNumber), day.allSatisfy(\.isNumber) else {
            return nil
        }
        if trimmed.count > 10 {
            let marker = trimmed[trimmed.index(trimmed.startIndex, offsetBy: 10)]
            guard marker == "T" || marker == " " else { return nil }
        }
        return (year, month, day)
    }

    private static func shortPart(_ value: String) -> String {
        guard let date = self.calendarDate(value) else {
            return value.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return "\(date.year)-\(date.month)-\(date.day)"
    }

    private static func shortEnd(from: String, to: String) -> String {
        guard let start = self.calendarDate(from), let end = self.calendarDate(to) else {
            return self.shortPart(to)
        }
        if start.year == end.year {
            return "\(end.month)-\(end.day)"
        }
        return "\(end.year)-\(end.month)-\(end.day)"
    }

    private static func parseInstant(_ value: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        if let date = formatter.date(from: value) {
            return date
        }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: value)
    }
}
