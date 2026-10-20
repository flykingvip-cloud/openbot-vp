import Foundation
import OpenBotKit
import Testing
@testable import OpenBot

/// Stage 54: login gate + deep-link → employee embed + notification deepLink key.
/// Does not regress Stage 53 device-settings / no-mobile-shell boundaries.
struct EmployeeShellLoginDeepLinkTests {
    @Test func `employee surfaces map to embed paths`() {
        for surface in EmployeeEmbedSurface.allCases {
            let route = DeepLinkRoute.employee(.init(surface: surface))
            #expect(
                EmployeeShellDeepLinkRouting.embedPath(for: route)
                    == EmployeeEmbedRouting.embedPath(forSurface: surface.rawValue))
        }
    }

    @Test func `chat space knowledge deep links map to embed paths`() {
        let chat = DeepLinkRoute.chat(.init(sessionKey: "agent:main:main", agentId: nil))
        #expect(
            EmployeeShellDeepLinkRouting.embedPath(for: chat)
                == EmployeeEmbedRouting.embedPath(forChat: "agent:main:main", agentId: nil))

        let space = DeepLinkRoute.space(.init(spaceId: "sp_1"))
        #expect(
            EmployeeShellDeepLinkRouting.embedPath(for: space)
                == EmployeeEmbedRouting.embedPath(forSpace: "sp_1"))

        let knowledge = DeepLinkRoute.knowledge(.init(objectId: "obj_9", kind: "doc"))
        #expect(
            EmployeeShellDeepLinkRouting.embedPath(for: knowledge)
                == EmployeeEmbedRouting.embedPath(forKnowledge: "obj_9", kind: "doc"))
    }

    @Test func `non-employee deep links do not open the shell`() {
        let agent = DeepLinkParser.parse(URL(string: "openbot://agent?message=hi")!)
        #expect(agent != nil)
        #expect(EmployeeShellDeepLinkRouting.embedPath(for: agent!) == nil)

        let gateway = DeepLinkParser.parse(URL(string: "openbot://gateway?host=127.0.0.1&port=18789")!)
        #expect(gateway != nil)
        #expect(EmployeeShellDeepLinkRouting.embedPath(for: gateway!) == nil)
    }

    @Test func `auth gate defers to login when signed out`() {
        let path = "/embed/employee/knowledge"
        #expect(
            EmployeeShellDeepLinkRouting.authGate(isLoggedIn: false, targetPath: path)
                == .presentLogin(pendingPath: path))
        #expect(
            EmployeeShellDeepLinkRouting.authGate(isLoggedIn: true, targetPath: path)
                == .openShell(path: path))
    }

    @Test func `parser employee grammar reaches shell routing`() {
        let url = URL(string: "openbot://employee/me")!
        let route = DeepLinkParser.parse(url)
        #expect(route == .employee(.init(surface: .me)))
        #expect(EmployeeShellDeepLinkRouting.embedPath(for: route!) == "/embed/employee/me")
    }

    @Test func `notification deep link key is stable for tap-through`() {
        #expect(EmployeeNotificationRouter.deepLinkKey == "deepLink")
        var info: [AnyHashable: Any] = [:]
        let link = URL(string: "openbot://employee/overview")!
        info[EmployeeNotificationRouter.deepLinkKey] = link.absoluteString
        #expect(info[EmployeeNotificationRouter.deepLinkKey] as? String == link.absoluteString)
    }

    @Test func `stage53 device settings boundary still native`() {
        #expect(
            EmployeeEmbedRouting.action(for: .openDeviceSettings(section: "permissions"))
                == .native(.openDeviceSettings(section: "permissions")))
        #expect(EmployeeShellBootstrap.defaultTarget == "/embed/employee/overview")
        let base = URL(string: "https://gw.example.test")!
        let url = EmployeeShellBootstrap.bootstrapURL(
            baseURL: base, token: "tok", target: EmployeeShellBootstrap.defaultTarget)
        #expect(url?.absoluteString.contains("shell=mobile") == false)
    }
}
