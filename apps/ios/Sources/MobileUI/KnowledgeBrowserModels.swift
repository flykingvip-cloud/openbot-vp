import Foundation

// Knowledge tab read models. Mirrors Android `KnowledgeBrowserModels` plus the
// catalog tree in `ChatContextScope.kt`. Same Gateway names as Chat capsule
// and Web: `context.scope.sources.catalog`, `knowledge.base.list`,
// `knowledge.base.sources.list`, `knowledge.search`, `knowledge.document.preview`.
// No create / rename / delete menus.

enum KnowledgeCatalogGroupID: String, Equatable, Sendable, CaseIterable {
    case personal = "private"
    case team
    case enterprise
    case ungrouped

    static let displayOrder: [KnowledgeCatalogGroupID] = [
        .personal, .team, .enterprise, .ungrouped,
    ]
}

func knowledgeBrowserSectionLabel(_ group: KnowledgeCatalogGroupID) -> String {
    switch group {
    case .personal:
        "个人空间"
    case .team:
        "团队空间"
    case .enterprise:
        "企业空间"
    case .ungrouped:
        "其他"
    }
}

struct KnowledgeCatalogNode: Equatable, Sendable {
    var item: ChatKnowledgeCatalogItem
    var children: [KnowledgeCatalogNode]
}

struct KnowledgeCatalogGroup: Equatable, Sendable, Identifiable {
    var id: KnowledgeCatalogGroupID
    var nodes: [KnowledgeCatalogNode]
}

struct KnowledgeFlatNode: Equatable, Sendable, Identifiable {
    var node: KnowledgeCatalogNode
    var depth: Int

    var id: String {
        "\(self.node.item.id)#\(self.depth)"
    }
}

struct KnowledgeFilteredTree: Equatable, Sendable {
    var groups: [KnowledgeCatalogGroup]
    var expandedKeys: [String]
}

struct KnowledgeSearchHit: Equatable, Sendable, Identifiable {
    var id: String
    var title: String
    var summary: String
    var knowledgeBaseId: String?
}

struct KnowledgeDocumentText: Equatable, Sendable {
    var title: String
    var markdownOrPlain: String
    var fromPreview: Bool
    var htmlSource: String?
}

enum KnowledgeDocumentBody: Equatable, Sendable {
    case loading
    case text(KnowledgeDocumentText)
    case unavailable(title: String, reason: String)
}

struct KnowledgeDocBlock: Equatable, Sendable, Identifiable {
    var id: Int
    var text: String
    var isHeading: Bool
}

struct KnowledgeOpenDocument: Equatable, Sendable, Identifiable {
    var item: ChatKnowledgeCatalogItem
    var knowledgeBaseId: String?

    var id: String {
        self.item.id
    }
}

func knowledgeDefaultExpandedKeys(_ items: [ChatKnowledgeCatalogItem]) -> Set<String> {
    Set(items.filter { $0.type == "knowledge" || $0.type == "folder" }.map(\.id))
}

func buildKnowledgeCatalogTree(_ items: [ChatKnowledgeCatalogItem]) -> [KnowledgeCatalogGroup] {
    var childIDs = Set<String>()
    var childrenByParentID: [String: [ChatKnowledgeCatalogItem]] = [:]
    for item in items {
        guard let parent = resolveKnowledgeCatalogParent(item, catalog: items) else { continue }
        childIDs.insert(item.id)
        childrenByParentID[parent.sourceID, default: []].append(item)
    }
    let roots = items.filter { !childIDs.contains($0.id) }
    var grouped: [KnowledgeCatalogGroupID: [KnowledgeCatalogNode]] = [:]
    for root in roots {
        let group = knowledgeGroupID(for: root)
        grouped[group, default: []].append(
            knowledgeCatalogNode(root, childrenByParentID: childrenByParentID, visiting: []))
    }
    return KnowledgeCatalogGroupID.displayOrder.compactMap { id in
        guard let nodes = grouped[id], !nodes.isEmpty else { return nil }
        return KnowledgeCatalogGroup(id: id, nodes: nodes)
    }
}

