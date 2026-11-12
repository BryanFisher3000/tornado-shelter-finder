import UIKit
import Capacitor

/// The app's one screen: Capacitor's web view, plus this app's own native helpers.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(SasNativePlugin())
    }

    /// iPhone Duo: on its outside screen, and on the inside screen held sideways, the clock and battery
    /// sit in a strip down the right side, on top of the search bar, the menu button and Radar. Asking
    /// for the usual bar across the top gives the page the same top band it has on every other iPhone.
    @available(iOS 27.1, *)
    override var preferredVerticalBarBehavior: UIVerticalBarBehavior { .disabled }
}
