import Foundation

/// Fail-closed mapping from Gateway perception payloads onto visible rows.
///
/// Drops rows without a fact id, keeps `system` out of the learned set, and
/// refuses payloads that are not `access=read-only` and `persisted=false`.
public enum EvolutionPerceptionMapping {
    public static let readOnlyAccess = "read-only"
    private static let learnedClaim = "学会了"
    private static let autonomyModes: Set<String> = ["off", "assist", "auto"]

    public static func acceptItems(_ items: [EvolutionTimelineItem]) -> [EvolutionTimelineItem] {
        items.filter { !$0.factIds.traceableIds.isEmpty }
    }

    /// Digital-human learned set. Platform / `system` rows are removed.
    public static func learnedItems(_ items: [EvolutionTimelineItem]) -> [EvolutionTimelineItem] {
        self.acceptItems(items).filter { !$0.isSystemDomain }
    }

    public static func rollbackItems(_ items: [EvolutionTimelineItem]) -> [EvolutionTimelineItem] {
        self.acceptItems(items).filter { $0.bucket == "rolled_back" }
    }

    public static func guardNarration(
        learned: [String],
        platform: [String],
        other: [String],
        items: [EvolutionTimelineItem],
        narrationGuard: String?) -> EvolutionPerceptionNarrationView
    {
        if let narrationGuard, !narrationGuard.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            return .empty
        }
        let allowedIds = self.learnedItems(items).flatMap(\.factIds.traceableIds)
        return EvolutionPerceptionNarrationView(
            learned: learned.filter { self.sentenceIsVisible($0, allowedFactIds: allowedIds, allowLearnedClaim: true) },
            platform: platform.filter { self.sentenceIsVisible($0, allowedFactIds: [], allowLearnedClaim: false) },
            other: other.filter { self.sentenceIsVisible($0, allowedFactIds: [], allowLearnedClaim: false) })
    }

    public static func acceptQuery(_ data: Data) -> EvolutionPerceptionQueryView {
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(QueryEnvelope.self, from: data) else {
            return self.emptyQuery(intent: "", state: .untrusted)
        }
        guard envelope.access == self.readOnlyAccess, envelope.persisted == false else {
            return self.emptyQuery(intent: envelope.intent ?? "", state: .untrusted)
        }
        if envelope.denial?.denied == true {
            return self.emptyQuery(intent: envelope.intent ?? "", state: .denied)
        }
        let sourceItems = self.acceptItems(envelope.result?.items?.items ?? [])
        let acceptedPlatform = self.acceptItems(envelope.result?.platformItems?.items ?? [])
        let items = self.deduped(
            sourceItems.filter { !$0.isSystemDomain } + acceptedPlatform.filter { !$0.isSystemDomain })
        let platformItems = self.deduped(
            sourceItems.filter(\.isSystemDomain) + acceptedPlatform.filter(\.isSystemDomain))
        let narration = self.guardNarration(
            learned: envelope.narration?.learned ?? [],
            platform: envelope.narration?.platform ?? [],
            other: envelope.narration?.other ?? [],
            items: items + platformItems,
            narrationGuard: envelope.narrationGuard)
        let completeness = envelope.result?.completeness ?? "empty"
        let unresolved = envelope.result?.unresolvedIntents ?? []
        let state: EvolutionPerceptionReadState =
            items.isEmpty && platformItems.isEmpty && narration == .empty ? .empty : .ready
        return EvolutionPerceptionQueryView(
            state: state,
            intent: envelope.intent ?? "",
            items: items,
            platformItems: platformItems,
            narration: narration,
            completeness: completeness,
            unresolvedIntents: unresolved)
    }

    public static func acceptProject(_ data: Data) -> EvolutionPerceptionProjectSlice {
        let decoder = JSONDecoder()
        guard let envelope = try? decoder.decode(ProjectEnvelope.self, from: data) else {
            return EvolutionPerceptionProjectSlice(operation: "", state: .untrusted)
        }
        guard envelope.access == self.readOnlyAccess, envelope.persisted == false else {
            return EvolutionPerceptionProjectSlice(operation: envelope.operation ?? "", state: .untrusted)
        }
        if envelope.denial?.denied == true {
            return EvolutionPerceptionProjectSlice(operation: envelope.operation ?? "", state: .denied)
        }
        let projection = envelope.projection
        let items = self.acceptItems(projection?.items?.items ?? [])
        let learned = self.learnedItems(projection?.learnedItems?.items ?? items)
        let actions = (projection?.actions?.actions ?? []).compactMap { raw -> EvolutionAutomaticAction? in
            guard let item = EvolutionTimelineItem.accepted(raw.item), !item.factIds.traceableIds.isEmpty else {
                return nil
            }
            return EvolutionAutomaticAction(
                item: item,
                budget: self.budget(raw.budget, fallbackSurface: item.changeObject.surfaceId))
        }
        let observation = self.acceptItems(projection?.items?.items ?? [])
        let digitalHuman = self.learnedItems(projection?.digitalHumanItems?.items ?? [])
        let platform = self.acceptItems(projection?.platformItems?.items ?? []).filter(\.isSystemDomain)
        let populated = !items.isEmpty || !learned.isEmpty || !actions.isEmpty
            || !digitalHuman.isEmpty || !platform.isEmpty
        return EvolutionPerceptionProjectSlice(
            operation: envelope.operation ?? "",
            state: populated ? .ready : .empty,
            items: items,
            learnedItems: learned,
            actions: actions,
            observationItems: observation,
            observationDigitalHuman: digitalHuman,
            observationPlatform: platform)
    }

    public static func panels(from slices: [EvolutionPerceptionProjectSlice]) -> EvolutionPerceptionPanelsRead {
        if slices.contains(where: { $0.state == .denied }) {
            return .denied
        }
        if slices.contains(where: { $0.state == .untrusted }) {
            return .untrusted
        }
        func slice(_ operation: String) -> EvolutionPerceptionProjectSlice? {
            slices.first { $0.operation == operation }
        }
        let timeline = self.acceptItems(slice("timeline")?.items ?? [])
        let learnedSource = slice("timeline")?.learnedItems ?? timeline
        let observationSlice = slice("observation")
        let observation = self.deduped(
            (observationSlice?.observationItems ?? [])
                + (observationSlice?.observationDigitalHuman ?? [])
                + (observationSlice?.observationPlatform ?? []))
        return .loaded(EvolutionPerceptionPanels(
            timeline: timeline,
            learned: self.learnedItems(learnedSource),
            digest: self.acceptItems(slice("digest")?.items ?? []),
            pending: self.acceptItems(slice("pending")?.items ?? []),
            automatic: (slice("automatic")?.actions ?? []).filter { !$0.item.factIds.traceableIds.isEmpty },
            observation: observation,
            rollback: self.rollbackItems(timeline)))
    }

    private static func deduped(_ items: [EvolutionTimelineItem]) -> [EvolutionTimelineItem] {
        var seen = Set<String>()
        return items.filter { item in
            let key = item.id
            guard !key.isEmpty, seen.insert(key).inserted else { return false }
            return true
        }
    }

    static func sentenceIsVisible(_ sentence: String, allowedFactIds: [String], allowLearnedClaim: Bool) -> Bool {
        let trimmed = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        if trimmed.contains(self.learnedClaim) {
            guard allowLearnedClaim else { return false }
            return allowedFactIds.contains { !$0.isEmpty && trimmed.contains($0) }
        }
        return true
    }

    private static func budget(_ raw: RawBudget?, fallbackSurface: String) -> EvolutionAutonomyBudget {
        guard let raw else {
            return .unavailable(surfaceId: fallbackSurface)
        }
        let surfaceId = raw.surfaceId?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
            ? raw.surfaceId!.trimmingCharacters(in: .whitespacesAndNewlines)
            : fallbackSurface
        guard raw.available == true,
              let mode = raw.mode, self.autonomyModes.contains(mode),
              let maxApplications = raw.maxApplications,
              let usedApplications = raw.usedApplications,
              let remainingApplications = raw.remainingApplications
        else {
            return .unavailable(surfaceId: surfaceId)
        }
        let expires = raw.expiresAt?.trimmingCharacters(in: .whitespacesAndNewlines)
        return .provided(
            surfaceId: surfaceId,
            mode: mode,
            maxApplications: maxApplications,
            usedApplications: usedApplications,
            remainingApplications: remainingApplications,
            expiresAt: expires?.isEmpty == false ? expires : nil,
            killSwitch: raw.killSwitch)
    }

    private static func emptyQuery(
        intent: String,
        state: EvolutionPerceptionReadState) -> EvolutionPerceptionQueryView
    {
        EvolutionPerceptionQueryView(
            state: state,
            intent: intent,
            items: [],
            platformItems: [],
            narration: .empty,
            completeness: "empty",
            unresolvedIntents: [])
    }
}

