import OpenBotKit
import SwiftUI

/// Knowledge tab: title「我的知识库」above search, catalog tree, fullscreen doc.
/// Same Gateway methods as Android `MobileKnowledgeScreen` and the chat capsule.
/// No create / rename / ⋯ write menus (calibrated ignore). Not a WebView tab.
struct KnowledgeTabView: View {
    private let gateway: GatewayNodeSession

    @State private var query = ""
    @State private var catalog: [ChatKnowledgeCatalogItem] = []
    @State private var catalogPhase: KnowledgeCatalogPhase = .loading
    @State private var expandedKeys: Set<String> = []
    @State private var didSeedExpand = false
    @State private var searchHits: [KnowledgeSearchHit] = []
    @State private var searchBusy = false
    @State private var openDoc: KnowledgeOpenDocument?
    @State private var docBody: KnowledgeDocumentBody = .loading
    @State private var favoriteIDs: [String] = []
    @State private var gatewayReady = false

    init(gateway: GatewayNodeSession) {
        self.gateway = gateway
    }

    var body: some View {
        ZStack {
            self.browser
            if let doc = self.openDoc {
                KnowledgeDocumentScreen(title: doc.item.label, bodyState: self.docBody) {
                    self.openDoc = nil
                    self.docBody = .loading
                }
            }
        }
        .task {
            self.favoriteIDs = KnowledgeFavoriteStore.read()
            await self.reloadCatalog()
        }
        .task(id: self.searchToken) {
            await self.runSearch()
        }
        .task(id: self.openDoc?.id) {
            await self.loadPreview()
        }
    }

    private var searchToken: String {
        "\(self.gatewayReady)#\(self.query)"
    }

    private var filteredTree: KnowledgeFilteredTree {
        filterKnowledgeCatalogTree(buildKnowledgeCatalogTree(self.catalog), query: self.query)
    }

    private var visibleExpanded: Set<String> {
        self.expandedKeys.union(self.filteredTree.expandedKeys)
    }

    private var favoriteItems: [ChatKnowledgeCatalogItem] {
        let ids = Set(self.favoriteIDs)
        return self.catalog.filter { $0.type == "knowledge" && ids.contains($0.sourceID) }
    }

