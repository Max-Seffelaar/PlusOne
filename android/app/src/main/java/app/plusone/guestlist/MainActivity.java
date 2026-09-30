package app.plusone.guestlist;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Local plugins must be registered before the bridge starts (N5: see PushConfigPlugin).
        registerPlugin(PushConfigPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
