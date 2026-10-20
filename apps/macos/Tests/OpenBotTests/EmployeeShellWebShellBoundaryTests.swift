import Foundation
import Testing
@testable import OpenBot

/// Stage 53 / ADR option 1: desktop employee UI is the Web embed window;
/// companion owns device settings. These tests pin the routing contract.
struct EmployeeShellWebShellBoundaryTests {
    @Test func `default open target is embed overview without mobile shell`() {
        #expect(EmployeeShellBootstrap.defaultTarget == "/embed/employee/overview")
        let base = URL(string: "https://gw.example.test")!
        let url = EmployeeShellBootstrap.bootstrapURL(
            baseURL: base, token: "tok", target: EmployeeShellBootstrap.defaultTarget)
        #expect(url?.absoluteString.contains("/native/bootstrap") == true)
        #expect(url?.absoluteString.contains("shell=mobile") == false)
        #expect(url?.absoluteString.contains("target=") == true)
    }

    @Test func `device settings stay native host actions`() {
        #expect(
            EmployeeEmbedRouting.action(for: .openDeviceSettings(section: "permissions"))
                == .native(.openDeviceSettings(section: "permissions")))
    }

    @Test func `signOut stays native host action`() {
        #expect(EmployeeEmbedRouting.action(for: .signOut) == .native(.signOut))
    }

    @Test func `employee surfaces stay on embed paths`() {
        #expect(EmployeeEmbedRouting.embedPath(forSurface: "overview") == "/embed/employee/overview")
        #expect(EmployeeEmbedRouting.embedPath(forSurface: "knowledge") == "/embed/employee/knowledge")
        #expect(EmployeeEmbedRouting.embedPath(forSurface: "me") == "/embed/employee/me")
    }

    @Test func `workbench menu copy is localized`() {
        #expect(EmployeeShellStrings.string(.openWorkspace, .en) == "Employee Workbench")
        #expect(EmployeeShellStrings.string(.openWorkspace, .zhHans) == "员工工作台")
        #expect(EmployeeShellStrings.string(.windowTitle, .en) == "Employee Workbench")
        #expect(EmployeeShellStrings.string(.windowTitle, .zhHans) == "员工工作台")
    }
}
