// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Antimatter",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Antimatter", targets: ["AntimatterApp"]),
    ],
    dependencies: [
        .package(url: "https://github.com/gonzalezreal/swift-markdown-ui", from: "2.4.1"),
        .package(url: "https://github.com/sergius-la/SwiftEmojiPicker", from: "2.2.1"),
    ],
    targets: [
        .target(
            name: "AntimatterFoundation",
            path: "Sources/AntimatterFoundation"
        ),
        .executableTarget(
            name: "AntimatterApp",
            dependencies: [
                "AntimatterFoundation",
                .product(name: "MarkdownUI", package: "swift-markdown-ui"),
                .product(name: "SwiftEmojiPicker", package: "SwiftEmojiPicker"),
            ],
            path: "Sources/AntimatterApp"
        ),
        .testTarget(
            name: "AntimatterFoundationTests",
            dependencies: ["AntimatterFoundation"],
            path: "NativeTests/AntimatterFoundationTests"
        ),
    ]
)