public struct EvolutionPerceptionProjectSlice: Equatable, Sendable {
    public var operation: String
    public var state: EvolutionPerceptionReadState
    public var items: [EvolutionTimelineItem]
    public var learnedItems: [EvolutionTimelineItem]
    public var actions: [EvolutionAutomaticAction]
    public var observationItems: [EvolutionTimelineItem]
    public var observationDigitalHuman: [EvolutionTimelineItem]
    public var observationPlatform: [EvolutionTimelineItem]

    public init(
        operation: String,
        state: EvolutionPerceptionReadState,
        items: [EvolutionTimelineItem] = [],
        learnedItems: [EvolutionTimelineItem] = [],
        actions: [EvolutionAutomaticAction] = [],
        observationItems: [EvolutionTimelineItem] = [],
        observationDigitalHuman: [EvolutionTimelineItem] = [],
        observationPlatform: [EvolutionTimelineItem] = [])
    {
        self.operation = operation
        self.state = state
        self.items = items
        self.learnedItems = learnedItems
        self.actions = actions
        self.observationItems = observationItems
        self.observationDigitalHuman = observationDigitalHuman
        self.observationPlatform = observationPlatform
    }
}

extension EvolutionTimelineItem {
    static func accepted(_ raw: RawTimelineItem) -> EvolutionTimelineItem? {
        guard let factIds = raw.factIds, !factIds.traceableIds.isEmpty else { return nil }
        guard let change = raw.changeObject else { return nil }
        guard raw.proposalSchema == 1 || raw.proposalSchema == 2 else { return nil }
        let domain = change.domain.isEmpty ? change.target.domain : change.domain
        let system = domain == "system" || change.target.domain == "system" || raw.audience == "platform"
        let audience = system ? "platform" : "digital_human"
        let display = change.domainDisplayName.trimmingCharacters(in: .whitespacesAndNewlines)
        let before = raw.beforeAfter ?? EvolutionBeforeAfter(
            versionBefore: nil,
            versionAfter: nil,
            summary: "unavailable")
        let reason = raw.reason ?? EvolutionReason(
            status: "unspecified",
            sourceEvidenceRefs: [],
            sourceMechanismRef: nil,
            caseId: nil,
            findingIds: [])
        let evidence = raw.evidence ?? EvolutionEvidence(evidenceRefs: [], reportId: nil, verificationId: nil)
        let impact = raw.impactScope ?? EvolutionImpactScope(
            confidentialityScope: nil,
            tenantScope: nil,
            label: "unspecified")
        let hasVersions = before.versionBefore?.isEmpty == false && before.versionAfter?.isEmpty == false
        return EvolutionTimelineItem(
            schemaVersion: raw.schemaVersion ?? 1,
            proposalSchema: raw.proposalSchema ?? 2,
            legacy: raw.legacy ?? (raw.proposalSchema == 1),
            factIds: factIds,
            audience: audience,
            changeObject: EvolutionChangeObject(
                target: change.target,
                surfaceId: change.surfaceId,
                domain: domain,
                domainDisplayName: display.isEmpty ? domain : display),
            beforeAfter: EvolutionBeforeAfter(
                versionBefore: before.versionBefore,
                versionAfter: before.versionAfter,
                summary: hasVersions ? before.summary : "unavailable"),
            reason: reason,
            executionMode: raw.executionMode ?? "unknown",
            evidence: evidence,
            result: raw.result ?? "unspecified",
            bucket: raw.bucket,
            impactScope: impact,
            reversible: raw.reversible ?? false,
            completeness: hasVersions ? (raw.completeness ?? "complete") : "partial")
    }
}

