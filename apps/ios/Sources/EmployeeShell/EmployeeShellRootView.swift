//
//  EmployeeShellRootView.swift
//  Legacy employee-shell host. Not the post-auth root.
//
//  Post-auth UI is EmployeeRootTabs (see RootView). This view must not construct
//  EmployeeShellWebView or EmployeeShellWebController — the four-tab companion
//  is native, and the optional workbench lives under 我的.
//

import SwiftUI

struct EmployeeShellRootView: View {
    @Bindable var controller: EmployeeShellController

    var body: some View {
        Group {
            if self.controller.isLoggedIn {
                // Gated: do not mount the employee shell WebView as an app body.
                Color.clear
                    .accessibilityHidden(true)
            } else {
                EmployeeLoginView(controller: self.controller)
            }
        }
        .fullScreenCover(isPresented: self.$controller.isPresentingLogin) {
            EmployeeLoginView(controller: self.controller)
        }
    }
}
