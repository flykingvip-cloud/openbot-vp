//
//  EmployeeShellUploadPicker.swift
//  File chooser for the employee-shell WKWebView.
//
//  `WKUIDelegate.runOpenPanel` is public on iOS 18.4+. Implementing it replaces
//  Safari's default upload sheet, so this presents Photo Library and/or Files
//  from the page's `accept` list. iOS 18.0–18.3 do not call that method; WebKit
//  keeps the system upload UI on those releases.
//
//  UIDocumentPicker / PHPicker need no extra photo-library permission. PHPicker
//  returns a temporary file that is copied before the provider deletes it.
//

import Foundation
import OpenBotKit
import PhotosUI
import UIKit
import UniformTypeIdentifiers
import WebKit

@MainActor
final class EmployeeShellUploadPicker: NSObject, UIDocumentPickerDelegate, PHPickerViewControllerDelegate,
    UIAdaptivePresentationControllerDelegate
{
    private var completion: (@MainActor @Sendable ([URL]?) -> Void)?
    private var generation = 0
    private var allowsMultiple = false
    private var childPresented = false
    private weak var webView: WKWebView?

    func present(
        from webView: WKWebView,
        allowsMultipleSelection: Bool,
        allowsDirectories: Bool,
        completion: @escaping @MainActor @Sendable ([URL]?) -> Void
    ) {
        self.generation += 1
        let generation = self.generation
        self.childPresented = false
        self.finish(nil)
        self.webView = webView
        self.allowsMultiple = allowsMultipleSelection
        self.completion = completion
        Task { @MainActor [weak self] in
            guard let self, self.generation == generation else { return }
            let hints = await self.readHints()
            guard self.generation == generation else { return }
            let accepted = EmployeeShellFileChooser.contentTypes(forAccept: hints?.accept ?? "")
            let surface = EmployeeShellFileChooser.uploadSurface(
                for: accepted,
                allowsDirectories: allowsDirectories)
            guard let presenter = self.presenter(for: webView) else {
                self.finish(nil)
                return
            }
            switch surface {
            case .photos:
                self.presentPhotos(from: presenter, generation: generation)
            case .documents:
                self.presentDocuments(
                    from: presenter,
                    contentTypes: accepted,
                    allowsDirectories: allowsDirectories,
                    generation: generation)
            case .photosOrDocuments:
                self.presentChoice(
                    from: presenter,
                    contentTypes: accepted,
                    allowsDirectories: allowsDirectories,
                    generation: generation)
            }
        }
    }

    func cancel() {
        self.generation += 1
        self.childPresented = false
        self.finish(nil)
        if let webView = self.webView {
            self.presenter(for: webView)?.dismiss(animated: false)
        }
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        let generation = self.generation
        if results.isEmpty {
            self.finish(nil)
            return
        }
        Task { @MainActor [weak self] in
            let urls = await self?.copyPhotos(results) ?? []
            guard let self, self.generation == generation else { return }
            let chosen = self.allowsMultiple ? urls : Array(urls.prefix(1))
            self.finish(chosen.isEmpty ? nil : chosen)
        }
    }

    func documentPicker(_: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let chosen = self.allowsMultiple ? urls : Array(urls.prefix(1))
        for url in chosen {
            _ = url.startAccessingSecurityScopedResource()
        }
        self.finish(chosen.isEmpty ? nil : chosen)
    }

    func documentPickerWasCancelled(_: UIDocumentPickerViewController) {
        self.finish(nil)
    }

    func presentationControllerDidDismiss(_: UIPresentationController) {
        if !self.childPresented {
            self.finish(nil)
        }
    }

    private func presentChoice(
        from presenter: UIViewController,
        contentTypes: [UTType],
        allowsDirectories: Bool,
        generation: Int
    ) {
        let alert = UIAlertController(
            title: EmployeeShellStrings.chooseAttachment,
            message: nil,
            preferredStyle: .actionSheet)
        alert.addAction(UIAlertAction(title: EmployeeShellStrings.photoLibrary, style: .default) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.generation == generation else { return }
                self.childPresented = true
                self.presentPhotos(from: presenter, generation: generation)
            }
        })
        alert.addAction(UIAlertAction(title: EmployeeShellStrings.browseFiles, style: .default) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.generation == generation else { return }
                self.childPresented = true
                self.presentDocuments(
                    from: presenter,
                    contentTypes: contentTypes,
                    allowsDirectories: allowsDirectories,
                    generation: generation)
            }
        })
        alert.addAction(UIAlertAction(title: EmployeeShellStrings.cancel, style: .cancel) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, self.generation == generation else { return }
                self.finish(nil)
            }
        })
        if let popover = alert.popoverPresentationController, let webView = self.webView {
            popover.sourceView = webView
            popover.sourceRect = CGRect(x: webView.bounds.midX, y: webView.bounds.maxY - 1, width: 1, height: 1)
        }
        alert.presentationController?.delegate = self
        presenter.present(alert, animated: true)
    }

    private func presentPhotos(from presenter: UIViewController, generation: Int) {
        var config = PHPickerConfiguration()
        config.filter = .images
        config.selectionLimit = self.allowsMultiple ? 0 : 1
        config.preferredAssetRepresentationMode = .current
        let picker = PHPickerViewController(configuration: config)
        picker.delegate = self
        self.presentChild(picker, from: presenter, generation: generation)
    }

    private func presentDocuments(
        from presenter: UIViewController,
        contentTypes: [UTType],
        allowsDirectories: Bool,
        generation: Int
    ) {
        let types = EmployeeShellFileChooser.documentPickerTypes(
            for: contentTypes,
            allowsDirectories: allowsDirectories)
        // Directory picks need security-scoped URLs (`asCopy: false`). File-only
        // picks still copy into the app sandbox so WebKit can read them after the
        // picker dismisses.
        let picker = UIDocumentPickerViewController(
            forOpeningContentTypes: types,
            asCopy: !allowsDirectories)
        picker.allowsMultipleSelection = self.allowsMultiple
        picker.delegate = self
        self.presentChild(picker, from: presenter, generation: generation)
    }

    /// An action sheet is still up when the user picks Photo Library or Files.
    /// Dismiss it first, then present the real picker. A direct photos/files path
    /// has nothing to dismiss.
    private func presentChild(_ controller: UIViewController, from presenter: UIViewController, generation: Int) {
        guard self.generation == generation else { return }
        if presenter.presentedViewController == nil {
            presenter.present(controller, animated: true)
            return
        }
        presenter.dismiss(animated: true) { [weak self] in
            MainActor.assumeIsolated {
                guard let self, self.generation == generation else { return }
                presenter.present(controller, animated: true)
            }
        }
    }

    private func copyPhotos(_ results: [PHPickerResult]) async -> [URL] {
        var urls: [URL] = []
        for result in results {
            if let url = await self.copyPhoto(result) {
                urls.append(url)
            }
        }
        return urls
    }

    private func copyPhoto(_ result: PHPickerResult) async -> URL? {
        let provider = result.itemProvider
        let identifier = provider.registeredTypeIdentifiers.first ?? UTType.image.identifier
        let type = UTType(identifier) ?? .image
        let ext = type.preferredFilenameExtension ?? "img"
        do {
            // Xcode 26 / iOS 26 SDK surfaces NSItemProvider.loadTransferable as
            // completion-handler only; wrap it so this path stays async.
            let data: Data = try await withCheckedThrowingContinuation { cont in
                _ = provider.loadTransferable(type: Data.self) { result in
                    switch result {
                    case .success(let value):
                        cont.resume(returning: value)
                    case .failure(let error):
                        cont.resume(throwing: error)
                    }
                }
            }
            let dest = FileManager.default.temporaryDirectory
                .appendingPathComponent("openbot-upload-\(UUID().uuidString).\(ext)")
            try data.write(to: dest, options: Data.WritingOptions.atomic)
            return dest
        } catch {
            return nil
        }
    }

    private func readHints() async -> EmployeeShellFileChooser.InputHints? {
        guard let webView = self.webView else { return nil }
        do {
            let value = try await webView.evaluateJavaScript(EmployeeShellFileChooser.captureReadSource)
            guard let raw = value as? String else { return nil }
            return EmployeeShellFileChooser.parseHints(raw)
        } catch {
            return nil
        }
    }

    private func presenter(for webView: WKWebView) -> UIViewController? {
        var responder: UIResponder? = webView
        while let current = responder {
            if let controller = current as? UIViewController {
                var top = controller
                while let presented = top.presentedViewController, !presented.isBeingDismissed {
                    top = presented
                }
                return top
            }
            responder = current.next
        }
        return webView.window?.rootViewController
    }

    private func finish(_ urls: [URL]?) {
        let completion = self.completion
        self.completion = nil
        completion?(urls)
    }
}
