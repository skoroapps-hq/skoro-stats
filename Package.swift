// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "SkoroStats",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "SkoroStats", targets: ["SkoroStats"])],
    targets: [
        // The privacy manifest Apple asks SDKs for: no tracking, usage data not linked to anyone.
        .target(name: "SkoroStats", resources: [.copy("PrivacyInfo.xcprivacy")]),
        .testTarget(name: "SkoroStatsTests", dependencies: ["SkoroStats"]),
    ]
)