func flattenKnowledgeCatalogNodes(
    _ nodes: [KnowledgeCatalogNode],
    expandedKeys: Set<String>) -> [KnowledgeFlatNode]
{
    var out: [KnowledgeFlatNode] = []
    func walk(_ list: [KnowledgeCatalogNode], depth: Int) {
        for node in list {
            out.append(KnowledgeFlatNode(node: node, depth: depth))
            if !node.children.isEmpty, expandedKeys.contains(node.item.id) {
                walk(node.children, depth: depth + 1)
            }
        }
    }
    walk(nodes, depth: 0)
    return out
}

func filterKnowledgeCatalogTree(
    _ groups: [KnowledgeCatalogGroup],
    query: String) -> KnowledgeFilteredTree
{
    let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    if needle.isEmpty {
        return KnowledgeFilteredTree(groups: groups, expandedKeys: [])
    }
    var expanded: [String] = []
    func filterNode(_ node: KnowledgeCatalogNode) -> KnowledgeCatalogNode? {
        let childHits = node.children.compactMap { filterNode($0) }
        let selfMatch = node.item.label.lowercased().contains(needle)
            || node.item.sourceID.lowercased().contains(needle)
        if !selfMatch, childHits.isEmpty {
            return nil
        }
        if !childHits.isEmpty {
            expanded.append(node.item.id)
        }
        let children = selfMatch ? node.children : childHits
        return KnowledgeCatalogNode(item: node.item, children: children)
    }
    let next = groups.compactMap { group -> KnowledgeCatalogGroup? in
        let nodes = group.nodes.compactMap { filterNode($0) }
        if nodes.isEmpty {
            return nil
        }
        return KnowledgeCatalogGroup(id: group.id, nodes: nodes)
    }
    return KnowledgeFilteredTree(groups: next, expandedKeys: expanded)
}

func resolveKnowledgeBaseID(
    _ item: ChatKnowledgeCatalogItem,
    catalog: [ChatKnowledgeCatalogItem]) -> String?
{
    if item.type == "knowledge" {
        return item.sourceID
    }
    let byID = Dictionary(catalog.map { ($0.sourceID, $0) }, uniquingKeysWith: { first, _ in first })
    var current: ChatKnowledgeCatalogItem? = item
    var seen = Set<String>()
    while let node = current {
        if !seen.insert(node.id).inserted {
            return nil
        }
        guard let parentID = knowledgeTrimmed(node.parentId), let parent = byID[parentID] else {
            return nil
        }
        if parent.type == "knowledge" {
            return parent.sourceID
        }
        current = parent
    }
    return nil
}

func buildKnowledgeDocumentPreviewParams(knowledgeBaseId: String, documentId: String) -> String {
    knowledgeJSONString([
        "knowledgeBaseId": knowledgeBaseId,
        "documentId": documentId,
        "render": true,
    ])
}

func buildKnowledgeSearchParams(query: String, limit: Int = 20) -> String {
    knowledgeJSONString([
        "query": query,
        "limit": limit,
    ])
}

func parseKnowledgeSearchResults(_ raw: String) -> [KnowledgeSearchHit] {
    guard let results = knowledgeJSONArray(raw, key: "results") else { return [] }
    var hits: [KnowledgeSearchHit] = []
    for case let record as [String: Any] in results {
        guard let id = knowledgeNonEmpty(record["id"]) else { continue }
        let title = knowledgeNonEmpty(record["title"]) ?? id
        let summary = knowledgeString(record["summary"])?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let source = record["source"] as? [String: Any]
        let kbID = knowledgeNonEmpty(record["knowledgeBaseId"])
            ?? knowledgeNonEmpty(record["kbId"])
            ?? knowledgeNonEmpty(source?["knowledgeBaseId"])
        hits.append(KnowledgeSearchHit(id: id, title: title, summary: summary, knowledgeBaseId: kbID))
    }
    return hits
}

