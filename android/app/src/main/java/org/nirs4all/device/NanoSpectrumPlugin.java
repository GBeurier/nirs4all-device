package org.nirs4all.device;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.lang.reflect.Method;

@CapacitorPlugin(name = "NanoSpectrum")
public class NanoSpectrumPlugin extends Plugin {
    private static final String KST_SDK_CLASS = "com.kstechnologies.nirscannanolibrary.KSTNanoSDK";

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject out = new JSObject();
        try {
            Class.forName(KST_SDK_CLASS);
            out.put("available", true);
        } catch (ClassNotFoundException error) {
            out.put("available", false);
            out.put("reason", "KST/TI nirscannanolibrary.aar is not bundled in android/app/libs.");
        }
        call.resolve(out);
    }

    @PluginMethod
    public void interpretReference(PluginCall call) {
        try {
            byte[] scanData = decodeBase64(call, "scanDataBase64");
            byte[] referenceCoefficients = decodeBase64(call, "referenceCoefficientsBase64");
            byte[] referenceMatrix = decodeBase64(call, "referenceMatrixBase64");

            Class<?> sdk = Class.forName(KST_SDK_CLASS);
            Method interpret = sdk.getMethod(
                "KSTNanoSDK_dlpSpecScanInterpReference",
                byte[].class,
                byte[].class,
                byte[].class
            );
            Object result = interpret.invoke(null, scanData, referenceCoefficients, referenceMatrix);
            if (result == null) {
                call.reject("Spectrum C returned no scan result.");
                return;
            }

            Class<?> resultClass = result.getClass();
            double[] wavelength = (double[]) resultClass.getMethod("getWavelength").invoke(result);
            int[] referenceIntensity = (int[]) resultClass.getMethod("getIntensity").invoke(result);
            int[] uncalibratedIntensity = (int[]) resultClass.getMethod("getUncalibratedIntensity").invoke(result);
            int length = (Integer) resultClass.getMethod("getLength").invoke(result);
            int n = Math.min(length, Math.min(wavelength.length, Math.min(referenceIntensity.length, uncalibratedIntensity.length)));

            JSArray axis = new JSArray();
            JSArray intensity = new JSArray();
            JSArray reflectance = new JSArray();
            JSArray absorbance = new JSArray();
            for (int i = 0; i < n; i += 1) {
                double ref = referenceIntensity[i];
                double sample = uncalibratedIntensity[i];
                double ratio = ref == 0.0 ? Double.NaN : sample / ref;
                axis.put(wavelength[i]);
                intensity.put(sample);
                reflectance.put(ratio);
                absorbance.put(ratio > 0.0 ? -Math.log10(ratio) : Double.NaN);
            }

            JSObject out = new JSObject();
            out.put("axis", axis);
            out.put("intensity", intensity);
            out.put("reflectance", reflectance);
            out.put("absorbance", absorbance);
            out.put("axisUnit", "nm");
            out.put("length", n);
            call.resolve(out);
        } catch (Exception error) {
            call.reject("Nano Spectrum C interpretation failed: " + rootMessage(error), error);
        }
    }

    private byte[] decodeBase64(PluginCall call, String key) {
        String value = call.getString(key);
        if (value == null || value.isEmpty()) {
            throw new IllegalArgumentException("Missing " + key);
        }
        return Base64.decode(value, Base64.DEFAULT);
    }

    private String rootMessage(Throwable error) {
        Throwable cursor = error;
        while (cursor.getCause() != null) cursor = cursor.getCause();
        return cursor.getMessage() == null ? cursor.getClass().getSimpleName() : cursor.getMessage();
    }
}
