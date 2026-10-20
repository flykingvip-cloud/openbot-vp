import Foundation

/// Flat catalog row for the pink knowledge capsule picker.
/// Parsed from Gateway `context.scope.sources.catalog`, or
/// `knowledge.base.list` + `knowledge.base.sources.list` (Android / Web names).
struct ChatKnowledgeCatalogItem: Equatable, Sendable, Identifiable {
    var type: String
    var sourceID: String
    var label: String
    var parentId: String?
    /// `private` / `team` / `enterprise` when the Gateway sends it. Knowledge tab groups on this.
    var visibility: String?

    var id: String {
        "\(self.type):\(self.sourceID)"
    }
}

enum ChatKnowledgeCatalogParser {
    private static let sourceKinds: Set<String> = ["knowledge", "file", "folder", "api"]
    private static let apiKinds: Set<String> = ["api", "external", "capability"]
    private static let folderKinds: Set<String> = ["localFolder", "gitRepo", "cloudDrive", "mailAttachment"]
    private static let limitKnowledge = 50
    private static let limitFiles = 80
    private static let limitFolders = 40
    private static let limitAPIs = 40

    static func parseContextScopeCatalog(_ raw: String) -> [ChatKnowledgeCatalogItem] {
        guard let sources = jsonArray(raw, key: "sources") ?? jsonTopArray(raw) else { return [] }
        var items: [ChatKnowledgeCatalogItem] = []
        for case let record as [String: Any] in sources {
            let type = self.string(record["type"])
            let id = self.string(record["id"])
            let label = self.string(record["label"])
            guard self.sourceKinds.contains(type), !id.isEmpty, !label.isEmpty else { continue }
            items.append(
                ChatKnowledgeCatalogItem(
                    type: type,
                    sourceID: id,
                    label: label,
                    parentId: self.nonEmpty(record["parentId"]),
                    visibility: self.visibility(record["visibility"])))
        }
        return items
    }

    static func parseKnowledgeBaseList(_ raw: String) -> [ChatKnowledgeCatalogItem] {
        guard let list = jsonArray(raw, key: "knowledgeBases") ?? jsonTopArray(raw) else { return [] }
        var items: [ChatKnowledgeCatalogItem] = []
        for case let record as [String: Any] in list {
            if items.count >= self.limitKnowledge {
                break
            }
            let id = self.nonEmpty(record["id"]) ?? self.nonEmpty(record["knowledgeBaseId"])
            let label = self.nonEmpty(record["title"]) ?? self.nonEmpty(record["label"])
            guard let id, let label else { continue }
            items.append(
                ChatKnowledgeCatalogItem(
                    type: "knowledge",
                    sourceID: id,
                    label: label,
                    parentId: nil,
                    visibility: self.visibility(record["visibility"])))
        }
        return items
    }

    static func parseKnowledgeBaseSources(
        parentID: String,
        raw: String,
        parentVisibility: String? = nil) -> [ChatKnowledgeCatalogItem]
    {
        guard let list = jsonArray(raw, key: "sources") ?? jsonTopArray(raw) else { return [] }
        var items: [ChatKnowledgeCatalogItem] = []
        var files = 0
        var folders = 0
        var apis = 0
        for case let record as [String: Any] in list {
            let kind = self.string(record["kind"])
            guard let id = nonEmpty(record["documentId"])
                ?? nonEmpty(record["id"])
                ?? nonEmpty(record["sourceDescriptorId"])
            else { continue }
            guard let label = nonEmpty(record["title"]) ?? nonEmpty(record["label"]) else { continue }
            let vis = self.visibility(record["visibility"]) ?? parentVisibility
            if self.apiKinds.contains(kind) {
                if apis >= self.limitAPIs {
                    continue
                }
                apis += 1
                items.append(ChatKnowledgeCatalogItem(
                    type: "api",
                    sourceID: id,
                    label: label,
                    parentId: parentID,
                    visibility: vis))
            } else if self.folderKinds.contains(kind) {
                if folders >= self.limitFolders {
                    continue
                }
                folders += 1
                items.append(ChatKnowledgeCatalogItem(
                    type: "folder",
                    sourceID: id,
                    label: label,
                    parentId: parentID,
                    visibility: vis))
            } else {
                if files >= self.limitFiles {
                    continue
                }
                files += 1
                items.append(ChatKnowledgeCatalogItem(
                    type: "file",
                    sourceID: id,
                    label: label,
                    parentId: parentID,
                    visibility: vis))
            }
        }
        return items
    }

    private static func jsonObject(_ raw: String) -> [String: Any]? {
        guard let data = raw.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return object
    }

    private static func jsonTopArray(_ raw: String) -> [Any]? {
        guard let data = raw.data(using: .utf8),
              let array = try? JSONSerialization.jsonObject(with: data) as? [Any]
        else { return nil }
        return array
    }

    private static func jsonArray(_ raw: String, key: String) -> [Any]? {
        guard let object = jsonObject(raw) else { return nil }
        return object[key] as? [Any]
    }

    private static func string(_ value: Any?) -> String {
        guard let text = value as? String else { return "" }
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func nonEmpty(_ value: Any?) -> String? {
        let text = self.string(value)
        return text.isEmpty ? nil : text
    }

    private static func visibility(_ value: Any?) -> String? {
        let text = self.string(value)
        guard text == "private" || text == "team" || text == "enterprise" else { return nil }
        return text
    }
}