struct RawTimelineItem: Decodable {
    var schemaVersion: Int?
    var proposalSchema: Int?
    var legacy: Bool?
    var factIds: EvolutionFactIds?
    var audience: String?
    var changeObject: EvolutionChangeObject?
    var beforeAfter: EvolutionBeforeAfter?
    var reason: EvolutionReason?
    var executionMode: String?
    var evidence: EvolutionEvidence?
    var result: String?
    var bucket: String?
    var impactScope: EvolutionImpactScope?
    var reversible: Bool?
    var completeness: String?
}

struct RawBudget: Decodable {
    var available: Bool?
    var surfaceId: String?
    var mode: String?
    var maxApplications: Int?
    var usedApplications: Int?
    var remainingApplications: Int?
    var expiresAt: String?
    var killSwitch: Bool?
}

private struct RawAction: Decodable {
    var item: RawTimelineItem
    var budget: RawBudget?
}

private struct QueryEnvelope: Decodable {
    var access: String?
    var persisted: Bool?
    var intent: String?
    var denial: DenialBody?
    var result: QueryResultBody?
    var narration: NarrationBody?
    var narrationGuard: String?
}

private struct QueryResultBody: Decodable {
    var items: LossyTimelineItems?
    var platformItems: LossyTimelineItems?
    var unresolvedIntents: [String]?
    var completeness: String?
}

