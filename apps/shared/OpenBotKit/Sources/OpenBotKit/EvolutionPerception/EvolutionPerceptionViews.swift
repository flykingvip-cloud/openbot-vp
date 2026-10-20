#if canImport(SwiftUI)
import SwiftUI

public struct EvolutionPerceptionScreen: View {
    @Bindable var model: EvolutionPerceptionModel
    @State private var showMoreProjections = false

    public init(model: EvolutionPerceptionModel) {
        self.model = model
    }

    public var body: some View {
        let selectedFact = self.model.selectedFact
        return ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                self.header
                self.intentChips
                self.hero
                if case let .loaded(panels) = self.model.phase {
                    DisclosureGroup(isExpanded: self.$showMoreProjections) {
                        self.projectionPanels(panels)
                    } label: {
                        Text(EvolutionPerceptionCopy.moreProjections)
                            .font(.headline)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.vertical, 4)
        }
        .sheet(item: Binding(
            get: { selectedFact },
            set: { item in
                if let item {
                    self.model.openFact(item)
                } else {
                    self.model.closeFact()
                }
            })) { item in
            EvolutionFactDetailView(detail: EvolutionFactDetail.make(item: item, window: self.model.window))
        }
        .task { await self.model.refresh() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("进化")
                .font(.title2.weight(.semibold))
            Text(EvolutionPerceptionCopy.readOnlyReminder)
                .font(.callout)
                .foregroundStyle(.secondary)
            Text(EvolutionPerceptionDisplay.windowLabel(self.model.window))
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .accessibilityLabel(EvolutionPerceptionDisplay.windowPrecision(self.model.window))
            Text(EvolutionPerceptionDisplay.freshness(self.model.window))
                .font(.caption)
                .foregroundStyle(.secondary)
            Button("刷新") {
                Task { await self.model.refresh() }
            }
            .buttonStyle(.bordered)
        }
    }

