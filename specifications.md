# Web Frame Tracing Software Specification

## Goal

Build a web-based frame tracing application that connects directly to a
Nidek LT-900 frame tracer in `STD` mode, captures a frame trace over a serial
connection, previews the traced shape, and exports an OMA file.

## Confirmed Product Scope

- The application is browser-only. There is no backend, local daemon, native
  bridge, or Node serial service in v1.
- The application uses the Web Serial API for direct serial communication from
  the browser.
- The frontend stack is React, TypeScript, Vite, Tailwind CSS, and shadcn/ui.
- The supported tracer for v1 is the Nidek LT-900 in `STD` mode using the
  native serial protocol documented in
  `examples/nidek-lt900-std-native-protocol.md`.
- The initial browser target is desktop Chromium-based browsers that support
  Web Serial, such as Chrome and Edge.
- Unsupported browsers must show a clear unsupported-browser state when
  `navigator.serial` is unavailable.
- The app must run from a secure context: `localhost` during development and
  HTTPS in production.

## User Workflow

1. The user opens the web app in a supported desktop browser.
2. The app checks Web Serial support.
3. The user clicks a connect action and selects the USB serial adapter exposed
   by the browser.
4. The app opens the serial port with the LT-900 settings.
5. The user starts a trace read from the app.
6. The app performs the LT-900 native handshake and receives the trace payload.
7. The app decodes the trace data client-side.
8. The app displays a preview of the traced shape.
9. After a successful trace, the app allows the user to download an OMA file.

## Serial Connection

The app must request a port through the Web Serial API and open it with these
settings:

| Setting | Value |
| --- | --- |
| Baud | `9600` |
| Data bits | `8` |
| Parity | `none` |
| Stop bits | `1` |
| Hardware flow control | `off` |
| Software flow control | `off` |
| DTR | asserted high |
| RTS | asserted high |

The serial reader must tolerate byte-at-a-time delivery. It must not assume
that protocol units arrive in a single read.

## LT-900 Native Protocol

The app implements only the Nidek LT-900 `STD` native protocol for v1.

The host initiates communication. Passive listening is not sufficient on the
verified unit.

High-level read sequence:

1. Send `ENQ` (`05`).
2. Require tracer `ACK` (`06`).
3. Send native read command `52 00 00 09 5b`.
4. Require tracer `ACK`.
5. Send `EOT` (`04`).
6. Receive tracer `ENQ`; send `ACK`.
7. Receive status command byte `52`; send `ACK`.
8. Receive status bytes `00 00`; send `ACK`.
9. Receive status bytes `00 52`; send `ACK`.
10. Receive native frame payload beginning with a plausible LT-900 native
    header, currently observed as `46 01 ...` or `46 02 ...`.
11. For each 129-byte transport block, append the first 128 bytes to the
    native frame, discard the 129th transport/check byte, and send `ACK`.

End-of-transfer handling must be conservative because `04` can appear inside
binary data. Treat `EOT` as the end only when it appears outside a full
129-byte transport block or after the expected frame data has been received.

## Trace Decoding

The native frame starts with a native payload marker and mode/side byte:

```text
46 01 ...
46 02 ...
```

The next bytes can vary between captures. The app should validate a plausible
header instead of requiring one fixed byte sequence. Observed examples include
`46 01 30 41` and `46 01 29 43`.

Before decoding, remove every 129th byte from the payload stream, counting the
`46` payload marker as byte 1. The 129th byte is transport framing, not trace
data.

The minimum clean frame length for the basic trace is `0x3ef` bytes.

Decoded trace data:

- The trace contains 1000 equiangular polar radius samples.
- Units are hundredths of a millimeter (`0.01 mm`).
- The first radius is an unsigned big-endian 16-bit value at offsets
  `0x006..0x007`.
- Remaining radii are derived from signed 1-byte deltas at offsets
  `0x008..0x3ee`.

Header plausibility checks should include:

- byte `0x000` is `46`
- byte `0x001` is `01` or `02`
- byte `0x003` gives a reasonable frame curve when divided by 10
- bytes `0x006..0x007` give a reasonable first radius

Metadata derived from the native frame and decoded radii:

- `FCRV`: `frame[0x003] / 10`
- `HBOX`: computed from decoded polar radii
- `VBOX`: computed from decoded polar radii
- `CIRC`: computed from decoded polar radii
- `DBL`: native center distance minus `HBOX`

The native center distance is read from offsets `0x004..0x005` as an unsigned
big-endian 16-bit value in hundredths of a millimeter.

## Preview

After a successful decode, the app must show a visual preview of the traced
shape before download.

The preview should be generated from the decoded polar radii by converting
each radius to Cartesian coordinates using equal angular spacing around the
closed trace.

The preview should also show useful trace metadata, including at least:

- point count
- `HBOX`
- `VBOX`
- `DBL`
- `CIRC`
- `FCRV`

## OMA Export

After a successful trace, the app must generate the OMA file client-side and
offer it as a browser download.

Base records:

```text
REQ=TRC
VEN=Nidek
MODEL=LT-900
```

Trace records must include:

- `HBOX`
- `VBOX`
- `DBL`
- `CIRC`
- `FCRV`
- `TRCFMT`
- radius record `R`

The native trace is 1000 points. The app must preserve the 1000-point decoded
trace internally.

The app must generate both 400-point and 1000-point OMA outputs:

- The 400-point OMA is the primary/default download.
- The 1000-point OMA is available as a secondary download from the result
  details.
- The 400-point trace is created by resampling the closed 1000-point polar
  radius sequence to 400 equiangular points.

## Suggested Client Modules

- Web Serial transport
- LT-900 protocol state machine
- native frame decoder
- trace geometry and statistics
- OMA writer
- React UI components

## Open Decisions

- Left/right eye behavior: v1 protocol evidence currently covers a single
  traced side mirrored as both eyes. Confirm whether that is acceptable for
  initial output.
- Production deployment target: decide where the static app will be hosted so
  HTTPS and Web Serial permissions work correctly.
