// One-off probe: what does iPhone answer when an app asks whether it can open a map link, and
// when it then opens it? Results go to Documents/result.txt (read back by the workflow).
import SwiftUI
import UIKit

@MainActor
func log(_ s: String) {
    print(s); fflush(stdout)
    let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("result.txt")
    let line = (s + "\n").data(using: .utf8)!
    if let h = try? FileHandle(forWritingTo: url) {
        h.seekToEndOfFile(); h.write(line); try? h.close()
    } else {
        try? line.write(to: url)
    }
}

@MainActor
func stateName() -> String {
    switch UIApplication.shared.applicationState {
    case .active: return "active"
    case .inactive: return "inactive"
    case .background: return "background"
    @unknown default: return "unknown"
    }
}

@MainActor
func openURL(_ u: URL, _ opts: [UIApplication.OpenExternalURLOptionsKey: Any]) async -> Bool {
    await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
        UIApplication.shared.open(u, options: opts) { ok in c.resume(returning: ok) }
    }
}

@MainActor
func runProbe() async {
    let bg = UIApplication.shared.beginBackgroundTask(expirationHandler: nil)
    let args = Array(ProcessInfo.processInfo.arguments.dropFirst())
    log("--- launch, iOS \(UIDevice.current.systemVersion), args: \(args)")
    try? await Task.sleep(nanoseconds: 2_000_000_000)
    log("state before: \(stateName())")
    for s in ["maps://", "comgooglemaps://", "waze://"] {
        if let u = URL(string: s) { log("canOpenURL \(s) = \(UIApplication.shared.canOpenURL(u))") }
    }
    for a in args {
        var opts: [UIApplication.OpenExternalURLOptionsKey: Any] = [:]
        var s = a
        if a.hasPrefix("UL:") { s = String(a.dropFirst(3)); opts[.universalLinksOnly] = true }
        guard let u = URL(string: s) else { log("bad url \(s)"); continue }
        let t0 = Date()
        let ok = await openURL(u, opts)
        log("open \(a) -> \(ok) after \(Int(Date().timeIntervalSince(t0) * 1000)) ms, state \(stateName())")
        try? await Task.sleep(nanoseconds: 2_500_000_000)
        log("state 2.5 s later: \(stateName())")
    }
    log("done")
    UIApplication.shared.endBackgroundTask(bg)
}

struct ProbeView: View {
    var body: some View {
        Text("Map link probe").task { await runProbe() }
    }
}

@main
struct ProbeApp: App {
    var body: some Scene {
        WindowGroup { ProbeView() }
    }
}
