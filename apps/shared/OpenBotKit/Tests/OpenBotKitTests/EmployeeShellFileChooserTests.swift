import Foundation
import Testing
import UniformTypeIdentifiers
@testable import OpenBotKit

struct EmployeeShellFileChooserTests {
    @Test func blankOrWildcardAcceptDoesNotFilter() {
        #expect(EmployeeShellFileChooser.contentTypes(forAccept: "").isEmpty)
        #expect(EmployeeShellFileChooser.contentTypes(forAccept: "  ,  ").isEmpty)
        #expect(EmployeeShellFileChooser.contentTypes(forAccept: "*/*").isEmpty)
        #expect(EmployeeShellFileChooser.contentTypes(forAccept: "image/*,*/*").isEmpty)
    }

    @Test func imageWildcardAndExtensionsMap() {
        let types = EmployeeShellFileChooser.contentTypes(forAccept: "image/*, .zip, application/pdf")
        #expect(types.contains(.image))
        #expect(types.contains(.zip))
        #expect(types.contains(.pdf))
    }

    @Test func archiveAliasesMapToExtensions() {
        let types = EmployeeShellFileChooser.contentTypes(
            forAccept: ".rar,.7z,.tar.gz,application/x-zip-compressed,application/gzip")
        #expect(types.contains { $0.preferredFilenameExtension == "rar" })
        #expect(types.contains { $0.preferredFilenameExtension == "7z" })
        #expect(types.contains(.gzip) || types.contains { $0.preferredFilenameExtension == "gz" })
        #expect(types.contains(.zip))
    }

    @Test func parsesCapturePayload() {
        let hints = EmployeeShellFileChooser.parseHints(#"{"accept":"image/*,.zip","multiple":true}"#)
        #expect(hints == EmployeeShellFileChooser.InputHints(accept: "image/*,.zip", multiple: true))
        #expect(EmployeeShellFileChooser.parseHints("") == nil)
        #expect(EmployeeShellFileChooser.parseHints("not-json") == nil)
        let missingMultiple = EmployeeShellFileChooser.parseHints(#"{"accept":".pdf"}"#)
        #expect(missingMultiple == EmployeeShellFileChooser.InputHints(accept: ".pdf", multiple: false))
    }

    @Test func uploadSurfaceFollowsAcceptAndDirectories() {
        let images = EmployeeShellFileChooser.contentTypes(forAccept: "image/*")
        let docs = EmployeeShellFileChooser.contentTypes(forAccept: "application/pdf,.zip")
        let mixed = EmployeeShellFileChooser.contentTypes(forAccept: "image/*,.zip")
        #expect(EmployeeShellFileChooser.uploadSurface(for: images, allowsDirectories: false) == .photos)
        #expect(EmployeeShellFileChooser.uploadSurface(for: docs, allowsDirectories: false) == .documents)
        #expect(EmployeeShellFileChooser.uploadSurface(for: mixed, allowsDirectories: false) == .photosOrDocuments)
        #expect(EmployeeShellFileChooser.uploadSurface(for: [], allowsDirectories: false) == .photosOrDocuments)
        #expect(EmployeeShellFileChooser.uploadSurface(for: docs, allowsDirectories: true) == .documents)
        #expect(EmployeeShellFileChooser.uploadSurface(for: images, allowsDirectories: true) == .photosOrDocuments)
    }

    @Test func documentPickerTypesNeverEmpty() {
        let empty = EmployeeShellFileChooser.documentPickerTypes(for: [], allowsDirectories: false)
        #expect(empty == [.item])
        let withFolder = EmployeeShellFileChooser.documentPickerTypes(for: [], allowsDirectories: true)
        #expect(withFolder.contains(.item))
        #expect(withFolder.contains(.folder))
        let pdf = EmployeeShellFileChooser.contentTypes(forAccept: "application/pdf")
        let picked = EmployeeShellFileChooser.documentPickerTypes(for: pdf, allowsDirectories: true)
        #expect(picked.contains(.pdf))
        #expect(picked.contains(.folder))
    }

    @Test func captureScriptRemembersProgrammaticClick() {
        #expect(EmployeeShellFileChooser.captureInstallSource.contains("HTMLInputElement"))
        #expect(EmployeeShellFileChooser.captureInstallSource.contains("__openbotFileChooserRequest"))
        #expect(EmployeeShellFileChooser.captureReadSource.contains("__openbotFileChooserRequest"))
    }
}
