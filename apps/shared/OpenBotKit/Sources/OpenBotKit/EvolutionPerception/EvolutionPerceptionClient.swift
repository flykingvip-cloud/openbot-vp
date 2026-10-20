import Foundation
#if canImport(Observation)
import Observation
#endif

/// Gateway methods this UI is allowed to call. Both are `operator.read`.
public enum EvolutionPerceptionMethod {
    public static let query = "evolution.perception.query"
    public static let project = "evolution.perception.project"

    public static func isAllowed(_ method: String) -> Bool {
        method == self.query || method == self.project
    }
}

public enum EvolutionPerceptionProjectOperation: String, CaseIterable, Sendable {
    case timeline
    case digest
    case pending
    case automatic
    case observation
}

public struct EvolutionPerceptionWindow: Equatable, Sendable, Codable {
    public var from: String
    public var to: String

    public init(from: String, to: String) {
        self.from = from
        self.to = to
    }

    /// Inclusive window ending now, used by digest and §4 intent queries.
    public static func trailingDays(_ days: Int, ending now: Date = Date()) -> EvolutionPerceptionWindow {
        let span = TimeInterval(max(days, 1) * 24 * 60 * 60)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        return EvolutionPerceptionWindow(
            from: formatter.string(from: now.addingTimeInterval(-span)),
            to: formatter.string(from: now))
    }
}

public enum EvolutionPerceptionIntent: String, CaseIterable, Sendable, Equatable, Identifiable {
    case learnedThisWeek = "learned_this_week"
    case diffFromLastWeek = "diff_from_last_week"
    case automatic
    case userApproved = "user_approved"
    case observing
    case rolledBack = "rolled_back"
    case platformUpgradesThisWeek = "platform_upgrades_this_week"

    public var id: String { self.rawValue }

    /// Chips on the evolution page. The other cases stay queryable, not navigable.
    public static let toolbar: [EvolutionPerceptionIntent] = [.learnedThisWeek, .diffFromLastWeek]

    public var title: String {
        switch self {
        case .learnedThisWeek: EvolutionPerceptionCopy.weekChangeTitle
        case .diffFromLastWeek: "相对上周"
        case .automatic: "哪些自动"
        case .userApproved: "哪些批准"
        case .observing: "哪些观察"
        case .rolledBack: "哪些回滚"
        case .platformUpgradesThisWeek: "平台升级"
        }
    }
}

public struct EvolutionPerceptionCall: Equatable, Sendable {
    public var method: String
    public var paramsJSON: String

    public init(method: String, paramsJSON: String) {
        self.method = method
        self.paramsJSON = paramsJSON
    }
}

public enum EvolutionPerceptionClientError: Error, Equatable {
    case forbiddenMethod(String)
    case undecodableParams
}

/// Builds the two read-only RPC bodies. Tenant stays on the trusted session.
public enum EvolutionPerceptionCalls {
    public static func query(
        intent: String,
        window: EvolutionPerceptionWindow,
        agentId: String?) throws -> EvolutionPerceptionCall
    {
        let body = QueryBody(intent: intent, window: window, agentId: Self.nonEmpty(agentId))
        return EvolutionPerceptionCall(
            method: EvolutionPerceptionMethod.query,
            paramsJSON: try Self.encode(body))
    }

    public static func project(
        operation: EvolutionPerceptionProjectOperation,
        window: EvolutionPerceptionWindow?,
        agentId: String?) throws -> EvolutionPerceptionCall
    {
        let body = ProjectBody(
            operation: operation.rawValue,
            window: window,
            agentId: Self.nonEmpty(agentId))
        return EvolutionPerceptionCall(
            method: EvolutionPerceptionMethod.project,
            paramsJSON: try Self.encode(body))
    }

    /// Default page load: the five projections, then the weekly-change query.
    /// The query intent stays `learned_this_week`; the chip title is 「本周变化」.
    public static func refreshPlan(
        window: EvolutionPerceptionWindow,
        agentId: String?) throws -> [EvolutionPerceptionCall]
    {
        try self.loadPlan(window: window, agentId: agentId) + [
            try self.query(
                intent: EvolutionPerceptionIntent.learnedThisWeek.rawValue,
                window: window,
                agentId: agentId),
        ]
    }

    /// Page load. Timeline / pending / observation are unwindowed projections.
    /// Digest and automatic stay inside the weekly window. No sightings.
    public static func loadPlan(
        window: EvolutionPerceptionWindow,
        agentId: String?) throws -> [EvolutionPerceptionCall]
    {
        [
            try self.project(operation: .timeline, window: nil, agentId: agentId),
            try self.project(operation: .digest, window: window, agentId: agentId),
            try self.project(operation: .pending, window: nil, agentId: agentId),
            try self.project(operation: .automatic, window: window, agentId: agentId),
            try self.project(operation: .observation, window: nil, agentId: agentId),
        ]
    }

