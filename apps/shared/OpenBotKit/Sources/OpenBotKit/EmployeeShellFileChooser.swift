import Foundation
import UniformTypeIdentifiers

/// Accept-list parsing for the employee-shell WebView file chooser.
///
/// `WKOpenPanelParameters` exposes `allowsMultipleSelection` and `allowsDirectories`
/// only. The page's `accept` attribute is not on that object, so the shell injects
/// `captureInstallSource` and reads it back when WebKit asks for an open panel.
public enum EmployeeShellFileChooser {
    public struct InputHints: Equatable, Sendable {
        public var accept: String
        public var multiple: Bool

        public init(accept: String, multiple: Bool) {
            self.accept = accept
            self.multiple = multiple
        }
    }

    /// Which native picker can satisfy the page's accept list.
    /// Photos cannot select directories or non-image documents.
    public enum UploadSurface: Equatable, Sendable {
        case photos
        case documents
        case photosOrDocuments
    }

    /// Installed at document start. Records the file input that is about to open
    /// a chooser, including a programmatic `input.click()` from the paperclip.
    public static let captureInstallSource = """
    (function () {
      if (window.__openbotFileChooserCaptureInstalled) return;
      window.__openbotFileChooserCaptureInstalled = true;
      function remember(input) {
        if (!input || String(input.type || "").toLowerCase() !== "file") return;
        window.__openbotFileChooserRequest = {
          accept: String(input.accept || ""),
          multiple: !!input.multiple
        };
      }
      document.addEventListener("click", function (event) {
        var node = event.target;
        if (!node || !node.closest) return;
        var input = node.closest("input[type='file']");
        if (input) remember(input);
      }, true);
      var proto = window.HTMLInputElement && window.HTMLInputElement.prototype;
      if (proto && typeof proto.click === "function" && !proto.__openbotFileClickPatched) {
        var original = proto.click;
        proto.click = function () {
          try { remember(this); } catch (e) {}
          return original.apply(this, arguments);
        };
        proto.__openbotFileClickPatched = true;
      }
    })();
    """

    public static let captureReadSource = """
    (function () {
      var request = window.__openbotFileChooserRequest;
      if (!request) return "";
      try { return JSON.stringify(request); } catch (e) { return ""; }
    })();
    """

    public static func parseHints(_ raw: String) -> InputHints? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let data = trimmed.data(using: .utf8) else { return nil }
        guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let accept = object["accept"] as? String ?? ""
        let multiple = object["multiple"] as? Bool ?? false
        return InputHints(accept: accept, multiple: multiple)
    }

    /// Uniform types for an HTML `accept` string.
    ///
    /// An empty list means "do not filter" (`*/*`, blank, or nothing WebKit could map).
    /// Callers that must pass a non-empty list to `UIDocumentPicker` should use
    /// `documentPickerTypes` instead.
    public static func contentTypes(forAccept accept: String) -> [UTType] {
        let tokens = self.tokens(in: accept)
        if tokens.isEmpty { return [] }
        if tokens.contains(where: { $0 == "*" || $0 == "*/*" }) { return [] }
        return self.unique(tokens.compactMap { self.contentType(forToken: $0) })
    }

    public static func uploadSurface(
        for contentTypes: [UTType],
        allowsDirectories: Bool
    ) -> UploadSurface {
        let hasImage = contentTypes.contains(where: self.isImage)
        let hasNonImage = contentTypes.contains(where: { !self.isImage($0) })
        if allowsDirectories {
            if contentTypes.isEmpty || hasImage { return .photosOrDocuments }
            return .documents
        }
        switch (hasImage, hasNonImage) {
        case (true, false):
            return .photos
        case (false, true):
            return .documents
        case (true, true), (false, false):
            return .photosOrDocuments
        }
    }

    /// Types safe to hand to `UIDocumentPickerViewController`, which rejects an empty list.
    public static func documentPickerTypes(
        for contentTypes: [UTType],
        allowsDirectories: Bool
    ) -> [UTType] {
        var types = contentTypes
        if allowsDirectories {
            types.append(.folder)
        }
        if types.isEmpty {
            types = allowsDirectories ? [.item, .folder] : [.item]
        }
        return self.unique(types)
    }

    // MARK: - Private

    /// MIME aliases WebKit / Windows report that `UTType(mimeType:)` often misses.
    private static let mimeExtensionFallback: [String: String] = [
        "application/x-zip-compressed": "zip",
        "application/vnd.rar": "rar",
        "application/x-rar-compressed": "rar",
        "application/x-7z-compressed": "7z",
        "application/x-gzip": "gz",
        "application/gzip": "gz",
        "application/x-tar": "tar",
        "application/x-gtar": "tar",
        "text/markdown": "md",
    ]

    private static func tokens(in accept: String) -> [String] {
        accept
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() }
            .filter { !$0.isEmpty }
    }

    private static func contentType(forToken token: String) -> UTType? {
        switch token {
        case "image/*":
            return .image
        case "audio/*":
            return .audio
        case "video/*":
            return .video
        case "text/*":
            return .text
        default:
            break
        }
        if token == ".tar.gz" || token == "tar.gz" {
            return self.typeForExtension("gz")
        }
        if token.hasPrefix(".") || !token.contains("/") {
            let ext = token.hasPrefix(".") ? String(token.dropFirst()) : token
            return self.typeForExtension(ext)
        }
        if let type = UTType(mimeType: token) {
            return type
        }
        if let ext = self.mimeExtensionFallback[token] {
            return self.typeForExtension(ext)
        }
        return nil
    }

    /// Known extensions resolve to system types. Unknown ones (rar, 7z) still become
    /// a dynamic type so the panel can filter on the extension instead of hiding them.
    private static func typeForExtension(_ ext: String) -> UTType? {
        let cleaned = ext.trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !cleaned.isEmpty, !cleaned.contains("/") else { return nil }
        return UTType(tag: cleaned, tagClass: .filenameExtension, conformingTo: .data)
            ?? UTType(filenameExtension: cleaned)
    }

    private static func isImage(_ type: UTType) -> Bool {
        type == .image || type.conforms(to: .image)
    }

    private static func unique(_ types: [UTType]) -> [UTType] {
        var seen = Set<String>()
        var result: [UTType] = []
        for type in types where seen.insert(type.identifier).inserted {
            result.append(type)
        }
        return result
    }
}
