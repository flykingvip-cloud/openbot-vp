import Foundation

/// Read-only evolution perception rows.
///
/// Field names follow `@openbot/evolution-core` timeline items and the
/// Gateway payloads from `evolution.perception.query` / `.project`.
/// Claim grade of this UI shell: runtime-enabled. Not production-proven.
/// Contract: docs/design/openbot-evolution-perception-execution-plan-2026-09-25.md §3.
public struct EvolutionFactIds: Equatable, Sendable, Codable {
    public var ledgerEventId: String
    public var proposalId: String?
    public var applicationId: String?
    public var verificationId: String?

    public init(
        ledgerEventId: String,
        proposalId: String? = nil,
        applicationId: String? = nil,
        verificationId: String? = nil)
    {
        self.ledgerEventId = ledgerEventId
        self.proposalId = proposalId
        self.applicationId = applicationId
        self.verificationId = verificationId
    }

    /// Non-empty fact ids. A visible row needs at least one.
    public var traceableIds: [String] {
        [self.ledgerEventId, self.proposalId, self.applicationId, self.verificationId]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }
}

public enum EvolutionTarget: Equatable, Sendable, Codable {
    case agent(agentId: String)
    case knowledge(assetId: String)
    case capability(skillId: String)
    case organization(groupId: String)
    case system(componentId: String)

    public var domain: String {
        switch self {
        case .agent: "agent"
        case .knowledge: "knowledge"
        case .capability: "capability"
        case .organization: "organization"
        case .system: "system"
        }
    }

    private enum CodingKeys: String, CodingKey {
        case domain
        case agentId
        case assetId
        case skillId
        case groupId
        case componentId
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        switch try container.decode(String.self, forKey: .domain) {
        case "agent":
            self = .agent(agentId: try container.decode(String.self, forKey: .agentId))
        case "knowledge":
            self = .knowledge(assetId: try container.decode(String.self, forKey: .assetId))
        case "capability":
            self = .capability(skillId: try container.decode(String.self, forKey: .skillId))
        case "organization":
            self = .organization(groupId: try container.decode(String.self, forKey: .groupId))
        case "system":
            self = .system(componentId: try container.decode(String.self, forKey: .componentId))
        default:
            throw DecodingError.dataCorrupted(
                .init(codingPath: decoder.codingPath, debugDescription: "unknown evolution target domain"))
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case let .agent(agentId):
            try container.encode("agent", forKey: .domain)
            try container.encode(agentId, forKey: .agentId)
        case let .knowledge(assetId):
            try container.encode("knowledge", forKey: .domain)
            try container.encode(assetId, forKey: .assetId)
        case let .capability(skillId):
            try container.encode("capability", forKey: .domain)
            try container.encode(skillId, forKey: .skillId)
        case let .organization(groupId):
            try container.encode("organization", forKey: .domain)
            try container.encode(groupId, forKey: .groupId)
        case let .system(componentId):
            try container.encode("system", forKey: .domain)
            try container.encode(componentId, forKey: .componentId)
        }
    }
}

public struct EvolutionChangeObject: Equatable, Sendable, Codable {
    public var target: EvolutionTarget
    public var surfaceId: String
    public var domain: String
    public var domainDisplayName: String

    public init(target: EvolutionTarget, surfaceId: String, domain: String, domainDisplayName: String) {
        self.target = target
        self.surfaceId = surfaceId
        self.domain = domain
        self.domainDisplayName = domainDisplayName
    }
}

public struct EvolutionBeforeAfter: Equatable, Sendable, Codable {
    public var versionBefore: String?
    public var versionAfter: String?
    public var summary: String

    public init(versionBefore: String?, versionAfter: String?, summary: String) {
        self.versionBefore = versionBefore
        self.versionAfter = versionAfter
        self.summary = summary
    }
}

public struct EvolutionReason: Equatable, Sendable, Codable {
    public var status: String
    public var sourceEvidenceRefs: [String]
    public var sourceMechanismRef: String?
    public var caseId: String?
    public var findingIds: [String]

