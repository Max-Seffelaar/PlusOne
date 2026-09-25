import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        excludeWebDataFromBackup()
        return true
    }

    /// Keeps the webview's session cookies and the door's IndexedDB snapshot
    /// (guest PII) out of iCloud/Finder backups: the iOS counterpart of Android's
    /// `allowBackup="false"` + `data_extraction_rules.xml` (CLAUDE.md device-storage
    /// rule, 86ey6bfdm). WKWebView keeps website data (IndexedDB, localStorage,
    /// cookies) under `Library/WebKit`; `Library/Cookies` and `Library/HTTPStorages`
    /// hold the `HTTPCookieStorage.shared` mirror Capacitor's cookie observer writes.
    /// `Library/Caches` is never backed up. The flag on a directory covers its
    /// contents; it is re-applied on every launch because the system can reset it
    /// and WebKit may recreate its directories. Apple treats it as guidance for
    /// backups, not a guarantee (see `URLResourceValues.isExcludedFromBackup`).
    private func excludeWebDataFromBackup() {
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
