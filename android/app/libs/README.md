Place `nirscannanolibrary.aar` here to enable DLP NIRscan Nano Spectrum C decoding on Android.

The AAR is distributed through the historical TI/KST Nano SDK and contains TI Spectrum C native
code. It is not committed to this repository. The Android `NanoSpectrum` Capacitor plugin loads it
by reflection when present; web and CI builds remain open-source and portable without it.
