package org.nirs4all.device;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NanoSpectrumPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
