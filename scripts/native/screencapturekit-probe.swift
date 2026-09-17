import Foundation
import CoreGraphics
import ScreenCaptureKit

// Isolated developer probe, not linked into ScreenHello. Never writes image bytes,
// source names, window titles or native identifiers to disk or stdout.
@main
struct ScreenCaptureKitProbe {
    static func report(_ value: [String: Any], code: Int32) -> Never {
        if let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
           let text = String(data: data, encoding: .utf8) {
            print(text)
        }
        exit(code)
    }

    static func main() async {
        guard CommandLine.arguments.dropFirst().elementsEqual(["--capture-main-display"]) else {
            report(["status": "capture-consent-required"], code: 2)
        }
        guard CGPreflightScreenCaptureAccess() || CGRequestScreenCaptureAccess() else {
            report(["status": "system-permission-required"], code: 2)
        }
        do {
            let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
            guard let display = content.displays.first(where: { $0.displayID == CGMainDisplayID() }) else {
                report(["status": "primary-display-unavailable"], code: 2)
            }
            let width = CGDisplayPixelsWide(display.displayID)
            let height = CGDisplayPixelsHigh(display.displayID)
            let (pixels, overflow) = width.multipliedReportingOverflow(by: height)
            guard width > 0, height > 0, !overflow, pixels <= 7680 * 4320 else {
                report(["status": "pixel-budget-exceeded"], code: 2)
            }
            let filter = SCContentFilter(display: display, excludingWindows: [])
            let configuration = SCStreamConfiguration()
            configuration.width = width
            configuration.height = height
            configuration.showsCursor = false
            configuration.capturesAudio = false
            let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: configuration)
            guard image.width == width, image.height == height else {
                report(["status": "capture-dimensions-mismatch"], code: 2)
            }
            report([
                "status": "passed", "backend": "screencapturekit",
                "width": image.width, "height": image.height,
                "imageBytesPersisted": false
            ], code: 0)
        } catch {
            // Native error descriptions can contain source titles or local paths.
            report(["status": "capture-failed"], code: 2)
        }
    }
}
