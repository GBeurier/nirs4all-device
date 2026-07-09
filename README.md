# nirs4all-device

Cross-platform phone/tablet workbench for connected NIRS spectrometers. The first concrete target is
the **Texas Instruments DLP NIRscan Nano** over Bluetooth LE; the app also ships a simulator so the
full workflow can be exercised without hardware.

## Scope

- Connect to a NIRS device through a device adapter (`SpectrometerDevice`).
- Organize captures by project and session so field batches stay separated.
- Start scans, show spectra when numeric data is available, and store captures locally.
- Run repeated scans for the same sample by incrementing `metadata.repetition` instead of `sample_id`.
- Render the current scan with project/session q10-q90 quantile envelopes behind it.
- Preserve raw DLP NIRscan Nano payloads and decode them on Android when the TI/KST Spectrum C AAR
  is present.
- Run lightweight capture-quality gates and attach the report to every capture.
- Keep a project-level `.n4a` context. Fitted portable artifacts run automatically after every
  decoded scan; pipeline-definition-only artifacts are shown as loaded but not runnable.
- Export individual spectra as CSV, aligned matrices as CSV, metadata CSV, or a project JSON bundle.

## Architecture

```text
React/Vite UI
  -> SpectrometerDevice port
      -> simulator
      -> DLP NIRscan Nano BLE adapter
      -> USB/HID extension point
  -> IndexedDB capture store
  -> nirs4all portable JS/WASM runtime
  -> Android NanoSpectrum bridge for TI Spectrum C when bundled
  -> nirs4all-ui brand assets
```

The app deliberately does not parse vendor spectroscopy formats or reimplement numerical methods.
Vendor file readers belong to `nirs4all-formats`; dataset assembly belongs to `nirs4all-io`; ML and
portable inference belong to `nirs4all`, `dag-ml`, and `nirs4all-methods`.

## DLP NIRscan Nano status

The BLE adapter uses the TI GATT profile:

- Device Information Service, Battery Service
- General Information Service
- Date/Time Service
- Calibration Information Service
- Scan Configuration Information Service
- Scan Data Information Service

It can connect, sync time, read status/configuration metadata, trigger a scan, receive the scan
completion notification, fetch calibration coefficients/matrix, and fetch the serialized scan
payload via multipacket notifications.

On Android, add the historical TI/KST SDK AAR here to enable full numeric decode:

```text
android/app/libs/nirscannanolibrary.aar
```

The repository does not commit that proprietary AAR. The local `NanoSpectrum` Capacitor plugin loads
`com.kstechnologies.nirscannanolibrary.KSTNanoSDK` by reflection and returns wavelength, intensity,
reflectance, and absorbance arrays. Without the AAR, scans are still captured and stored with their
raw payload and an actionable note.

## Native vs web BLE

The app is a Capacitor app first. The web build is useful for deployment previews, responsive UX, the
simulator, export flows, and browsers that expose Web Bluetooth, but real field use on phones/tablets
should use the native Android/iOS shell with the Capacitor BLE plugin. Web Bluetooth is not available
in Safari/iOS, Firefox, and many embedded WebViews; seeing "Web Bluetooth API not available" in those
browsers is expected.

The current hardware adapters are:

- `simulator`: always available.
- `ble`: DLP NIRscan Nano through native Capacitor BLE, or Web Bluetooth where the browser supports it.
- `usb`: reserved adapter slot for future WebUSB/WebHID or native USB/OTG support.

## Installable builds

Android is the first installable target. The checked-in Capacitor Android project builds a debug APK
that can be sideloaded on phones/tablets for field testing:

```bash
npm run build
npm run cap:sync
cd android
./gradlew assembleDebug
```

GitHub Actions also publishes this APK as the `nirs4all-device-android-debug-apk` artifact from the
`Android APK` workflow on every push to `main` and on manual dispatch. This debug APK is installable
but not a store/release artifact.

iOS support is checked in as a Capacitor Xcode project under `ios/` with the BLE plugin wired and the
required Bluetooth permission strings. Producing an installable `.ipa` for iPhone/iPad still requires
macOS/Xcode plus Apple signing assets (`DEVELOPMENT_TEAM`, certificate, provisioning profile). Until
those signing secrets exist in CI, iOS is buildable from Xcode but not automatically distributed.

## Development

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

Native shell setup:

```bash
sudo apt install openjdk-17-jdk # or provide another Linux JDK 17
npm run build
npm run cap:sync
npm run cap:android
npm run cap:ios
```

The checked-in Android project builds without the proprietary Nano AAR, but the local environment
must provide a Linux JDK 17 because Android Gradle Plugin 8 requires it.

## GitHub Pages / deployment

The static web build is `dist/`. Pushes to `main` publish GitHub Pages through `.github/workflows/pages.yml`.
The deployed custom domain is:

```text
device.nirs4all.org
```

The Vite base is relative, so the same artifact also works from `https://gbeurier.github.io/nirs4all-device/`
when GitHub Pages exposes the project fallback URL.

## License

`nirs4all-device` follows the ecosystem license:

**`CeCILL-2.1 OR AGPL-3.0-or-later`**, with an optional commercial license path. See
[`LICENSING.md`](LICENSING.md), [`LICENSE`](LICENSE), and [`LICENSES/`](LICENSES/).
