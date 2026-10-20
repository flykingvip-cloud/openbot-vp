import Foundation
import Testing
@testable import OpenBotKit

struct EvolutionPerceptionTests {
    @Test func mapsEightFieldsFromProjectionPayload() throws {
        let item = try #require(decodeOne(self.itemJSON(
            ledger: "evt-auto",
            proposal: "prop-auto",
            application: "app-auto",
            verification: "ver-auto",
            domain: "agent",
            target: #"{"domain":"agent","agentId":"agent-1"}"#,
            bucket: "automatic",
            execution: "automatic",
            result: "observing")))

        #expect(item.changeObject.domainDisplayName == "数字人")
        #expect(item.changeObject.surfaceId == "agent.working-dna")
        #expect(item.changeObject.target == .agent(agentId: "agent-1"))
        #expect(item.beforeAfter.summary == "1 → 2")
        #expect(item.beforeAfter.versionBefore == "1")
        #expect(item.beforeAfter.versionAfter == "2")
        #expect(item.reason.status == "specified")
        #expect(item.reason.sourceEvidenceRefs == ["ev-1"])
        #expect(item.reason.sourceMechanismRef == "mech-1")
        #expect(item.executionMode == "automatic")
        #expect(item.evidence.evidenceRefs == ["ev-1"])
        #expect(item.evidence.verificationId == "ver-auto")
        #expect(item.result == "observing")
        #expect(item.impactScope.label == "本人")
        #expect(item.reversible)
        #expect(item.factIds.traceableIds.contains("evt-auto"))
        #expect(item.proposalSchema == 2)
    }

    @Test func dropsRowsWithoutAFactId() throws {
        let blank = self.itemJSON(
            ledger: "   ",
            proposal: nil,
            application: nil,
            verification: nil,
            domain: "agent",
            target: #"{"domain":"agent","agentId":"agent-1"}"#,
            bucket: "pending",
            execution: "unknown",
            result: "pending")
        let kept = self.itemJSON(
            ledger: "",
            proposal: "prop-only",
            application: nil,
            verification: nil,
            domain: "knowledge",
            target: #"{"domain":"knowledge","assetId":"asset-1"}"#,
            bucket: "pending",
            execution: "unknown",
            result: "pending")
        let data = Data(self.projectJSON(operation: "timeline", items: "[\(blank),\(kept)]").utf8)
        let slice = EvolutionPerceptionMapping.acceptProject(data)
        #expect(slice.items.count == 1)
        #expect(slice.items.first?.factIds.proposalId == "prop-only")
        #expect(slice.items.allSatisfy { !$0.factIds.traceableIds.isEmpty })
    }

    @Test func emptyAndDeniedPayloadsDoNotInventRows() {
        let empty = Data(
            #"{"access":"read-only","operation":"query","persisted":false,"tenantScope":"t","intent":"learned_this_week","denial":null,"result":{"items":[],"bucketCounts":{"automatic":0,"user_approved":0,"pending":0,"observing":0,"rolled_back":0},"platformItems":[],"unresolvedIntents":[],"completeness":"empty"},"narration":null,"narrationGuard":null}"#
                .utf8)
        let view = EvolutionPerceptionMapping.acceptQuery(empty)
        #expect(view.state == .empty)
        #expect(view.items.isEmpty)
        #expect(view.platformItems.isEmpty)
        #expect(view.narration == .empty)
        #expect(!view.narration.learned.joined().contains("学会了"))

        let denied = Data(
            #"{"access":"read-only","operation":"query","persisted":false,"tenantScope":null,"intent":"automatic","denial":{"denied":true,"reason":"permission_denied"},"result":null,"narration":null,"narrationGuard":null}"#
                .utf8)
        let denial = EvolutionPerceptionMapping.acceptQuery(denied)
        #expect(denial.state == .denied)
        #expect(denial.items.isEmpty)
        #expect(denial.narration == .empty)
    }

    @Test func refusesPayloadsThatAreNotReadOnly() {
        let persisted = Data(
            #"{"access":"read-only","operation":"timeline","persisted":true,"projection":{"items":[]}}"#.utf8)
        #expect(EvolutionPerceptionMapping.acceptProject(persisted).state == .untrusted)
        let writable = Data(
            #"{"access":"read-write","operation":"timeline","persisted":false,"projection":{"items":[]}}"#.utf8)
        #expect(EvolutionPerceptionMapping.acceptProject(writable).state == .untrusted)
        let panels = EvolutionPerceptionMapping.panels(from: [
            EvolutionPerceptionMapping.acceptProject(persisted),
        ])
        #expect(panels == .untrusted)
    }

    @Test func systemDomainNeverEntersLearnedSet() throws {
        let human = self.itemJSON(
            ledger: "evt-human",
            domain: "agent",
            target: #"{"domain":"agent","agentId":"a1"}"#,
            bucket: "user_approved",
            execution: "user_confirmed",
            result: "verified_effective")
        let system = self.itemJSON(
            ledger: "evt-sys",
            domain: "system",
            target: #"{"domain":"system","componentId":"gateway"}"#,
            bucket: "user_approved",
            execution: "platform_release",
            result: "verified_effective",
            audience: "platform",
            displayName: "平台")
        let data = Data(self.projectJSON(
            operation: "timeline",
            items: "[\(human),\(system)]",
            learned: "[\(human),\(system)]").utf8)
        let slice = EvolutionPerceptionMapping.acceptProject(data)
        #expect(slice.items.count == 2)
        #expect(slice.learnedItems.map(\.factIds.ledgerEventId) == ["evt-human"])
        #expect(slice.learnedItems.allSatisfy { !$0.isSystemDomain })
        guard case let .loaded(panels) = EvolutionPerceptionMapping.panels(from: [slice]) else {
            Issue.record("expected loaded panels")
            return
        }
        #expect(panels.learned.map(\.factIds.ledgerEventId) == ["evt-human"])
        #expect(panels.timeline.contains { $0.factIds.ledgerEventId == "evt-sys" && $0.isSystemDomain })

        let queryPayload = """
        {"access":"read-only","operation":"query","persisted":false,"intent":"learned_this_week","denial":null,"result":{"items":[\(human),\(system)],"platformItems":[\(system)],"unresolvedIntents":[],"completeness":"complete"},"narration":{"learned":["数字人学会了可追溯变化 evt-sys。","数字人学会了可追溯变化 evt-human。"],"platform":["平台学会了 evt-sys。"],"other":[]},"narrationGuard":null}
        """
        let query = EvolutionPerceptionMapping.acceptQuery(Data(queryPayload.utf8))
        #expect(query.items.map(\.factIds.ledgerEventId) == ["evt-human"])
        #expect(query.platformItems.allSatisfy { $0.isSystemDomain })
        #expect(query.narration.learned == ["数字人学会了可追溯变化 evt-human。"])
        #expect(query.narration.platform.isEmpty)
    }

    @Test func partitionsSixBucketsAndRollbackComesFromRolledBack() throws {
        let specs: [(String, String, String, String)] = [
            ("evt-auto", "automatic", "automatic", "observing"),
            ("evt-user", "user_approved", "user_confirmed", "verified_effective"),
            ("evt-pend", "pending", "unknown", "pending"),
            ("evt-obs", "observing", "unknown", "observing"),
            ("evt-roll", "rolled_back", "user_confirmed", "rolled_back"),
        ]
        let rows = try specs.map { spec in
            try #require(decodeOne(self.itemJSON(
                ledger: spec.0,
                domain: "agent",
                target: #"{"domain":"agent","agentId":"a1"}"#,
                bucket: spec.1,
                execution: spec.2,
                result: spec.3)))
        }
        let system = try #require(decodeOne(self.itemJSON(
            ledger: "evt-sys",
            domain: "system",
            target: #"{"domain":"system","componentId":"gateway"}"#,
            bucket: "automatic",
            execution: "platform_release",
            result: "verified_effective",
            audience: "platform",
            displayName: "平台")))
        let timeline = EvolutionPerceptionProjectSlice(
            operation: "timeline",
            state: .ready,
            items: rows + [system],
            learnedItems: EvolutionPerceptionMapping.learnedItems(rows + [system]))
        guard case let .loaded(panels) = EvolutionPerceptionMapping.panels(from: [timeline]) else {
            Issue.record("expected loaded panels")
            return
        }
        #expect(Set(panels.timeline.compactMap(\.bucket)) == [
            "automatic", "user_approved", "pending", "observing", "rolled_back",
        ])
        #expect(panels.rollback.map(\.factIds.ledgerEventId) == ["evt-roll"])
        #expect(panels.learned.allSatisfy { !$0.isSystemDomain })
        #expect(!panels.learned.contains { $0.factIds.ledgerEventId == "evt-sys" })
    }

    @Test func automaticBudgetIsCopiedOnlyWhenPresent() throws {
        let item = self.itemJSON(
            ledger: "evt-auto",
            domain: "capability",
            target: #"{"domain":"capability","skillId":"skill-1"}"#,
            bucket: "automatic",
            execution: "automatic",
            result: "observing")
        let withBudget = """
        {"access":"read-only","operation":"automatic","persisted":false,"projection":{"access":"read-only","actions":[{"item":\(item),"budget":{"available":true,"surfaceId":"agent.working-dna","mode":"auto","maxApplications":2,"usedApplications":1,"remainingApplications":1,"expiresAt":"2026-10-01T00:00:00Z","killSwitch":false}}]}}
        """
        let action = try #require(EvolutionPerceptionMapping.acceptProject(Data(withBudget.utf8)).actions.first)
        guard case let .provided(surfaceId, mode, maxApplications, usedApplications, remaining, expires, kill) = action.budget else {
            Issue.record("expected provided budget")
            return
        }
        #expect(surfaceId == "agent.working-dna")
        #expect(mode == "auto")
        #expect(maxApplications == 2)
        #expect(usedApplications == 1)
        #expect(remaining == 1)
        #expect(expires == "2026-10-01T00:00:00Z")
        #expect(kill == false)

        let missing = """
        {"access":"read-only","operation":"automatic","persisted":false,"projection":{"access":"read-only","actions":[{"item":\(item),"budget":{"available":false,"surfaceId":"agent.working-dna"}}]}}
        """
        let closed = try #require(EvolutionPerceptionMapping.acceptProject(Data(missing.utf8)).actions.first)
        guard case let .unavailable(surfaceId) = closed.budget else {
            Issue.record("missing budget must stay unavailable")
            return
        }
        #expect(surfaceId == "agent.working-dna")
    }

    @Test func narrationWithoutFactIdIsDropped() throws {
        let human = try #require(decodeOne(self.itemJSON(ledger: "evt-human")))
        let system = try #require(decodeOne(self.itemJSON(
            ledger: "evt-sys",
            domain: "system",
            target: #"{"domain":"system","componentId":"gateway"}"#,
            audience: "platform",
            displayName: "平台")))
        let guarded = EvolutionPerceptionMapping.guardNarration(
            learned: [
                "数字人学会了可追溯变化 evt-human（数字人，已验证有效）。",
                "数字人学会了说话。",
                "数字人学会了可追溯变化 evt-sys。",
            ],
            platform: ["平台可追溯变化 evt-sys。", "平台学会了 evt-sys。"],
            other: ["本窗口没有可追溯的数字人变化。"],
            items: [human, system],
            narrationGuard: nil)
        #expect(guarded.learned == ["数字人学会了可追溯变化 evt-human（数字人，已验证有效）。"])
        #expect(guarded.platform == ["平台可追溯变化 evt-sys。"])
        #expect(guarded.other == ["本窗口没有可追溯的数字人变化。"])

        let blocked = EvolutionPerceptionMapping.guardNarration(
            learned: ["数字人学会了可追溯变化 evt-human。"],
            platform: [],
            other: [],
            items: [human],
            narrationGuard: "missing_fact_id")
        #expect(blocked == .empty)
    }

    @Test func weekChangeIsTheDefaultIntentAndEmptyCopyDoesNotClaimNothingLearned() throws {
        #expect(EvolutionPerceptionIntent.learnedThisWeek.rawValue == "learned_this_week")
        #expect(EvolutionPerceptionIntent.learnedThisWeek.title == "本周变化")
        #expect(EvolutionPerceptionIntent.learnedThisWeek.title == EvolutionPerceptionCopy.weekChangeTitle)
        #expect(EvolutionPerceptionIntent.toolbar.map(\.title) == ["本周变化", "相对上周"])
        let copies = [
            EvolutionPerceptionCopy.empty,
            EvolutionPerceptionCopy.denied,
            EvolutionPerceptionCopy.untrusted,
            EvolutionPerceptionCopy.readOnlyReminder,
        ]
        for copy in copies {
            #expect(!copy.contains("还没学会"))
            #expect(!copy.contains("学会了"))
        }
        #expect(EvolutionPerceptionCopy.empty == "暂无可投影的记录")
        let quietCopies = [
            EvolutionPerceptionCopy.successEmptyLead,
            EvolutionPerceptionCopy.successEmptyHint,
            EvolutionPerceptionCopy.successEmptySpanHint,
            EvolutionPerceptionCopy.successEmptyLastChangeUnknown,
            EvolutionPerceptionCopy.successEmptyRelativeNext,
            EvolutionPerceptionCopy.freshnessHint,
            EvolutionPerceptionCopy.lowSignalFact,
            EvolutionPerceptionCopy.foldedAutomatic,
            EvolutionPerceptionCopy.foldedApproved,
            EvolutionPerceptionCopy.foldedObserving,
            EvolutionPerceptionCopy.foldedRolledBack,
            EvolutionPerceptionCopy.foldedPlatform,
        ]
        for copy in quietCopies {
            #expect(!copy.contains("还没学会"))
            #expect(!copy.contains("学会了"))
        }

        let window = EvolutionPerceptionWindow(from: "2026-09-18T00:00:00Z", to: "2026-09-25T00:00:00Z")
        let plan = try EvolutionPerceptionCalls.refreshPlan(window: window, agentId: nil)
        #expect(plan.count == 6)
        #expect(plan.dropLast().allSatisfy { $0.method == EvolutionPerceptionMethod.project })
        #expect(plan.last?.method == EvolutionPerceptionMethod.query)
        #expect(plan.last?.paramsJSON.contains("\"intent\":\"learned_this_week\"") == true)
        #expect(plan.allSatisfy { EvolutionPerceptionMethod.isAllowed($0.method) })
        #expect(!plan.contains { $0.paramsJSON.contains("tenantScope") || $0.paramsJSON.contains("sightings") })
    }

    @Test func factDetailShowsTraceableIdsAndReasonEvidence() throws {
        let item = try #require(decodeOne(self.itemJSON(
            ledger: "evt-auto",
            proposal: "prop-auto",
            application: "app-auto",
            verification: "ver-auto",
            domain: "agent",
            target: #"{"domain":"agent","agentId":"agent-1"}"#,
            bucket: "automatic",
            execution: "automatic",
            result: "observing")))
        let window = EvolutionPerceptionWindow(from: "2026-09-18T00:00:00Z", to: "2026-09-25T00:00:00Z")
        let detail = EvolutionFactDetail.make(item: item, window: window)
        #expect(detail.isPlatform == false)
        #expect(detail.audienceLabel == "数字人")
        #expect(detail.value(labeled: "账本事件") == "evt-auto")
        #expect(detail.value(labeled: "提案") == "prop-auto")
        #expect(detail.value(labeled: "应用") == "app-auto")
        #expect(detail.value(labeled: "验证") == "ver-auto")
        #expect(detail.value(labeled: "领域") == "agent")
        #expect(detail.value(labeled: "受众") == "数字人")
        #expect(detail.value(labeled: "前版本") == "1")
        #expect(detail.value(labeled: "后版本") == "2")
        #expect(detail.value(labeled: "摘要") == "1 → 2")
        #expect(detail.value(labeled: "原因状态") == "specified")
        #expect(detail.value(labeled: "来源证据") == "ev-1")
        #expect(detail.value(labeled: "机制引用") == "mech-1")
        #expect(detail.value(labeled: "案例") == "case-1")
        #expect(detail.value(labeled: "发现") == "find-1")
        #expect(detail.value(labeled: "证据引用") == "ev-1")
        #expect(detail.value(labeled: "报告") == "rep-1")
        #expect(detail.value(labeled: "证据验证") == "ver-auto")
        #expect(detail.value(labeled: "执行") == "automatic")
        #expect(detail.value(labeled: "结果") == "observing")
        #expect(detail.value(labeled: "分桶") == "automatic")
        #expect(detail.value(labeled: "影响范围") == "本人")
        #expect(detail.value(labeled: "可逆") == "是")
        #expect(detail.value(labeled: "完整度") == "complete")
        #expect(detail.value(labeled: "窗口") == "2026-09-18T00:00:00Z – 2026-09-25T00:00:00Z")
        #expect(!detail.fields.contains { $0.value.contains("学会了") || $0.value.contains("还没学会") })
    }

    @Test func systemDetailIsLabeledPlatformAndStaysOutOfLearned() throws {
        let human = self.itemJSON(
            ledger: "evt-human",
            domain: "agent",
            target: #"{"domain":"agent","agentId":"a1"}"#,
            bucket: "user_approved",
            execution: "user_confirmed",
            result: "verified_effective")
        let systemJSON = self.itemJSON(
            ledger: "evt-sys",
            domain: "system",
            target: #"{"domain":"system","componentId":"gateway"}"#,
            bucket: "user_approved",
            execution: "platform_release",
            result: "verified_effective",
            audience: "platform",
            displayName: "平台")
        let data = Data(self.projectJSON(
            operation: "timeline",
            items: "[\(human),\(systemJSON)]",
            learned: "[\(human),\(systemJSON)]").utf8)
        let slice = EvolutionPerceptionMapping.acceptProject(data)
        #expect(slice.learnedItems.map(\.factIds.ledgerEventId) == ["evt-human"])
        #expect(!slice.learnedItems.contains { $0.isSystemDomain })

        let system = try #require(slice.items.first { $0.factIds.ledgerEventId == "evt-sys" })
        let detail = EvolutionFactDetail.make(item: system)
        #expect(detail.isPlatform)
        #expect(detail.audienceLabel == "平台")
        #expect(detail.value(labeled: "受众") == "平台")
        #expect(detail.value(labeled: "领域") == "system")
        #expect(detail.value(labeled: "账本事件") == "evt-sys")
        #expect(!detail.fields.contains { $0.label.contains("学会") || $0.value.contains("学会") })
    }

    @Test func callsStayOnTheTwoReadOnlyMethods() throws {
        let window = EvolutionPerceptionWindow(from: "2026-09-18T00:00:00Z", to: "2026-09-25T00:00:00Z")
        let query = try EvolutionPerceptionCalls.query(intent: "rolled_back", window: window, agentId: "agent-1")
        #expect(query.method == "evolution.perception.query")
        #expect(!query.paramsJSON.contains("tenantScope"))
        #expect(!query.paramsJSON.contains("sightings"))
        #expect(query.paramsJSON.contains("\"intent\":\"rolled_back\""))

        let plan = try EvolutionPerceptionCalls.loadPlan(window: window, agentId: nil)
        #expect(plan.allSatisfy { $0.method == "evolution.perception.project" })
        #expect(!plan.contains { $0.paramsJSON.contains("tenantScope") || $0.paramsJSON.contains("sightings") })
        let operations = Set(plan.map { paramsOperation($0.paramsJSON) })
        #expect(operations == ["timeline", "digest", "pending", "automatic", "observation"])
        #expect(EvolutionPerceptionMethod.isAllowed("evolution.ledger.append") == false)
        #expect(EvolutionPerceptionMethod.isAllowed("evolution.perception.query"))
        #expect(EvolutionPerceptionMethod.isAllowed("evolution.perception.project"))
    }

    #if canImport(Observation)
    @Test @MainActor func modelRefreshOnlyInvokesReadOnlyProjections() async throws {
        let log = CallLog()
        let model = EvolutionPerceptionModel(
            transport: ScriptedTransport(log: log),
            agentId: nil,
            window: EvolutionPerceptionWindow(from: "2026-09-18T00:00:00Z", to: "2026-09-25T00:00:00Z"))
        await model.refresh()
        let calls = log.snapshot()
        #expect(calls.filter { $0.0 == EvolutionPerceptionMethod.project }.count == 5)
        #expect(calls.last?.0 == EvolutionPerceptionMethod.query)
        #expect(calls.last?.1.contains("\"intent\":\"learned_this_week\"") == true)
        #expect(calls.allSatisfy { EvolutionPerceptionMethod.isAllowed($0.0) })
        #expect(model.selectedIntent == .learnedThisWeek)
        if case let .loaded(panels) = model.phase {
            #expect(panels.learned.isEmpty)
            #expect(panels.timeline.isEmpty)
        } else {
            Issue.record("expected an empty loaded projection")
        }
        if let answer = model.answer {
            #expect(answer.state == .empty)
            #expect(answer.intent == "learned_this_week")
            #expect(answer.items.isEmpty)
            #expect(!answer.narration.learned.joined().contains("学会了"))
            #expect(!answer.narration.learned.joined().contains("还没学会"))
        } else {
            Issue.record("refresh should ask the week-change query")
        }

        let item = try #require(decodeOne(self.itemJSON(
            ledger: "evt-auto",
            proposal: "prop-auto",
            application: "app-auto",
            verification: "ver-auto")))
        model.openFact(item)
        let detail = try #require(model.selectedFactDetail)
        #expect(detail.value(labeled: "账本事件") == "evt-auto")
        #expect(detail.value(labeled: "原因状态") == "specified")
        #expect(detail.value(labeled: "来源证据") == "ev-1")
        #expect(detail.value(labeled: "证据引用") == "ev-1")
        model.closeFact()
        #expect(model.selectedFact == nil)
    }
    #endif

    @Test func emptyWeekStaysHealthyAndSparseRowsDropPlaceholders() {
        let window = EvolutionPerceptionWindow(
            from: "2026-09-18T00:00:00.000Z",
            to: "2026-09-25T00:00:00.000Z")
        #expect(
            EvolutionPerceptionDisplay.successEmptyLead(window)
                == "这一周（2026-09-18 — 09-25）没有新的数字人变化。")
        #expect(EvolutionPerceptionDisplay.successEmptyHint(window).contains("这 7 天"))
        #expect(EvolutionPerceptionDisplay.freshness(window).contains("查询截至 2026-09-25 00:00 UTC"))
        #expect(EvolutionPerceptionDisplay.freshness(window).contains("刷新是手动的"))
        #expect(EvolutionPerceptionDisplay.lastChangeCopy(relativeCount: 0) == EvolutionPerceptionCopy.successEmptyLastChangeUnknown)
        #expect(EvolutionPerceptionDisplay.lastChangeCopy(relativeCount: 1).contains("相对上周有 1 条"))
        #expect(EvolutionPerceptionDisplay.windowLabel(window) == "2026-09-18 – 09-25")

        let sparse = EvolutionTimelineItem(
            schemaVersion: 1,
            proposalSchema: 2,
            legacy: false,
            factIds: EvolutionFactIds(ledgerEventId: "evt-sparse", proposalId: "prop-sparse"),
            audience: "digital_human",
            changeObject: EvolutionChangeObject(
                target: .capability(skillId: "skill-1"),
                surfaceId: "capability.skill-installation",
                domain: "capability",
                domainDisplayName: "能力"),
            beforeAfter: EvolutionBeforeAfter(versionBefore: nil, versionAfter: nil, summary: "unavailable"),
            reason: EvolutionReason(
                status: "specified",
                sourceEvidenceRefs: [],
                sourceMechanismRef: nil,
                caseId: nil,
                findingIds: []),
            executionMode: "unknown",
            evidence: EvolutionEvidence(evidenceRefs: [], reportId: nil, verificationId: nil),
            result: "unspecified",
            bucket: nil,
            impactScope: EvolutionImpactScope(confidentialityScope: nil, tenantScope: nil, label: "企业"),
            reversible: true,
            completeness: "partial")
        let presentation = EvolutionPerceptionDisplay.present(sparse)
        #expect(presentation.signal == .sparse)
        #expect(presentation.title == "能力")
        #expect(presentation.story == "技能安装 · 影响企业 · 已说明 · 可逆")
        #expect(!presentation.story.contains("未知"))
        #expect(!presentation.story.contains("前后版本不可用"))

        let hollow = EvolutionTimelineItem(
            schemaVersion: 1,
            proposalSchema: 2,
            legacy: false,
            factIds: EvolutionFactIds(ledgerEventId: "evt-hollow"),
            audience: "digital_human",
            changeObject: EvolutionChangeObject(
                target: .capability(skillId: "skill-2"),
                surfaceId: "",
                domain: "capability",
                domainDisplayName: "能力"),
            beforeAfter: EvolutionBeforeAfter(versionBefore: nil, versionAfter: nil, summary: "unavailable"),
            reason: EvolutionReason(
                status: "unspecified",
                sourceEvidenceRefs: [],
                sourceMechanismRef: nil,
                caseId: nil,
                findingIds: []),
            executionMode: "unknown",
            evidence: EvolutionEvidence(evidenceRefs: [], reportId: nil, verificationId: nil),
            result: "unspecified",
            bucket: nil,
            impactScope: EvolutionImpactScope(confidentialityScope: nil, tenantScope: nil, label: "unspecified"),
            reversible: true,
            completeness: "partial")
        #expect(EvolutionPerceptionDisplay.present(hollow).signal == .none)
        let panels = EvolutionPerceptionPanels(
            timeline: [sparse, hollow],
            learned: [sparse, hollow])
        #expect(EvolutionPerceptionDisplay.visibleGroups(panels).map(\.id) == ["learned"])
        #expect(EvolutionPerceptionDisplay.visibleCount(panels) == 1)

        let auto = EvolutionTimelineItem(
            schemaVersion: sparse.schemaVersion,
            proposalSchema: sparse.proposalSchema,
            legacy: sparse.legacy,
            factIds: EvolutionFactIds(ledgerEventId: "evt-auto"),
            audience: sparse.audience,
            changeObject: sparse.changeObject,
            beforeAfter: EvolutionBeforeAfter(versionBefore: "1", versionAfter: "2", summary: "1 → 2"),
            reason: sparse.reason,
            executionMode: "automatic",
            evidence: sparse.evidence,
            result: "observing",
            bucket: "automatic",
            impactScope: sparse.impactScope,
            reversible: true,
            completeness: "complete")
        let automaticPanels = EvolutionPerceptionPanels(
            automatic: [EvolutionAutomaticAction(item: auto, budget: .unavailable(surfaceId: "capability.skill-installation")),
                        EvolutionAutomaticAction(item: hollow, budget: .unavailable(surfaceId: ""))])
        #expect(EvolutionPerceptionDisplay.foldedNotes(automaticPanels, shown: []) == [
            "有自动执行的变化：\(EvolutionPerceptionDisplay.present(auto).story)。",
        ])
        #expect(EvolutionPerceptionDisplay.foldedNotes(automaticPanels, shown: [auto]).isEmpty)
        #expect(EvolutionPerceptionDisplay.foldedNotes(
            EvolutionPerceptionPanels(automatic: [
                EvolutionAutomaticAction(item: hollow, budget: .unavailable(surfaceId: "")),
            ]),
            shown: []).isEmpty)
    }

    private func itemJSON(
        ledger: String,
        proposal: String? = "prop-1",
        application: String? = "app-1",
        verification: String? = nil,
        domain: String = "agent",
        target: String = #"{"domain":"agent","agentId":"a1"}"#,
        bucket: String? = "user_approved",
        execution: String = "user_confirmed",
        result: String = "verified_effective",
        audience: String? = nil,
        displayName: String? = nil) -> String
    {
        let resolvedAudience = audience ?? (domain == "system" ? "platform" : "digital_human")
        let resolvedDisplay = displayName ?? (domain == "system" ? "平台" : "数字人")
        return """
        {"schemaVersion":1,"proposalSchema":2,"legacy":false,"factIds":{"ledgerEventId":"\(ledger)","proposalId":\(self.json(proposal)),"applicationId":\(self.json(application)),"verificationId":\(self.json(verification))},"audience":"\(resolvedAudience)","changeObject":{"target":\(target),"surfaceId":"agent.working-dna","domain":"\(domain)","domainDisplayName":"\(resolvedDisplay)"},"beforeAfter":{"versionBefore":"1","versionAfter":"2","summary":"1 → 2"},"reason":{"status":"specified","sourceEvidenceRefs":["ev-1"],"sourceMechanismRef":"mech-1","caseId":"case-1","findingIds":["find-1"]},"executionMode":"\(execution)","evidence":{"evidenceRefs":["ev-1"],"reportId":"rep-1","verificationId":\(self.json(verification))},"result":"\(result)","bucket":\(self.json(bucket)),"impactScope":{"confidentialityScope":"personal","tenantScope":"tenant-a","label":"本人"},"reversible":true,"completeness":"complete"}
        """
    }

    private func projectJSON(operation: String, items: String, learned: String? = nil) -> String {
        let learnedJSON = learned ?? items
        return """
        {"access":"read-only","operation":"\(operation)","persisted":false,"projection":{"access":"read-only","items":\(items),"learnedItems":\(learnedJSON),"exclusions":[]}}
        """
    }

    private func json(_ value: String?) -> String {
        guard let value else { return "null" }
        return "\"\(value)\""
    }
}

