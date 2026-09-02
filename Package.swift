// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "Antimatter",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "Antimatter", targets: ["AntimatterApp"]),
    ],
    targets: [
        .target(
            name: "AntimatterFoundation",
            path: "Sources/AntimatterFoundation"
        ),
        .executableTarget(
            name: "AntimatterApp",
            dependencies: ["AntimatterFoundation"],
            path: "Sources/AntimatterApp"
        ),
        .testTarget(
            name: "AntimatterFoundationTests",
            dependencies: ["AntimatterFoundation"],
            path: "NativeTests/AntimatterFoundationTests"
        ),
    ]
)
