package app.plusone.guestlist;

import android.app.Activity;
import android.content.Intent;
import android.os.Bundle;
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
 *
 * `getLaunchTarget` (86ey6bfkb, cold-start tap): the notification tap that launched
 * this activity, read straight from the launch Intent. The push plugin only hands
 * the same tap to the web app once its own lazy chunk, Firebase check and channel
 * are done, which is after the shell has painted Home; this is one bridge call, so
 * the shell can route before its first screen. Only the three payload keys travel
 * (the web side validates them again) plus the message id for dedupe. Each message
 * is handed out once per process, so a web reload (venue switch) or an activity
 * re-creation does not open it again.
 */
@CapacitorPlugin(name = "PlusOnePushConfig")
public class PushConfigPlugin extends Plugin {

    private static final String FCM_MESSAGE_ID = "google.message_id";
    private static final String[] PAYLOAD_KEYS = { "kind", "venue_id", "event_id" };

    /** Static: survives an activity re-creation within the same process. */
    private static String lastTakenMessageId = null;

    @PluginMethod
    public void isConfigured(PluginCall call) {
        int id = getContext().getResources().getIdentifier("google_app_id", "string", getContext().getPackageName());
        JSObject result = new JSObject();
        result.put("configured", id != 0);
        call.resolve(result);
    }

    @PluginMethod
    public void getLaunchTarget(PluginCall call) {
        JSObject result = new JSObject();
        Activity activity = getActivity();
        Intent intent = activity != null ? activity.getIntent() : null;
        Bundle extras = intent != null ? intent.getExtras() : null;
        String messageId = extras != null ? extras.getString(FCM_MESSAGE_ID) : null;
        synchronized (PushConfigPlugin.class) {
            if (messageId != null && !messageId.equals(lastTakenMessageId)) {
                lastTakenMessageId = messageId;
                JSObject data = new JSObject();
                for (String key : PAYLOAD_KEYS) {
                    Object value = extras.get(key);
                    if (value instanceof String) data.put(key, value);
                }
                result.put("id", messageId);
                result.put("data", data);
            }
        }
        call.resolve(result);
    }
}
