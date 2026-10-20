import OpenBotChatUI
import SwiftUI

/// Flat source picker for the knowledge capsule. Not the full Web expand/check tree.
struct ChatKnowledgePickerSheet: View {
    @Bindable var viewModel: OpenBotChatViewModel
    let catalog: [ChatKnowledgeCatalogItem]
    let loading: Bool
    let note: String?

    @State private var query = ""

    var body: some View {
        NavigationStack {
            List {
                if self.loading {
                    ProgressView("正在读取知识目录")
                }
                if let note, !note.isEmpty, self.catalog.isEmpty, !self.loading {
                    Text(note)
                        .font(OpenBotMobileTokens.callout())
                        .foregroundStyle(OpenBotMobileTokens.textSecondary)
                }
                ForEach(self.filtered) { item in
                    Button {
                        self.viewModel.toggleContextSource(
                            OpenBotChatContextSourceSelection(
                                type: item.type,
                                sourceID: item.sourceID,
                                label: item.label,
                                parentId: item.parentId))
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.label)
                                    .foregroundStyle(OpenBotMobileTokens.text)
                                Text(self.kindLabel(item.type))
                                    .font(OpenBotMobileTokens.caption2())
                                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
                            }
                            Spacer()
                            if self.viewModel.contextSourceSelections.contains(where: { $0.id == item.id }) {
                                Image(systemName: "checkmark")
                                    .foregroundStyle(OpenBotMobileTokens.accent)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                }
            }
            .navigationTitle("上下文来源")
            .searchable(text: self.$query, prompt: "搜索知识库")
        }
    }

    private var filtered: [ChatKnowledgeCatalogItem] {
        let trimmed = self.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return self.catalog }
        return self.catalog.filter { $0.label.localizedCaseInsensitiveContains(trimmed) }
    }

    private func kindLabel(_ type: String) -> String {
        switch type {
        case "knowledge": "知识库"
        case "file": "文件"
        case "folder": "文件夹"
        case "api": "接口"
        default: type
        }
    }
}
