# Repository Guidelines

## Project Structure

`src/device/` owns spectrometer transports and adapters. `src/runtime/` owns thin calls into
the nirs4all portable JS/WASM surface. `src/storage/` owns IndexedDB persistence and exports.
`src/app/` owns React state and UI. Keep NIRS parsing, dataset assembly, and numerical methods in
the sibling nirs4all ecosystem packages.

## Commands

Use Node from nvm, preferably Node 24:

```bash
export PATH="$HOME/.nvm/versions/node/v22.21.1/bin:$PATH"
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

For native shells:

```bash
npm run build
npm run cap:sync
npm run cap:android
npm run cap:ios
```

## Architecture Rules

- Device-specific bytes stay behind `SpectrometerDevice` adapters.
- BLE/USB transports do not know NIRS semantics.
- Do not reimplement nirs4all parsing or ML. Use `nirs4all`, `nirs4all-ui`, and the staged
  `@nirs4all/methods` WASM alias.
- Captured raw Nano payloads remain raw until a nirs4all-formats/Nano parser is available.
- UI code must remain usable with the simulator, so the app can be tested without hardware.

## Testing

Add focused Vitest coverage for ports, packet handling, storage/export transforms, quality gates,
and inference bundle parsing. Hardware tests should be manual or gated because CI has no NIRS device.
