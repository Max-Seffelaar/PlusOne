import UIKit
import Capacitor
import FirebaseCore

/// iOS counterpart of `android/…/PushConfigPlugin.java` (Fase 17 S1b): tells the web
/// app whether Firebase is configured in THIS build, under the same JS name
/// (`PlusOnePushConfig`) `src/features/notifications/capacitor-provider.ts` asks
/// before it touches the push plugin.
///
/// `isConfigured` is exactly "AppDelegate ran `FirebaseApp.configure()`", which it
/// only does when `GoogleService-Info.plist` is in the bundle. Without it,
/// `Messaging.messaging()` would crash the app, so the AppDelegate never reaches it
/// and the web side gets `configured: false` (no push, no crash).
///
/// `getLaunchTarget` always answers `{}` on iOS: a cold-start notification tap
/// reaches the web app through the push plugin's own
/// `pushNotificationActionPerformed` (iOS retains it until a listener consumes it),
/// so there is no launch Intent to read like on Android.
@objc(PushConfigPlugin)
public class PushConfigPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PushConfigPlugin"
    public let jsName = "PlusOnePushConfig"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isConfigured", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLaunchTarget", returnType: CAPPluginReturnPromise)
    ]

    @objc func isConfigured(_ call: CAPPluginCall) {
        call.resolve(["configured": FirebaseApp.app() != nil])
    }

    @objc func getLaunchTarget(_ call: CAPPluginCall) {
        call.resolve([:])
    }
}

/// The app's bridge view controller: Capacitor's own, plus the local plugin above.
/// Local (in-app) plugins are not discovered from `capacitor.config.json` on iOS;
/// they are registered here once the bridge exists.
class PlusOneBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PushConfigPlugin())
    }
}