func parseKnowledgeDocumentPreviewPayload(_ raw: String, fallbackTitle: String) -> KnowledgeDocumentText? {
    guard let root = knowledgeJSONObject(raw) else { return nil }
    let filename = knowledgeNonEmpty(root["filename"]) ?? ""
    let title = filename.isEmpty ? fallbackTitle : filename
    if let html = knowledgeNonEmpty(root["html"]) {
        return KnowledgeDocumentText(
            title: title,
            markdownOrPlain: knowledgeHTMLToPlain(html),
            fromPreview: true,
            htmlSource: html)
    }
    guard let b64 = knowledgeNonEmpty(root["base64"]),
          let data = Data(base64Encoded: b64, options: [.ignoreUnknownCharacters]),
          let decoded = String(data: data, encoding: .utf8)?
              .trimmingCharacters(in: .whitespacesAndNewlines),
              !decoded.isEmpty
    else { return nil }
    return KnowledgeDocumentText(
        title: title,
        markdownOrPlain: decoded,
        fromPreview: true,
        htmlSource: nil)
}

func knowledgeDocumentStubBody(title: String) -> KnowledgeDocumentText {
    let trimmed = title.trimmingCharacters(in: .whitespacesAndNewlines)
    let heading = trimmed.isEmpty ? "文档" : trimmed
    let body = """
    # \(heading)

    ## 1. 入职准备
    请在入职首日 9:00 前携带相关证件到前台报到。公司将提供电脑与办公设备，IT 同学会协助完成账号开通。

    ## 2. 公司文化
    请阅读员工手册了解核心价值观。下午 HR 将介绍团队与工作流程，并安排导师结对。

    （预览占位 · 连接 Gateway 后将走 knowledge.document.preview）
    """
    return KnowledgeDocumentText(
        title: heading,
        markdownOrPlain: body,
        fromPreview: false,
        htmlSource: nil)
}

func knowledgeDocBlocks(title: String, raw: String) -> [KnowledgeDocBlock] {
    let lines = raw.split(omittingEmptySubsequences: false, whereSeparator: \.isNewline).map(String.init)
    var blocks: [String] = []
    var buffer: [String] = []
    func flush() {
        let text = buffer.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        if !text.isEmpty {
            blocks.append(text)
        }
        buffer.removeAll()
    }
    for line in lines {
        let trimmed = line.trimmingCharacters(in: .whitespaces)
        if trimmed.isEmpty {
            flush()
        } else if trimmed.hasPrefix("#") {
            flush()
            buffer.append(trimmed)
            flush()
        } else {
            buffer.append(trimmed)
        }
    }
    flush()
    let heading = lines.first { $0.trimmingCharacters(in: .whitespaces).hasPrefix("#") }
        .map { knowledgeStripHeading($0) }
    var skippedTitle = heading == nil
    var rendered: [KnowledgeDocBlock] = []
    for block in blocks {
        let stripped = knowledgeStripHeading(block)
        let matchesTitle = stripped == heading || stripped == title
        if !skippedTitle, matchesTitle {
            skippedTitle = true
            if block.trimmingCharacters(in: .whitespaces).hasPrefix("#") {
                continue
            }
        }
        let single = !stripped.contains("\n")
        let isHeading = block.trimmingCharacters(in: .whitespaces).hasPrefix("#")
            || (single && stripped.count < 40 && !stripped.contains("。"))
        rendered.append(KnowledgeDocBlock(id: rendered.count, text: stripped, isHeading: isHeading))
    }
    return rendered
}

func parseKnowledgeFavoriteIDs(_ raw: String) -> [String] {
    var seen = Set<String>()
    var ids: [String] = []
    for part in raw.split(separator: ",") {
        let id = part.trimmingCharacters(in: .whitespacesAndNewlines)
        if id.isEmpty || seen.contains(id) {
            continue
        }
        seen.insert(id)
        ids.append(id)
    }
    return ids
}