private func decodeOne(_ json: String) -> EvolutionTimelineItem? {
    let payload = """
    {"access":"read-only","operation":"timeline","persisted":false,"projection":{"items":[\(json)]}}
    """
    return EvolutionPerceptionMapping.acceptProject(Data(payload.utf8)).items.first
}

private func paramsOperation(_ paramsJSON: String) -> String {
    guard let data = paramsJSON.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let operation = object["operation"] as? String
    else {
        return ""
    }
    return operation
}

#if canImport(Observation)
private final class CallLog: @unchecked Sendable {
    private let lock = NSLock()
    private var calls: [(String, String)] = []

    func add(method: String, params: String) {
        self.lock.lock()
        self.calls.append((method, params))
        self.lock.unlock()
    }

    func snapshot() -> [(String, String)] {
        self.lock.lock()
        defer { self.lock.unlock() }
        return self.calls
    }
}

private struct ScriptedTransport: EvolutionPerceptionTransport {
    let log: CallLog

    func performEvolutionPerception(method: String, paramsJSON: String) async throws -> Data {
        self.log.add(method: method, params: paramsJSON)
        if method == EvolutionPerceptionMethod.query {
            let payload = """
            {"access":"read-only","operation":"query","persisted":false,"tenantScope":"t","intent":"learned_this_week","denial":null,"result":{"items":[],"platformItems":[],"unresolvedIntents":[],"completeness":"empty"},"narration":null,"narrationGuard":null}
            """
            return Data(payload.utf8)
        }
        let operation = paramsOperation(paramsJSON)
        let payload = """
        {"access":"read-only","operation":"\(operation)","persisted":false,"projection":{"access":"read-only","items":[],"learnedItems":[],"actions":[],"digitalHumanItems":[],"platformItems":[],"completeness":"empty"}}
        """
        return Data(payload.utf8)
    }
}
#endif
