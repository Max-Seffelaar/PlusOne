package app.plusone.guestlist;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Tells the web app whether Firebase is configured in THIS build (Fase 17 N5, 86ey6bfkb).
 *
 * `@capacitor/push-notifications` calls `FirebaseMessaging.getInstance()` in
 * `register()`/`unregister()` without a guard. With no `google-services.json` in
 * `android/app/` there is no default FirebaseApp, that call throws, and Capacitor
 * rethrows it on the plugin thread: the whole app crashes. The web side
 * (`src/features/notifications/capacitor-provider.ts`) therefore asks this plugin
 * first and never touches the push plugin's Firebase paths when it says no.
 *
 * `google_app_id` is the string resource the google-services Gradle plugin
 * generates from that JSON, and the one Firebase's own auto-init reads, so its
 * presence is exactly "FirebaseApp will exist". No Firebase dependency here.
 */
@CapacitorPlugin(name = "PlusOnePushConfig")
public class PushConfigPlugin extends Plugin {

    @PluginMethod
    public void isConfigured(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("configured", id != 0);
        call.resolve(result);
    }
}