func toggleKnowledgeFavoriteIDs(_ current: [String], kbID: String) -> [String] {
    let id = kbID.trimmingCharacters(in: .whitespacesAndNewlines)
    if id.isEmpty {
        return current
    }
    if current.contains(id) {
        return current.filter { $0 != id }
    }
    return current + [id]
}

func encodeKnowledgeFavoriteIDs(_ ids: [String]) -> String {
    ids.joined(separator: ",")
}

private func knowledgeGroupID(for item: ChatKnowledgeCatalogItem) -> KnowledgeCatalogGroupID {
    guard item.type == "knowledge", let visibility = item.visibility else { return .ungrouped }
    return KnowledgeCatalogGroupID(rawValue: visibility) ?? .ungrouped
}

private func resolveKnowledgeCatalogParent(
    _ item: ChatKnowledgeCatalogItem,
    catalog: [ChatKnowledgeCatalogItem]) -> ChatKnowledgeCatalogItem?
{
    guard let parentID = knowledgeTrimmed(item.parentId) else { return nil }
    if let typed = catalog.first(where: { parent in
        parent.sourceID == parentID && (parent.type == "knowledge" || parent.type == "folder")
    }) {
        return typed
    }
    return catalog.first { $0.sourceID == parentID }
}

private func knowledgeCatalogNode(
    _ item: ChatKnowledgeCatalogItem,
    childrenByParentID: [String: [ChatKnowledgeCatalogItem]],
    visiting: Set<String>) -> KnowledgeCatalogNode
{
    if visiting.contains(item.id) {
        return KnowledgeCatalogNode(item: item, children: [])
    }
    var next = visiting
    next.insert(item.id)
    let children = (childrenByParentID[item.sourceID] ?? [])
        .filter { $0.id != item.id }
        .map { knowledgeCatalogNode($0, childrenByParentID: childrenByParentID, visiting: next) }
    return KnowledgeCatalogNode(item: item, children: children)
}

private func knowledgeStripHeading(_ raw: String) -> String {
    var text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    while text.hasPrefix("#") {
        text.removeFirst()
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func knowledgeHTMLToPlain(_ html: String) -> String {
    var text = html
    let patterns: [(String, String)] = [
        ("(?is)<script[^>]*>.*?</script>", ""),
        ("(?is)<style[^>]*>.*?</style>", ""),
        ("(?i)<br\\s*/?>", "\n"),
        ("(?i)</p>", "\n\n"),
        ("(?i)</h[1-6]>", "\n\n"),
        ("(?i)<li[^>]*>", "• "),
        ("(?i)</li>", "\n"),
        ("<[^>]+>", ""),
        ("&nbsp;", " "),
        ("&amp;", "&"),
        ("&lt;", "<"),
        ("&gt;", ">"),
        ("\n{3,}", "\n\n"),
    ]
    for (pattern, replacement) in patterns {
        text = text.replacingOccurrences(of: pattern, with: replacement, options: .regularExpression)
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

private func knowledgeJSONObject(_ raw: String) -> [String: Any]? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
}

private func knowledgeJSONArray(_ raw: String, key: String) -> [Any]? {
    guard let object = knowledgeJSONObject(raw) else { return nil }
    return object[key] as? [Any]
}

private func knowledgeString(_ value: Any?) -> String? {
    guard let value, !(value is NSNull) else { return nil }
    if let text = value as? String {
        return text
    }
    if let number = value as? NSNumber {
        if CFGetTypeID(number) == CFBooleanGetTypeID() {
            return nil
        }
        return String(number.int64Value)
    }
    return nil
}

private func knowledgeNonEmpty(_ value: Any?) -> String? {
    let trimmed = knowledgeString(value)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

private func knowledgeTrimmed(_ value: String?) -> String? {
    let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    return trimmed.isEmpty ? nil : trimmed
}

private func knowledgeJSONString(_ object: Any) -> String {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object)
    else { return "{}" }
    return String(data: data, encoding: .utf8) ?? "{}"
}
