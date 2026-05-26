# TODOs

## Product Decisions

- [ ] Confirm left/right eye behavior for v1. Current protocol evidence covers a
  single traced side mirrored as both eyes; true independent left/right transfer
  remains unverified.
- [ ] Decide the production hosting target for the static app so HTTPS and Web
  Serial permissions work correctly.

## Implementation

- [x] Scaffold the React, TypeScript, Vite, Tailwind CSS, and shadcn/ui app.
- [x] Implement Web Serial support detection and unsupported-browser UI.
- [x] Implement serial port selection, opening, closing, and signal setup.
- [x] Implement the Nidek LT-900 `STD` native protocol state machine.
- [x] Implement byte-queue reading that tolerates byte-at-a-time serial delivery.
- [x] Implement native frame checksum-byte stripping and 1000-point trace decoding.
- [x] Implement trace geometry, statistics, and metadata calculation.
- [x] Implement the trace preview from decoded polar radii.
- [x] Implement client-side OMA generation for 400-point and 1000-point exports.
- [x] Make the 400-point OMA the primary download and the 1000-point OMA a
  secondary download.
- [x] Add trace failure states for timeout, missing ACK, short frame, and invalid
  frame marker.

## Verification

- [ ] Test against the Nidek LT-900 `STD` tracer through a supported Chromium
  browser.
- [ ] Verify DTR and RTS assertion through Web Serial on the target USB serial
  adapter.
- [ ] Verify generated 400-point and 1000-point OMA files with downstream optical
  software.
- [ ] Verify the preview shape has no transport-byte-induced jumps near 128/129
  byte boundaries.
- [x] Run a production build.
- [x] Smoke-check the app in the browser at desktop and narrow viewport widths.
