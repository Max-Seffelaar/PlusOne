import UIKit
import Capacitor
import FirebaseCore
import FirebaseMessaging

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        AppDelegate.excludeWebDataFromBackup()
        AppDelegate.configureFirebaseIfPresent()
        return true
    }

    /// Push (Fase 17 S1b): FCM on iOS needs a default FirebaseApp, configured from
    /// `GoogleService-Info.plist` (copied into the bundle by the "Copy
    /// GoogleService-Info.plist (if present)" build phase). Without the file
    /// `FirebaseApp.configure()` would abort the app, so a build without it simply
    /// has no Firebase: `PlusOnePushConfig.isConfigured` answers false and the web
    /// app never asks for push.
    static func configureFirebaseIfPresent() {
        guard FirebaseApp.app() == nil else { return }
        guard Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil else {
            NSLog("PlusOne: GoogleService-Info.plist missing - push disabled in this build")
            return
        }
        FirebaseApp.configure()
        // Token rotation (86exxuvye): FCM reports a new or refreshed token here.
        // Setting the delegate fetches nothing by itself; with auto-init off
        // (Info.plist) no token exists until the person opts in.
        Messaging.messaging().delegate = shared
    }

    /// The delegate must outlive `configureFirebaseIfPresent` (Messaging holds it
    /// weakly), and the AppDelegate instance is not reachable from a static method.
    private static let shared = FcmTokenForwarder()

    /// The last FCM token handed to the web app: a rotation callback for a token
    /// the web app already has is not forwarded twice.
    static var lastForwardedFcmToken: String?

    /// Hands an FCM registration token to @capacitor/push-notifications, which
    /// emits it to JS as its `registration` event (a `String` object is passed
    /// through as-is; only a `Data` object would be hex-encoded as an APNs token).
    static func forwardFcmToken(_ token: String) {
        lastForwardedFcmToken = token
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: token)
    }

    /// APNs handed us a device token. push-dispatch only speaks FCM (plan decision 1),
    /// so it goes to Firebase Messaging, and the FCM registration token (not the raw
    /// APNs token) is what reaches @capacitor/push-notifications' `registration`
    /// event, as the plugin documents for FCM on iOS.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        guard FirebaseApp.app() != nil else {
            NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications,
                                            object: NSError(domain: "PlusOnePush", code: 1,
                                                            userInfo: [NSLocalizedDescriptionKey: "Firebase is not configured in this build"]))
            return
        }
        // Reaching this method IS the opt-in: APNs registration only starts from
        // the web app's register() (ask card / Profile / an account that already
        // said yes). From here on FCM may keep its token fresh across launches, so
        // rotations reach the delegate below. Persisted by Firebase; turned off
        // again by `PlusOnePushConfig.invalidateToken` on "off" / sign-out (the
        // Android plugin does the same in register()/unregister()).
        Messaging.messaging().isAutoInitEnabled = true
        Messaging.messaging().apnsToken = deviceToken
        Messaging.messaging().token { token, error in
            if let error = error {
                NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
            } else if let token = token {
                AppDelegate.forwardFcmToken(token)
            }
        }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    /// Keeps the webview's session cookies and the door's IndexedDB snapshot
    /// (guest PII) out of iCloud/Finder backups: the iOS counterpart of Android's
    /// `allowBackup="false"` + `data_extraction_rules.xml` (CLAUDE.md device-storage
    /// rule, 86ey6bfdm). WKWebView keeps website data (IndexedDB, localStorage,
    /// cookies) under `Library/WebKit`; `Library/Cookies` and `Library/HTTPStorages`
    /// hold the `HTTPCookieStorage.shared` mirror Capacitor's cookie observer writes.
    /// `Library/Caches` is never backed up. The flag on a directory covers its
    /// contents; it is re-applied on every launch because the system can reset it
    /// and WebKit may recreate its directories, and again each time the scene
    /// enters the background (`SceneDelegate.sceneDidEnterBackground`): with the
    /// UIScene lifecycle `applicationDidEnterBackground` never fires, and backups
    /// run overnight while the app is suspended, not relaunched. Idempotent and
    /// cheap (three existing directories, one attribute write each). Apple treats
    /// it as guidance for backups, not a guarantee (see
    /// `URLResourceValues.isExcludedFromBackup`).
    static func excludeWebDataFromBackup() {
        let fileManager = FileManager.default
        guard let library = fileManager.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        for name in ["WebKit", "Cookies", "HTTPStorages"] {
            var directory = library.appendingPathComponent(name, isDirectory: true)
            do {
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
                var values = URLResourceValues()
                values.isExcludedFromBackup = true
                try directory.setResourceValues(values)
            } catch {
                NSLog("PlusOne: could not exclude Library/%@ from backup: %@", name, error.localizedDescription)
            }
        }
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}

/// FCM token rotation (86exxuvye). Firebase calls this when it creates or refreshes
/// the registration token (also once per launch with the current one while
/// auto-init is on). A new token goes to the web app through the same
/// `registration` event as the opt-in path, where push-client's persistent
/// `onRegistration` listener upserts it into `push_tokens` — only while push is
/// 'on' on this device, so nothing is stored after "off" or sign-out.
///
/// Opt-in stays explicit: auto-init is off until the APNs registration above
/// (Info.plist `FirebaseMessagingAutoInitEnabled=false`), so before the person
/// says yes Firebase has no token and this is never called.
final class FcmTokenForwarder: NSObject, MessagingDelegate {
    func messaging(_ messaging: Messaging, didReceiveRegistrationToken fcmToken: String?) {
        guard let token = fcmToken, !token.isEmpty else { return }
        guard messaging.isAutoInitEnabled else { return }
        guard token != AppDelegate.lastForwardedFcmToken else { return }
        AppDelegate.forwardFcmToken(token)
    }
}
