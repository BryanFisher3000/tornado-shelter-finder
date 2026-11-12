package com.surviveastorm.shelterfinder;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // this app's own native helpers (SasNativePlugin.java): the alert vibration
        registerPlugin(SasNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