    public init(
        status: String,
        sourceEvidenceRefs: [String],
        sourceMechanismRef: String?,
        caseId: String?,
        findingIds: [String])
    {
        self.status = status
        self.sourceEvidenceRefs = sourceEvidenceRefs
        self.sourceMechanismRef = sourceMechanismRef
        self.caseId = caseId
        self.findingIds = findingIds
    }
}

public struct EvolutionEvidence: Equatable, Sendable, Codable {
    public var evidenceRefs: [String]
    public var reportId: String?
    public var verificationId: String?

    public init(evidenceRefs: [String], reportId: String?, verificationId: String?) {
        self.evidenceRefs = evidenceRefs
        self.reportId = reportId
        self.verificationId = verificationId
    }
}

public struct EvolutionImpactScope: Equatable, Sendable, Codable {
    public var confidentialityScope: String?
    public var tenantScope: String?
    public var label: String

    public init(confidentialityScope: String?, tenantScope: String?, label: String) {
        self.confidentialityScope = confidentialityScope
        self.tenantScope = tenantScope
        self.label = label
    }
}

/// One user-visible change. `system` / `platform` must not enter 「我学会了」.
public struct EvolutionTimelineItem: Equatable, Sendable, Codable, Identifiable {
    public var schemaVersion: Int
    public var proposalSchema: Int
    public var legacy: Bool
    public var factIds: EvolutionFactIds
    public var audience: String
    public var changeObject: EvolutionChangeObject
    public var beforeAfter: EvolutionBeforeAfter
    public var reason: EvolutionReason
    public var executionMode: String
    public var evidence: EvolutionEvidence
    public var result: String
    public var bucket: String?
    public var impactScope: EvolutionImpactScope
    public var reversible: Bool
    public var completeness: String

    public var id: String {
        self.factIds.traceableIds.first ?? ""
    }

    public init(
        schemaVersion: Int,
        proposalSchema: Int,
        legacy: Bool,
        factIds: EvolutionFactIds,
        audience: String,
        changeObject: EvolutionChangeObject,
        beforeAfter: EvolutionBeforeAfter,
        reason: EvolutionReason,
        executionMode: String,
        evidence: EvolutionEvidence,
        result: String,
        bucket: String?,
        impactScope: EvolutionImpactScope,
        reversible: Bool,
        completeness: String)
    {
        self.schemaVersion = schemaVersion
        self.proposalSchema = proposalSchema
        self.legacy = legacy
        self.factIds = factIds
        self.audience = audience
        self.changeObject = changeObject
        self.beforeAfter = beforeAfter
        self.reason = reason
        self.executionMode = executionMode
        self.evidence = evidence
        self.result = result
        self.bucket = bucket
        self.impactScope = impactScope
        self.reversible = reversible
        self.completeness = completeness
    }

    public var isSystemDomain: Bool {
        self.audience == "platform"
            || self.changeObject.domain == "system"
            || self.changeObject.target.domain == "system"
    }

    public var resultLabel: String {
        switch self.result {
        case "verified_effective": "已验证有效"
        case "observing": "观察中"
        case "ineffective": "无效"
        case "rolled_back": "已回滚"
        case "pending": "待决定"
        case "unspecified": "unspecified"
        default: self.result
        }
    }

    public var executionModeLabel: String {
        switch self.executionMode {
        case "automatic": "自动"
        case "user_confirmed": "用户确认"
        case "admin_approved": "管理员批准"
        case "platform_release": "平台发布"
        case "unknown": "未知"
        default: self.executionMode
        }
    }
}

/// Budget copied from the projection. Unavailable means the payload did not carry a grant.
public enum EvolutionAutonomyBudget: Equatable, Sendable {
    case unavailable(surfaceId: String)
    case provided(
        surfaceId: String,
        mode: String,
        maxApplications: Int,
        usedApplications: Int,
        remainingApplications: Int,
        expiresAt: String?,
        killSwitch: Bool?)
}

