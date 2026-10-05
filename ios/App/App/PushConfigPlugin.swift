import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

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
/// `isConfigured` also answers `tokenTransport: "fcm"` (86exxuvye): this build's
/// AppDelegate hands the web app the FCM registration token, never the raw APNs
/// device token. The web app turns iOS push on only when it sees this, so a shell
/// that predates it stays `unsupported` instead of storing an APNs token that
/// push-dispatch (FCM only) could never deliver to.
///
/// `invalidateToken` is the iOS half of the Android plugin's `unregister()`
/// (auto-init off + `deleteToken`): @capacitor/push-notifications' iOS
/// `unregister()` only drops the APNs registration, which leaves the FCM token
/// alive. Called by the web app on Profile "off" and on sign-out.
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
        CAPPluginMethod(name: "getLaunchTarget", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "invalidateToken", returnType: CAPPluginReturnPromise)
    ]

    @objc func isConfigured(_ call: CAPPluginCall) {
        call.resolve(["configured": FirebaseApp.app() != nil, "tokenTransport": "fcm"])
    }

    @objc func invalidateToken(_ call: CAPPluginCall) {
        guard FirebaseApp.app() != nil else {
            call.resolve()
            return
        }
        let messaging = Messaging.messaging()
        messaging.isAutoInitEnabled = false
        AppDelegate.lastForwardedFcmToken = nil
        messaging.deleteToken { _ in
            // Best effort, like Android's fire-and-forget deleteToken(): the server
            // row delete is what stops dispatch; this only makes the token itself dead.
            call.resolve()
        }
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