    private var browser: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                ModuleTitle(title: "我的知识库")
                KnowledgeSearchField(query: self.$query)
                self.catalogBody
            }
            .padding(.horizontal, OpenBotMobileTokens.pageGutter)
            .padding(.vertical, OpenBotMobileTokens.pageVertical)
        }
    }

    @ViewBuilder
    private var catalogBody: some View {
        switch self.catalogPhase {
        case .loading:
            KnowledgeStatusRow(text: "正在读取知识目录…", showsSpinner: true)
        case .offline:
            KnowledgeStatusRow(
                text: "未连接网关。连接后加载与 Chat「知识库」相同的个人/团队/企业目录。",
                showsSpinner: false)
            KnowledgeSectionHeader(label: "收藏", count: 0)
            KnowledgeSectionHeader(label: "个人空间", count: 0)
            KnowledgeSectionHeader(label: "团队空间", count: 0)
            KnowledgeSectionHeader(label: "企业空间", count: 0)
        case .empty:
            KnowledgeStatusRow(
                text: "暂无知识库（需 Gateway 返回 knowledge.base.list / context.scope 目录）",
                showsSpinner: false)
        case let .failed(message):
            KnowledgeStatusRow(text: "加载失败：\(message)", showsSpinner: false)
        case .ready:
            self.readyList
        }
    }

    private var readyList: some View {
        let tree = self.filteredTree
        let trimmed = self.query.trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(alignment: .leading, spacing: 2) {
            if trimmed.isEmpty {
                self.favoritesSection
            }
            if trimmed.count >= 2 {
                self.searchSection
            }
            if tree.groups.isEmpty {
                KnowledgeStatusRow(text: "无匹配结果", showsSpinner: false)
            } else {
                ForEach(tree.groups) { group in
                    KnowledgeSectionHeader(
                        label: knowledgeBrowserSectionLabel(group.id),
                        count: group.nodes.count)
                    ForEach(flattenKnowledgeCatalogNodes(group.nodes, expandedKeys: self.visibleExpanded)) { row in
                        self.browseRow(row)
                    }
                }
            }
        }
    }

    private var favoritesSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            KnowledgeSectionHeader(label: "收藏", count: self.favoriteItems.count)
            if self.favoriteItems.isEmpty {
                Text("长按知识库可加入收藏（对齐 Web localStorage favorites）。")
                    .font(OpenBotMobileTokens.caption1())
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
            } else {
                ForEach(self.favoriteItems) { item in
                    KnowledgeBrowseRow(
                        node: KnowledgeCatalogNode(item: item, children: []),
                        depth: 0,
                        expanded: false,
                        favoriteAction: self.favoriteAction(for: item),
                        onToggle: {},
                        onOpen: { self.toggleExpand(item) })
                }
            }
        }
    }

    private var searchSection: some View {
        VStack(alignment: .leading, spacing: 2) {
            KnowledgeSectionHeader(label: "搜索结果", count: self.searchHits.count)
            if self.searchBusy {
                KnowledgeStatusRow(text: "正在 knowledge.search…", showsSpinner: false)
            } else if self.searchHits.isEmpty {
                Text("无服务端搜索命中（仍显示下方目录过滤）。")
                    .font(OpenBotMobileTokens.caption1())
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
            } else {
                ForEach(self.searchHits) { hit in
                    Button {
                        self.openSearchHit(hit)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(hit.title)
                                .font(OpenBotMobileTokens.callout(.semibold))
                                .foregroundStyle(OpenBotMobileTokens.text)
                                .lineLimit(1)
                            if !hit.summary.isEmpty {
                                Text(hit.summary)
                                    .font(OpenBotMobileTokens.caption1())
                                    .foregroundStyle(OpenBotMobileTokens.textSecondary)
                                    .lineLimit(2)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 6)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func browseRow(_ row: KnowledgeFlatNode) -> some View {
        let item = row.node.item
        return KnowledgeBrowseRow(
            node: row.node,
            depth: row.depth,
            expanded: self.visibleExpanded.contains(item.id),
            favoriteAction: self.favoriteAction(for: item),
            onToggle: { self.toggleExpand(item) },
            onOpen: { self.openOrToggle(item) })
    }

    private func favoriteAction(for item: ChatKnowledgeCatalogItem) -> (() -> Void)? {
        guard item.type == "knowledge" else { return nil }
        return { self.toggleFavorite(item.sourceID) }
    }

    private func toggleExpand(_ item: ChatKnowledgeCatalogItem) {
        if self.expandedKeys.contains(item.id) {
            self.expandedKeys.remove(item.id)
        } else {
            self.expandedKeys.insert(item.id)
        }
    }

    private func openOrToggle(_ item: ChatKnowledgeCatalogItem) {
        switch item.type {
        case "file":
            self.openFile(item)
        case "folder", "knowledge":
            self.toggleExpand(item)
        default:
            break
        }
    }

    private func openFile(_ item: ChatKnowledgeCatalogItem) {
        self.docBody = .loading
        self.openDoc = KnowledgeOpenDocument(
            item: item,
            knowledgeBaseId: resolveKnowledgeBaseID(item, catalog: self.catalog))
    }

    private func openSearchHit(_ hit: KnowledgeSearchHit) {
        let item = ChatKnowledgeCatalogItem(
            type: "file",
            sourceID: hit.id,
            label: hit.title,
            parentId: hit.knowledgeBaseId,
            visibility: nil)
        self.docBody = .loading
        self.openDoc = KnowledgeOpenDocument(item: item, knowledgeBaseId: hit.knowledgeBaseId)
    }

    private func toggleFavorite(_ kbID: String) {
        self.favoriteIDs = toggleKnowledgeFavoriteIDs(self.favoriteIDs, kbID: kbID)
        KnowledgeFavoriteStore.write(self.favoriteIDs)
    }

    private func reloadCatalog() async {
        self.catalogPhase = .loading
        if let parsed = await self.requestScope(), !parsed.isEmpty {
            self.apply(parsed)
            return
        }
        do {
            let basesData = try await self.gateway.request(
                method: "knowledge.base.list",
                paramsJSON: "{}",
                timeoutSeconds: 15)
            let basesText = String(data: basesData, encoding: .utf8) ?? ""
            let bases = ChatKnowledgeCatalogParser.parseKnowledgeBaseList(basesText)
            if bases.isEmpty {
                self.apply([])
                return
            }
            var nested: [ChatKnowledgeCatalogItem] = []
            for base in bases {
                let data = try await self.gateway.request(
                    method: "knowledge.base.sources.list",
                    paramsJSON: Self.sourcesParams(base.sourceID),
                    timeoutSeconds: 15)
                let text = String(data: data, encoding: .utf8) ?? ""
                nested.append(contentsOf: ChatKnowledgeCatalogParser.parseKnowledgeBaseSources(
                    parentID: base.sourceID,
                    raw: text,
                    parentVisibility: base.visibility))
            }
            self.apply(bases + nested)
        } catch {
            if Task.isCancelled {
                return
            }
            self.catalog = []
            if Self.isOffline(error) {
                self.gatewayReady = false
                self.catalogPhase = .offline
            } else {
                self.gatewayReady = true
                self.catalogPhase = .failed(Self.clipped(error))
            }
        }
    }

    private func requestScope() async -> [ChatKnowledgeCatalogItem]? {
        guard let data = try? await self.gateway.request(
            method: "context.scope.sources.catalog",
            paramsJSON: "{}",
            timeoutSeconds: 15),
            let text = String(data: data, encoding: .utf8)
        else { return nil }
        return ChatKnowledgeCatalogParser.parseContextScopeCatalog(text)
    }

    private func apply(_ items: [ChatKnowledgeCatalogItem]) {
        self.gatewayReady = true
        self.catalog = items
        if !self.didSeedExpand {
            self.expandedKeys = knowledgeDefaultExpandedKeys(items)
            self.didSeedExpand = true
        }
        self.catalogPhase = items.isEmpty ? .empty : .ready
    }

    private func runSearch() async {
        let trimmed = self.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard self.gatewayReady, trimmed.count >= 2 else {
            self.searchHits = []
            self.searchBusy = false
            return
        }
        self.searchBusy = true
        try? await Task.sleep(for: .milliseconds(280))
        if Task.isCancelled {
            return
        }
        do {
            let data = try await self.gateway.request(
                method: "knowledge.search",
                paramsJSON: buildKnowledgeSearchParams(query: trimmed),
                timeoutSeconds: 15)
            if Task.isCancelled {
                return
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            self.searchHits = parseKnowledgeSearchResults(text)
            self.searchBusy = false
        } catch {
            if Task.isCancelled {
                return
            }
            self.searchHits = []
            self.searchBusy = false
        }
    }

    private func loadPreview() async {
        guard let doc = self.openDoc else { return }
        let title = doc.item.label
        guard self.gatewayReady, let kbID = doc.knowledgeBaseId, !kbID.isEmpty else {
            self.docBody = .text(knowledgeDocumentStubBody(title: title))
            return
        }
        self.docBody = .loading
        do {
            let data = try await self.gateway.request(
                method: "knowledge.document.preview",
                paramsJSON: buildKnowledgeDocumentPreviewParams(
                    knowledgeBaseId: kbID,
                    documentId: doc.item.sourceID),
                timeoutSeconds: 20)
            if Task.isCancelled {
                return
            }
            let text = String(data: data, encoding: .utf8) ?? ""
            if let parsed = parseKnowledgeDocumentPreviewPayload(text, fallbackTitle: title) {
                self.docBody = .text(parsed)
            } else {
                self.docBody = .text(knowledgeDocumentStubBody(title: title))
            }
        } catch {
            if Task.isCancelled {
                return
            }
            self.docBody = .text(knowledgeDocumentStubBody(title: title))
        }
    }

    private static func sourcesParams(_ knowledgeBaseId: String) -> String {
        guard JSONSerialization.isValidJSONObject(["knowledgeBaseId": knowledgeBaseId]),
              let data = try? JSONSerialization.data(withJSONObject: ["knowledgeBaseId": knowledgeBaseId]),
              let text = String(data: data, encoding: .utf8)
        else { return "{}" }
        return text
    }

    private static func isOffline(_ error: Error) -> Bool {
        let ns = error as NSError
        if ns.domain == "Gateway", ns.code == 11 {
            return true
        }
        return ns.localizedDescription.lowercased().contains("not connected")
    }

    private static func clipped(_ error: Error) -> String {
        let raw = error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
        let text = raw.isEmpty ? "加载失败" : raw
        if text.count <= 160 {
            return text
        }
        return String(text.prefix(160))
    }
}

private enum KnowledgeCatalogPhase: Equatable {
    case loading
    case offline
    case empty
    case ready
    case failed(String)
}

private enum KnowledgeFavoriteStore {
    private static let key = "openbot_knowledge_ui_prefs.favoriteKnowledgeBaseIds"

    static func read() -> [String] {
        parseKnowledgeFavoriteIDs(UserDefaults.standard.string(forKey: self.key) ?? "")
    }

    static func write(_ ids: [String]) {
        UserDefaults.standard.set(encodeKnowledgeFavoriteIDs(ids), forKey: self.key)
    }
}

private struct KnowledgeSearchField: View {
    @Binding var query: String

    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(OpenBotMobileTokens.textTertiary)
            TextField("搜索知识…", text: self.$query)
                .font(OpenBotMobileTokens.body())
                .foregroundStyle(OpenBotMobileTokens.text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.white)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenBotMobileTokens.border, lineWidth: 1))
    }
}

private struct KnowledgeStatusRow: View {
    var text: String
    var showsSpinner: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            if self.showsSpinner {
                ProgressView()
                    .controlSize(.small)
                    .tint(OpenBotMobileTokens.accent)
            }
            Text(self.text)
                .font(OpenBotMobileTokens.callout())
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}

private struct KnowledgeSectionHeader: View {
    var label: String
    var count: Int

    var body: some View {
        HStack {
            Text(self.label)
                .font(OpenBotMobileTokens.body(.semibold))
                .foregroundStyle(OpenBotMobileTokens.text)
            Spacer(minLength: 0)
            Text("\(self.count)")
                .font(OpenBotMobileTokens.caption1(.medium))
                .foregroundStyle(OpenBotMobileTokens.textTertiary)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 10)
    }
}

private struct KnowledgeBrowseRow: View {
    var node: KnowledgeCatalogNode
    var depth: Int
    var expanded: Bool
    var favoriteAction: (() -> Void)?
    var onToggle: () -> Void
    var onOpen: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            if self.showsChevron {
                Button(action: self.onToggle) {
                    Image(systemName: self.expanded ? "chevron.down" : "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(OpenBotMobileTokens.textSecondary)
                        .frame(width: 18, height: 18)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(self.expanded ? "折叠" : "展开")
            } else {
                Color.clear.frame(width: 18, height: 18)
            }
            if !self.isFile {
                Circle()
                    .fill(Color(hex: 0x10B981))
                    .frame(width: 7, height: 7)
            }
            Image(systemName: self.isFile ? "doc" : "folder")
                .font(.system(size: 14))
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
            Text(self.node.item.label)
                .font(OpenBotMobileTokens.callout(self.isFile ? .medium : .semibold))
                .foregroundStyle(OpenBotMobileTokens.text)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.leading, 8 + CGFloat(self.depth) * 14)
        .padding(.trailing, 8)
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .onTapGesture(perform: self.onOpen)
        .onLongPressGesture(minimumDuration: 0.45) {
            self.favoriteAction?()
        }
    }

    private var isFile: Bool {
        self.node.item.type == "file"
    }

    private var showsChevron: Bool {
        !self.node.children.isEmpty
            || self.node.item.type == "knowledge"
            || self.node.item.type == "folder"
    }
}

private struct KnowledgeDocumentScreen: View {
    var title: String
    var bodyState: KnowledgeDocumentBody
    var onClose: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            self.header
            Rectangle()
                .fill(OpenBotMobileTokens.border)
                .frame(height: 1)
            ScrollView {
                self.content
                    .padding(.horizontal, 22)
                    .padding(.vertical, 22)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
    }

    private var header: some View {
        HStack(spacing: 4) {
            self.roundButton(systemName: "chevron.left", label: "返回", action: self.onClose)
            Text(self.title)
                .font(OpenBotMobileTokens.headline(.semibold))
                .foregroundStyle(OpenBotMobileTokens.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity)
            self.roundButton(systemName: "xmark", label: "关闭", action: self.onClose)
        }
        .padding(.horizontal, 8)
        .frame(height: 48)
    }

    private func roundButton(systemName: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: systemName)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenBotMobileTokens.text)
                .frame(width: 32, height: 32)
                .background(Color.white)
                .clipShape(Circle())
                .overlay(Circle().stroke(OpenBotMobileTokens.border, lineWidth: 1))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }

    @ViewBuilder
    private var content: some View {
        switch self.bodyState {
        case .loading:
            HStack {
                Spacer()
                ProgressView()
                    .tint(OpenBotMobileTokens.accent)
                Spacer()
            }
            .padding(.vertical, 40)
        case let .unavailable(title, reason):
            Text(title)
                .font(OpenBotMobileTokens.title2(.bold))
                .foregroundStyle(OpenBotMobileTokens.text)
            Text(reason)
                .font(OpenBotMobileTokens.body())
                .foregroundStyle(OpenBotMobileTokens.textSecondary)
                .padding(.top, 12)
        case let .text(doc):
            KnowledgeDocumentBodyView(document: doc)
        }
    }
}

private struct KnowledgeDocumentBodyView: View {
    var document: KnowledgeDocumentText

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.document.title)
                .font(OpenBotMobileTokens.title2(.bold))
                .foregroundStyle(Color(hex: 0x111827))
            ForEach(knowledgeDocBlocks(title: self.document.title, raw: self.document.markdownOrPlain)) { block in
                Text(block.text)
                    .font(OpenBotMobileTokens.body(block.isHeading ? .bold : .medium))
                    .foregroundStyle(block.isHeading ? Color(hex: 0x111827) : Color(hex: 0x374151))
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 4)
            }
            if self.document.htmlSource != nil {
                Text("HTML 预览（Web knowledge.document.preview renderKind=html）")
                    .font(OpenBotMobileTokens.caption1())
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
            }
            if !self.document.fromPreview {
                Text("占位预览 · 与 Web knowledge.document.preview 对齐后显示原文")
                    .font(OpenBotMobileTokens.caption1())
                    .foregroundStyle(OpenBotMobileTokens.textTertiary)
                    .padding(.top, 8)
            }
        }
    }
}