    private static func nonEmpty(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private static func encode(_ value: some Encodable) throws -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        let data = try encoder.encode(value)
        guard let json = String(data: data, encoding: .utf8) else {
            throw EvolutionPerceptionClientError.undecodableParams
        }
        return json
    }
}

private struct QueryBody: Encodable {
    var intent: String
    var window: EvolutionPerceptionWindow
    var agentId: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.intent, forKey: .intent)
        try container.encode(self.window, forKey: .window)
        try container.encodeIfPresent(self.agentId, forKey: .agentId)
    }

    private enum CodingKeys: String, CodingKey {
        case intent
        case window
        case agentId
    }
}

private struct ProjectBody: Encodable {
    var operation: String
    var window: EvolutionPerceptionWindow?
    var agentId: String?

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(self.operation, forKey: .operation)
        try container.encodeIfPresent(self.window, forKey: .window)
        try container.encodeIfPresent(self.agentId, forKey: .agentId)
    }

    private enum CodingKeys: String, CodingKey {
        case operation
        case window
        case agentId
    }
}

public protocol EvolutionPerceptionTransport: Sendable {
    func performEvolutionPerception(method: String, paramsJSON: String) async throws -> Data
}

public enum EvolutionPerceptionPhase: Equatable, Sendable {
    case loading
    case denied
    case untrusted
    case failed(String)
    case loaded(EvolutionPerceptionPanels)
}

#if canImport(Observation)
@MainActor
@Observable
public final class EvolutionPerceptionModel {
    public private(set) var phase: EvolutionPerceptionPhase = .loading
    public private(set) var answer: EvolutionPerceptionQueryView?
    public private(set) var answerError: String?
    public private(set) var selectedIntent: EvolutionPerceptionIntent? = .learnedThisWeek
    public private(set) var selectedFact: EvolutionTimelineItem?
    public let window: EvolutionPerceptionWindow

    private let transport: any EvolutionPerceptionTransport
    private let agentId: String?

    public init(
        transport: any EvolutionPerceptionTransport,
        agentId: String? = nil,
        window: EvolutionPerceptionWindow = .trailingDays(7))
    {
        self.transport = transport
        self.agentId = agentId
        self.window = window
    }

    public var selectedFactDetail: EvolutionFactDetail? {
        self.selectedFact.map { EvolutionFactDetail.make(item: $0, window: self.window) }
    }

    /// Loads projections, then asks `learned_this_week` so 「本周变化」 is the hero.
    public func refresh() async {
        self.phase = .loading
        self.answer = nil
        self.answerError = nil
        self.selectedIntent = .learnedThisWeek
        self.selectedFact = nil
        do {
            let calls = try EvolutionPerceptionCalls.loadPlan(window: self.window, agentId: self.agentId)
            var slices: [EvolutionPerceptionProjectSlice] = []
            for call in calls {
                let data = try await self.perform(call)
                slices.append(EvolutionPerceptionMapping.acceptProject(data))
            }
            switch EvolutionPerceptionMapping.panels(from: slices) {
            case .denied:
                self.phase = .denied
            case .untrusted:
                self.phase = .untrusted
            case let .loaded(panels):
                self.phase = .loaded(panels)
            }
        } catch {
            self.phase = .failed(error.localizedDescription)
        }
        guard self.phase != .denied, self.phase != .untrusted else { return }
        await self.ask(.learnedThisWeek)
    }

    public func openFact(_ item: EvolutionTimelineItem) {
        guard !item.factIds.traceableIds.isEmpty else { return }
        self.selectedFact = item
    }

    public func closeFact() {
        self.selectedFact = nil
    }

    public func ask(_ intent: EvolutionPerceptionIntent) async {
        self.selectedIntent = intent
        self.answerError = nil
        do {
            let call = try EvolutionPerceptionCalls.query(
                intent: intent.rawValue,
                window: self.window,
                agentId: self.agentId)
            let data = try await self.perform(call)
            let view = EvolutionPerceptionMapping.acceptQuery(data)
            if view.state == .denied {
                self.phase = .denied
                self.answer = nil
                return
            }
            if view.state == .untrusted {
                self.phase = .untrusted
                self.answer = nil
                return
            }
            self.answer = view
        } catch {
            self.answer = nil
            self.answerError = error.localizedDescription
        }
    }

    private func perform(_ call: EvolutionPerceptionCall) async throws -> Data {
        guard EvolutionPerceptionMethod.isAllowed(call.method) else {
            throw EvolutionPerceptionClientError.forbiddenMethod(call.method)
        }
        return try await self.transport.performEvolutionPerception(method: call.method, paramsJSON: call.paramsJSON)
    }
}
#endif
