//
//  EmployeeShellOpenPanel.swift
//  WKWebView file chooser for the employee shell.
//
//  macOS cancels `<input type="file">` unless WKUIDelegate presents an open panel.
//  WKOpenPanelParameters does not include the accept list, so the page records it
//  via EmployeeShellFileChooser.captureInstallSource before this runs.
//

import AppKit
import Foundation
import OpenBotKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class EmployeeShellOpenPanelCoordinator {
    private var completion: (@MainActor @Sendable ([URL]?) -> Void)?
    private var panel: NSOpenPanel?
    private var generation = 0
    private var scopedURLs: [URL] = []

    func present(
        webView: WKWebView,
        window: NSWindow?,
        parameters: WKOpenPanelParameters,
        completionHandler: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        self.generation += 1
        let generation = self.generation
        self.panel?.close()
        self.finish(nil)
        self.completion = completionHandler
        Task { @MainActor [weak self] in
            guard let self, self.generation == generation else { return }
            let hints = await Self.readHints(from: webView)
            guard self.generation == generation else { return }
            self.showPanel(window: window, parameters: parameters, hints: hints, generation: generation)
        }
    }

    func teardown() {
        self.generation += 1
        self.panel?.close()
        self.finish(nil)
        for url in self.scopedURLs {
            url.stopAccessingSecurityScopedResource()
        }
        self.scopedURLs.removeAll()
    }

    private func showPanel(
        window: NSWindow?,
        parameters: WKOpenPanelParameters,
        hints: EmployeeShellFileChooser.InputHints?,
        generation: Int
    ) {
        let panel = NSOpenPanel()
        panel.title = EmployeeShellStrings.string(.chooseFiles)
        panel.prompt = EmployeeShellStrings.string(.chooseFiles)
        panel.canChooseFiles = true
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.resolvesAliases = true
        let accepted = EmployeeShellFileChooser.contentTypes(forAccept: hints?.accept ?? "")
        if !accepted.isEmpty {
            var allowed = accepted
            if parameters.allowsDirectories {
                allowed.append(.folder)
            }
            panel.allowedContentTypes = Self.unique(allowed)
        }
        self.panel = panel
        let allowsMultipleSelection = parameters.allowsMultipleSelection
        let complete: (NSApplication.ModalResponse) -> Void = { [weak self] response in
            MainActor.assumeIsolated {
                guard let self, let panel = self.panel else { return }
                self.handleResponse(
                    response,
                    panel: panel,
                    allowsMultipleSelection: allowsMultipleSelection,
                    generation: generation)
            }
        }
        if let window {
            panel.beginSheetModal(for: window, completionHandler: complete)
        } else {
            panel.begin(completionHandler: complete)
        }
    }

    private func handleResponse(
        _ response: NSApplication.ModalResponse,
        panel: NSOpenPanel,
        allowsMultipleSelection: Bool,
        generation: Int
    ) {
        guard self.generation == generation else { return }
        guard response == .OK else {
            self.finish(nil)
            return
        }
        var urls = panel.urls
        if !allowsMultipleSelection {
            urls = Array(urls.prefix(1))
        }
        guard !urls.isEmpty else {
            self.finish(nil)
            return
        }
        for url in urls where url.startAccessingSecurityScopedResource() {
            self.scopedURLs.append(url)
        }
        self.finish(urls)
    }

    private func finish(_ urls: [URL]?) {
        let completion = self.completion
        self.completion = nil
        self.panel = nil
        completion?(urls)
    }

    private static func readHints(from webView: WKWebView) async -> EmployeeShellFileChooser.InputHints? {
        do {
            let value = try await webView.evaluateJavaScript(EmployeeShellFileChooser.captureReadSource)
            guard let raw = value as? String else { return nil }
            return EmployeeShellFileChooser.parseHints(raw)
        } catch {
            return nil
        }
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