public struct EvolutionAutomaticAction: Equatable, Sendable {
    public var item: EvolutionTimelineItem
    public var budget: EvolutionAutonomyBudget

    public init(item: EvolutionTimelineItem, budget: EvolutionAutonomyBudget) {
        self.item = item
        self.budget = budget
    }
}

public struct EvolutionPerceptionNarrationView: Equatable, Sendable {
    public var learned: [String]
    public var platform: [String]
    public var other: [String]

    public static let empty = EvolutionPerceptionNarrationView(learned: [], platform: [], other: [])

    public init(learned: [String], platform: [String], other: [String]) {
        self.learned = learned
        self.platform = platform
        self.other = other
    }
}

public enum EvolutionPerceptionReadState: Equatable, Sendable {
    case ready
    case empty
    case denied
    case untrusted
}

public struct EvolutionPerceptionQueryView: Equatable, Sendable {
    public var state: EvolutionPerceptionReadState
    public var intent: String
    public var items: [EvolutionTimelineItem]
    public var platformItems: [EvolutionTimelineItem]
    public var narration: EvolutionPerceptionNarrationView
    public var completeness: String
    public var unresolvedIntents: [String]

    public init(
        state: EvolutionPerceptionReadState,
        intent: String,
        items: [EvolutionTimelineItem],
        platformItems: [EvolutionTimelineItem],
        narration: EvolutionPerceptionNarrationView,
        completeness: String,
        unresolvedIntents: [String])
    {
        self.state = state
        self.intent = intent
        self.items = items
        self.platformItems = platformItems
        self.narration = narration
        self.completeness = completeness
        self.unresolvedIntents = unresolvedIntents
    }
}

public struct EvolutionPerceptionPanels: Equatable, Sendable {
    public var timeline: [EvolutionTimelineItem]
    public var learned: [EvolutionTimelineItem]
    public var digest: [EvolutionTimelineItem]
    public var pending: [EvolutionTimelineItem]
    public var automatic: [EvolutionAutomaticAction]
    public var observation: [EvolutionTimelineItem]
    public var rollback: [EvolutionTimelineItem]

    public init(
        timeline: [EvolutionTimelineItem] = [],
        learned: [EvolutionTimelineItem] = [],
        digest: [EvolutionTimelineItem] = [],
        pending: [EvolutionTimelineItem] = [],
        automatic: [EvolutionAutomaticAction] = [],
        observation: [EvolutionTimelineItem] = [],
        rollback: [EvolutionTimelineItem] = [])
    {
        self.timeline = timeline
        self.learned = learned
        self.digest = digest
        self.pending = pending
        self.automatic = automatic
        self.observation = observation
        self.rollback = rollback
    }

    public var isEmpty: Bool {
        self.timeline.isEmpty
            && self.learned.isEmpty
            && self.digest.isEmpty
            && self.pending.isEmpty
            && self.automatic.isEmpty
            && self.observation.isEmpty
            && self.rollback.isEmpty
    }
}

public enum EvolutionPerceptionPanelsRead: Equatable, Sendable {
    case denied
    case untrusted
    case loaded(EvolutionPerceptionPanels)
}