private struct NarrationBody: Decodable {
    var learned: [String]?
    var platform: [String]?
    var other: [String]?
}

private struct ProjectEnvelope: Decodable {
    var access: String?
    var persisted: Bool?
    var operation: String?
    var denial: DenialBody?
    var projection: ProjectionBody?
}

private struct ProjectionBody: Decodable {
    var items: LossyTimelineItems?
    var learnedItems: LossyTimelineItems?
    var actions: LossyActions?
    var digitalHumanItems: LossyTimelineItems?
    var platformItems: LossyTimelineItems?
    var completeness: String?
}

private struct DenialBody: Decodable {
    var denied: Bool?
    var reason: String?
}

private struct LossyTimelineItems: Decodable {
    var items: [EvolutionTimelineItem]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var items: [EvolutionTimelineItem] = []
        while !container.isAtEnd {
            if let raw = try? container.decode(RawTimelineItem.self) {
                if let item = EvolutionTimelineItem.accepted(raw) {
                    items.append(item)
                }
            } else {
                _ = try container.decode(JSONSkip.self)
            }
        }
        self.items = items
    }
}

private struct LossyActions: Decodable {
    var actions: [RawAction]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var actions: [RawAction] = []
        while !container.isAtEnd {
            if let action = try? container.decode(RawAction.self) {
                actions.append(action)
            } else {
                _ = try container.decode(JSONSkip.self)
            }
        }
        self.actions = actions
    }
}

/// Consumes one JSON value so a failed row decode still advances the array.
private struct JSONSkip: Decodable {
    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { return }
        if (try? container.decode(Bool.self)) != nil { return }
        if (try? container.decode(Double.self)) != nil { return }
        if (try? container.decode(String.self)) != nil { return }
        if (try? container.decode([JSONSkip].self)) != nil { return }
        if (try? container.decode([String: JSONSkip].self)) != nil { return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "unable to skip json value")
    }
}
