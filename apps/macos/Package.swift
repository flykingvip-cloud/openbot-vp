// swift-tools-version: 6.2
// Package manifest for the OpenBot macOS companion (menu bar app + IPC library).

import PackageDescription

let package = Package(
    name: "OpenBot",
    platforms: [
        .macOS(.v15),
    ],
    products: [
        .library(name: "OpenBotIPC", targets: ["OpenBotIPC"]),
        .library(name: "OpenBotDiscovery", targets: ["OpenBotDiscovery"]),
        .executable(name: "OpenBot", targets: ["OpenBot"]),
        .executable(name: "openbot-mac", targets: ["OpenBotMacCLI"]),
    ],
    dependencies: [
        .package(url: "https://github.com/orchetect/MenuBarExtraAccess", exact: "1.3.0"),
        .package(url: "https://github.com/swiftlang/swift-subprocess.git", from: "1.0.2"),
        .package(url: "https://github.com/apple/swift-log.git", from: "1.8.0"),
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.8.1"),
        .package(url: "https://github.com/steipete/Peekaboo.git", revision: "8d5e638e6ac9e93fae7d8dcb2ac0a0f01f3d49ec"),
        .package(path: "../shared/OpenBotKit"),
        .package(path: "../../Swabble"),
    ],
    targets: [
        .target(
            name: "OpenBotIPC",
            dependencies: [],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .target(
            name: "OpenBotDiscovery",
            dependencies: [
                .product(name: "OpenBotKit", package: "OpenBotKit"),
            ],
            path: "Sources/OpenBotDiscovery",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "OpenBot",
            dependencies: [
                "OpenBotIPC",
                "OpenBotDiscovery",
                .product(name: "OpenBotKit", package: "OpenBotKit"),
                .product(name: "OpenBotChatUI", package: "OpenBotKit"),
                .product(name: "OpenBotProtocol", package: "OpenBotKit"),
                .product(name: "SwabbleKit", package: "swabble"),
                .product(name: "MenuBarExtraAccess", package: "MenuBarExtraAccess"),
                .product(name: "Subprocess", package: "swift-subprocess"),
                .product(name: "Logging", package: "swift-log"),
                .product(name: "Sparkle", package: "Sparkle"),
                .product(name: "PeekabooBridge", package: "Peekaboo"),
                .product(name: "PeekabooAutomationKit", package: "Peekaboo"),
            ],
            path: "Sources/OpenBot",
            exclude: [
                "Resources/Info.plist",
            ],
            resources: [
                .copy("Resources/OpenBot.icns"),
                .copy("Resources/OpenBotAuthLogo.png"),
                .copy("Resources/DeviceModels"),
            ],
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .executableTarget(
            name: "OpenBotMacCLI",
            dependencies: [
                "OpenBotDiscovery",
                .product(name: "OpenBotKit", package: "OpenBotKit"),
                .product(name: "OpenBotProtocol", package: "OpenBotKit"),
            ],
            path: "Sources/OpenBotMacCLI",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
            ]),
        .testTarget(
            name: "OpenBotTests",
            dependencies: [
                "OpenBotIPC",
                "OpenBot",
                "OpenBotDiscovery",
                .product(name: "OpenBotProtocol", package: "OpenBotKit"),
                .product(name: "SwabbleKit", package: "swabble"),
            ],
            path: "Tests/OpenBotTests",
            swiftSettings: [
                .enableUpcomingFeature("StrictConcurrency"),
                .enableExperimentalFeature("SwiftTesting"),
            ]),
    ])