    private var intentChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(EvolutionPerceptionIntent.toolbar) { intent in
                    let suggested = intent == .diffFromLastWeek && self.suggestRelativeWeek
                    Button(intent.title) {
                        Task { await self.model.ask(intent) }
                    }
                    .buttonStyle(.bordered)
                    .tint(
                        self.model.selectedIntent == intent || suggested
                            ? Color.accentColor
                            : Color.secondary)
                }
            }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.model.selectedIntent?.title ?? EvolutionPerceptionCopy.weekChangeTitle)
                .font(.headline)
            if let answer = self.model.answer {
                self.answerBody(answer)
            } else if let answerError = self.model.answerError {
                self.notice(answerError)
            } else {
                switch self.model.phase {
                case .loading:
                    ProgressView("读取本周变化")
                case .denied:
                    self.notice(EvolutionPerceptionCopy.denied)
                case .untrusted:
                    self.notice(EvolutionPerceptionCopy.untrusted)
                case let .failed(message):
                    self.notice(message)
                case .loaded:
                    self.emptyWeek
                }
            }
        }
    }

    @ViewBuilder
    private func answerBody(_ answer: EvolutionPerceptionQueryView) -> some View {
        switch answer.state {
        case .denied:
            self.notice(EvolutionPerceptionCopy.denied)
        case .untrusted:
            self.notice(EvolutionPerceptionCopy.untrusted)
        case .empty, .ready:
            if !answer.unresolvedIntents.isEmpty {
                Text("未识别意图：\(answer.unresolvedIntents.joined(separator: "、"))")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
            self.narrationBlock("数字人叙述", lines: answer.narration.learned)
            if !answer.items.isEmpty {
                self.factList(EvolutionPerceptionCopy.digitalHumanSection, note: nil, items: answer.items)
            }
            if !answer.platformItems.isEmpty {
                self.factList(EvolutionPerceptionCopy.platformSection, note: nil, items: answer.platformItems)
            }
            self.narrationBlock("平台叙述", lines: answer.narration.platform)
            self.narrationBlock("其他", lines: answer.narration.other)
            if answer.items.isEmpty, answer.platformItems.isEmpty, answer.narration == .empty {
                self.emptyWeek
            } else {
                self.foldedNotes(shown: answer.items + answer.platformItems)
            }
        }
    }

    private func projectionPanels(_ panels: EvolutionPerceptionPanels) -> some View {
        let groups = EvolutionPerceptionDisplay.visibleGroups(panels)
        return VStack(alignment: .leading, spacing: 22) {
            if groups.isEmpty {
                self.notice(EvolutionPerceptionCopy.projectionsEmpty)
            } else {
                ForEach(groups) { group in
                    if group.id == "automatic" {
                        self.automaticSection(group.actions)
                    } else {
                        self.factList(group.title, note: nil, items: group.items)
                    }
                }
            }
        }
        .padding(.top, 8)
    }

    private var suggestRelativeWeek: Bool {
        guard case let .loaded(panels) = self.model.phase else { return false }
        guard !panels.timeline.isEmpty else { return false }
        if let answer = self.model.answer, answer.intent == EvolutionPerceptionIntent.learnedThisWeek.rawValue {
            return answer.items.isEmpty
        }
        return panels.learned.allSatisfy { $0.result != "verified_effective" }
    }

    private var relativeCount: Int {
        guard case let .loaded(panels) = self.model.phase else { return 0 }
        return panels.timeline.count
    }

    private var emptyWeek: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(EvolutionPerceptionCopy.learnedNarration)
                .font(.subheadline.weight(.semibold))
            Text(EvolutionPerceptionDisplay.successEmptyLead(self.model.window))
                .font(.callout)
            Text(EvolutionPerceptionDisplay.successEmptyHint(self.model.window))
                .font(.callout)
                .foregroundStyle(.secondary)
            Text(EvolutionPerceptionDisplay.lastChangeCopy(relativeCount: self.relativeCount))
                .font(.callout)
                .foregroundStyle(.secondary)
            self.foldedNotes(shown: [])
            HStack(spacing: 8) {
                if self.suggestRelativeWeek {
                    Button(EvolutionPerceptionCopy.ctaViewDiff) {
                        Task { await self.model.ask(.diffFromLastWeek) }
                    }
                    .buttonStyle(.borderedProminent)
                } else {
                    Button(EvolutionPerceptionCopy.ctaViewDiff) {
                        Task { await self.model.ask(.diffFromLastWeek) }
                    }
                    .buttonStyle(.bordered)
                }
                Button(EvolutionPerceptionCopy.ctaExpandProjections) {
                    self.showMoreProjections = true
                }
                .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func foldedNotes(shown: [EvolutionTimelineItem]) -> some View {
        if case let .loaded(panels) = self.model.phase {
            let notes = EvolutionPerceptionDisplay.foldedNotes(panels, shown: shown)
            if !notes.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(notes.enumerated()), id: \.offset) { _, note in
                        Text(note)
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func narrationBlock(_ title: String, lines: [String]) -> some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                ForEach(Array(lines.enumerated()), id: \.offset) { _, line in
                    Text(line)
                        .font(.callout)
                        .textSelection(.enabled)
                }
            }
        }
    }

    private func factList(_ title: String, note: String?, items: [EvolutionTimelineItem]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(title)
                .font(.headline)
            if let note {
                Text(note)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            if items.isEmpty {
                EmptyView()
            } else {
                ForEach(items) { item in
                    self.factButton(item)
                    Divider()
                }
            }
        }
    }

    private func automaticSection(_ actions: [EvolutionAutomaticAction]) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("自动动作")
                .font(.headline)
            if actions.isEmpty {
                EmptyView()
            } else {
                ForEach(actions, id: \.item.id) { action in
                    self.factButton(action.item)
                    if case .provided = action.budget {
                        EvolutionBudgetRows(budget: action.budget)
                    }
                    Divider()
                }
            }
        }
    }

    private func factButton(_ item: EvolutionTimelineItem) -> some View {
        Button {
            self.model.openFact(item)
        } label: {
            EvolutionFactRow(item: item)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .buttonStyle(.plain)
    }

    private func notice(_ text: String) -> some View {
        Text(text)
            .font(.callout)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct EvolutionFactRow: View {
    let item: EvolutionTimelineItem

    var body: some View {
        let presentation = EvolutionPerceptionDisplay.present(self.item)
        let story = presentation.signal == .none
            ? EvolutionPerceptionCopy.lowSignalFact
            : presentation.story
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text(presentation.title)
                    .font(.body.weight(.semibold))
                if self.item.isSystemDomain {
                    Text(EvolutionPerceptionCopy.platformBadge)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Text(story)
                .font(.callout)
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
        }
        .padding(.vertical, 2)
        .contentShape(Rectangle())
    }
}

/// Read-only provenance sheet. No approve, apply, or enable controls.
public struct EvolutionFactDetailView: View {
    public let detail: EvolutionFactDetail

    public init(detail: EvolutionFactDetail) {
        self.detail = detail
    }

    public var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                Text("溯源")
                    .font(.title2.weight(.semibold))
                Text(EvolutionPerceptionCopy.readOnlyReminder)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Text(self.detail.audienceLabel)
                    .font(.subheadline.weight(.semibold))
                ForEach(Array(self.detail.fields.enumerated()), id: \.offset) { _, field in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(field.label)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .frame(width: 72, alignment: .leading)
                        Text(field.value)
                            .font(.callout.monospaced())
                            .textSelection(.enabled)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
        }
    }
}

struct EvolutionBudgetRows: View {
    let budget: EvolutionAutonomyBudget

    var body: some View {
        switch self.budget {
        case let .unavailable(surfaceId):
            Text("自治预算未随投影提供（\(surfaceId)）")
                .font(.caption)
                .foregroundStyle(.secondary)
        case let .provided(
            surfaceId,
            mode,
            maxApplications,
            usedApplications,
            remainingApplications,
            expiresAt,
            killSwitch):
            VStack(alignment: .leading, spacing: 2) {
                self.line("表面", surfaceId)
                self.line("模式", mode)
                self.line("预算", "\(usedApplications)/\(maxApplications)，剩余 \(remainingApplications)")
                self.line("到期", expiresAt ?? "未提供")
                if let killSwitch {
                    self.line("Kill switch", killSwitch ? "开启" : "关闭")
                } else {
                    self.line("Kill switch", "未提供")
                }
            }
            .font(.caption.monospaced())
        }
    }

    private func line(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .foregroundStyle(.secondary)
            Text(value)
                .textSelection(.enabled)
        }
    }
}
#endif
