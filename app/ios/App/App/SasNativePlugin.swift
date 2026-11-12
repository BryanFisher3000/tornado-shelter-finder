import UIKit
import AudioToolbox
import CoreHaptics
import Capacitor

/// Small native helpers the page can call (Capacitor plugin "SasNative"), registered by MainViewController.
@objc(SasNativePlugin)
public class SasNativePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SasNativePlugin"
    public let jsName = "SasNative"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openUniversalLink", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "vibrate", returnType: CAPPluginReturnPromise)
    ]

    private var haptics: CHHapticEngine?
    private struct NoHaptics: Error {}

    /// Opens an https link only in the app that owns it (Apple Maps for maps.apple.com) and answers
    /// { completed: true } when that app took it. When the app is not on the phone iPhone just answers
    /// no: nothing opens in the browser, and there is no "Restore Maps?" box (opening maps:// shows one).
    @objc func openUniversalLink(_ call: CAPPluginCall) {
        guard let text = call.getString("url"), let url = URL(string: text), url.scheme == "https" else {
            call.reject("An https link is required.")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [.universalLinksOnly: true]) { opened in
                call.resolve(["completed": opened])
            }
        }
    }

    /// Buzzes the phone now: for an alert that arrives while the app is open (a closed app gets
    /// iPhone's own notification buzz). pattern is [wait, buzz, pause, buzz, ...] in milliseconds,
    /// the same list Android takes.
    @objc func vibrate(_ call: CAPPluginCall) {
        let pattern = (call.getArray("pattern") ?? []).map { ($0 as? NSNumber)?.doubleValue ?? 0 }
        DispatchQueue.main.async {
            var events: [CHHapticEvent] = []
            var at: TimeInterval = 0
            for (i, ms) in pattern.enumerated() {
                let seconds = max(0, ms) / 1000
                if i % 2 == 1 && seconds > 0 {
                    events.append(CHHapticEvent(eventType: .hapticContinuous, parameters: [
                        CHHapticEventParameter(parameterID: .hapticIntensity, value: 1),
                        CHHapticEventParameter(parameterID: .hapticSharpness, value: 0.5)
                    ], relativeTime: at, duration: seconds))
                }
                at += seconds
            }
            guard !events.isEmpty else {
                call.resolve(["played": false])
                return
            }
            do {
                guard CHHapticEngine.capabilitiesForHardware().supportsHaptics else { throw NoHaptics() }
                if self.haptics == nil {
                    let engine = try CHHapticEngine()
                    engine.isAutoShutdownEnabled = true
                    // the system took the engine away (the app left the screen): make a new one next time
                    engine.resetHandler = { [weak self] in DispatchQueue.main.async { self?.haptics = nil } }
                    self.haptics = engine
                }
                guard let engine = self.haptics else { throw NoHaptics() }
                try engine.start()
                let player = try engine.makePlayer(with: CHHapticPattern(events: events, parameters: []))
                try player.start(atTime: CHHapticTimeImmediate)
                call.resolve(["played": true])
            } catch {
                // no pattern on this device (or right now): the plain single buzz
                self.haptics = nil
                AudioServicesPlaySystemSound(kSystemSoundID_Vibrate)
                call.resolve(["played": false])
            }
        }
    }
}