/// User-facing copy. Empty, denial, and untrusted states never claim 「还没学会」.
public enum EvolutionPerceptionCopy {
    public static let empty = "暂无可投影的记录"
    public static let denied = "当前会话无权读取进化投影。"
    public static let untrusted = "投影不是只读响应，已关闭。"
    public static let readOnlyReminder = "只读投影；不会写入、批准或应用。"
    public static let weekChangeTitle = "本周变化"
    public static let moreProjections = "更多投影"
    public static let platformBadge = "平台"
    public static let digitalHumanSection = "数字人"
    public static let platformSection = "平台"
    public static let learnedPanelTitle = "数字人变化"
    public static let learnedNarration = "数字人叙述"
    public static let projectionsEmpty = "当前时间窗下暂无其他投影。"
    public static let successEmptyLead = "这一周（{from} — {to}）没有新的数字人变化。"
    public static let successEmptyHint = "这是正常状态。当前周窗口内没有新的进化事件。"
    public static let successEmptySpanHint = "这是正常状态。这 {days} 天的窗口内没有新的进化事件。"
    public static let successEmptyLastChangeUnknown = "本窗口里查不到上次变化的时间。要看更早的记录，使用「相对上周」。"
    public static let successEmptyRelativeNext = "本窗口里查不到上次变化的时间。相对上周有 {count} 条，建议先查看。"
    public static let freshnessHint = "查询截至 {asOf}。刷新是手动的，数量只统计当前周窗口。"
    public static let freshnessManual = "刷新是手动的，数量只统计当前周窗口。"
    public static let lowSignalFact = "这条记录还没有可查看的变化细节。"
    public static let ctaViewDiff = "查看相对上周"
    public static let ctaExpandProjections = "展开更多投影"
    public static let foldedAutomatic = "有自动执行的变化"
    public static let foldedApproved = "有经批准的变化"
    public static let foldedObserving = "有观察中的变化"
    public static let foldedRolledBack = "有已回滚的变化"
    public static let foldedPlatform = "有平台变化"
}

public struct EvolutionProvenanceField: Equatable, Sendable {
    public var label: String
    public var value: String

    public init(label: String, value: String) {
        self.label = label
        self.value = value
    }
}

/// Read-only provenance for one projected fact. Values come only from the item.
public struct EvolutionFactDetail: Equatable, Sendable {
    public var audienceLabel: String
    public var isPlatform: Bool
    public var fields: [EvolutionProvenanceField]

    public init(audienceLabel: String, isPlatform: Bool, fields: [EvolutionProvenanceField]) {
        self.audienceLabel = audienceLabel
        self.isPlatform = isPlatform
        self.fields = fields
    }

    public func value(labeled label: String) -> String? {
        self.fields.first { $0.label == label }?.value
    }

    public static func make(
        item: EvolutionTimelineItem,
        window: EvolutionPerceptionWindow? = nil) -> EvolutionFactDetail
    {
        var fields: [EvolutionProvenanceField] = []
        func present(_ label: String, _ value: String?) {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !trimmed.isEmpty else { return }
            fields.append(EvolutionProvenanceField(label: label, value: trimmed))
        }
        func required(_ label: String, _ value: String?) {
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            fields.append(EvolutionProvenanceField(label: label, value: trimmed.isEmpty ? "未提供" : trimmed))
        }
        func joined(_ values: [String]) -> String? {
            let kept = values
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            return kept.isEmpty ? nil : kept.joined(separator: "、")
        }

        present("账本事件", item.factIds.ledgerEventId)
        present("提案", item.factIds.proposalId)
        present("应用", item.factIds.applicationId)
        present("验证", item.factIds.verificationId)
        required("领域", item.changeObject.domain)
        let audience = item.isSystemDomain ? EvolutionPerceptionCopy.platformBadge : "数字人"
        required("受众", audience)
        required("前版本", item.beforeAfter.versionBefore)
        required("后版本", item.beforeAfter.versionAfter)
        let summary = item.beforeAfter.summary == "unavailable" ? "前后版本不可用" : item.beforeAfter.summary
        required("摘要", summary)
        required("原因状态", item.reason.status)
        required("来源证据", joined(item.reason.sourceEvidenceRefs))
        required("机制引用", item.reason.sourceMechanismRef)
        required("案例", item.reason.caseId)
        required("发现", joined(item.reason.findingIds))
        required("证据引用", joined(item.evidence.evidenceRefs))
        required("报告", item.evidence.reportId)
        required("证据验证", item.evidence.verificationId)
        required("执行", item.executionMode)
        required("结果", item.result)
        required("分桶", item.bucket)
        required("影响范围", item.impactScope.label)
        required("可逆", item.reversible ? "是" : "否")
        required("完整度", item.completeness)
        if let window {
            required("窗口", "\(window.from) – \(window.to)")
        }
        return EvolutionFactDetail(
            audienceLabel: audience,
            isPlatform: item.isSystemDomain,
            fields: fields)
    }
}
