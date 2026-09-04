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
        .package(url: "https://github.com/danielsaidi/EmojiKit.git", from: "2.5.0"),
        .package(url: "https://github.com/klaaspieter/swift-emoji", from: "0.1.0"),
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
                .product(name: "EmojiKit", package: "EmojiKit"),
                .product(name: "EmojiData", package: "swift-emoji"),
            ],
            path: "Sources/AntimatterApp"
        ),
        .testTarget(
            name: "AntimatterFoundationTests",
            dependencies: [
                "AntimatterFoundation",
                .product(name: "EmojiData", package: "swift-emoji"),
            ],
            path: "NativeTests/AntimatterFoundationTests"
        ),
    ]
)
