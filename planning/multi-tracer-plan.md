# Multi-Tracer Plan

## Goal

Extend live tracer capture beyond the existing Nidek LT-900 path while keeping
tracer I/O in the web client and preserving enough field evidence to debug and
replay protocol issues locally.

The first expansion milestone is serial OMA capture over Web Serial. It is the
highest-coverage browser-direct path to add before proprietary serial protocols.

## Product Decisions

- Tracer communication runs directly in the browser. Do not add a local daemon,
  native bridge, or Node serial service between the web app and a tracer.
- The first new live transport is Web Serial only.
- LAN tracer variants are listed in the product catalog but are not runnable in
  the first milestone.
- Native USB tracer variants are listed in the product catalog but are not
  runnable in the first milestone. WebUSB investigation is deferred.
- Object storage is the first persistence layer for trace evidence and
  diagnostics. Database-backed indexing is deferred until the product needs
  queryable trace history, customer/shop records, or operational dashboards.

## First Milestone

The first multi-tracer milestone must:

1. Introduce a live tracer driver boundary around the existing capture flow.
2. Keep the current Nidek LT-900 driver working.
3. Add serial OMA host communication over Web Serial.
4. Normalize captured live trace data into the existing preview, editor, and
   OMA export flow.
5. Add protocol simulation and transcript replay support so new drivers can be
   exercised without physical hardware.
6. Capture field evidence for both successful and failed tracer sessions.

Live OMA communication is separate from opening or exporting `.oma` files. The
OMA serial driver must implement its communication state machine, framing,
checksum handling, format negotiation, trace receipt, acknowledgements, and
payload parsing explicitly.

## Device Catalog

The operator-facing device picker is manufacturer and model based. It must not
ask normal users to choose internal protocol family names.

- Source the initial device catalog from a versioned local file in the app.
- Keep internal profile mappings explicit and testable.
- Include all known device and connection variants in the catalog.
- Keep connection variants separate when they change feasibility or behavior,
  for example serial, LAN, and native USB variants of the same model.
- Every catalog entry is selectable.
- Resolve support state after selection.
- Runnable browser-direct entries show their connection flow.
- Entries without an implemented browser-direct driver show `Not supported yet`
  after selection.
- Record unsupported-device selections as demand signals so protocol priorities
  can be ranked from product use.

Initial support states:

| State | Meaning |
| --- | --- |
| `Tested` | Verified with hardware or accepted field transcript evidence. |
| `Expected to work` | A browser-direct driver and profile mapping exist, but the model is not verified yet. |
| `Not supported yet` | The catalog entry exists, but no runnable browser-direct driver exists yet. |

The initial runnable catalog slice is:

- the existing Nidek LT-900 serial path;
- serial OMA profiles handled by the new OMA Web Serial driver.

Other serial protocol families, LAN variants, and native USB variants remain
selectable but not runnable until their driver and browser transport path exist.

## Operator Workflow

Normal users should:

1. Select manufacturer and model.
2. See whether the selected device can be connected now.
3. Connect the expected browser-direct device path when available.
4. Capture, preview, edit, and export a trace.

Serial settings are profile-driven. Baud rate, parity, stop bits, flow control,
and signal overrides belong in support or diagnostics mode, not the normal
optician workflow. Any override used for a capture must be persisted in the
session evidence.

The current diagnostics mode is enabled with the `tracerDiagnostics` URL query
parameter. It exposes serial overrides, transcript replay from
`communication.ndjson`, and the local OMA simulator without adding those
controls to the normal operator flow.

## Driver Architecture

Drivers should depend on a transport interface, not directly on the browser
serial implementation. The same driver logic must be runnable through:

- the live Web Serial transport;
- a protocol simulator transport;
- a transcript replay transport.

Cross-driver infrastructure should own:

- protocol event capture;
- RX/TX transcript recording;
- session outcome recording;
- raw payload collection;
- replay artifact loading.

Do not make logging, evidence capture, or replay OMA-specific. The existing
Nidek LT-900 path should use the same infrastructure.

## OMA Reliability Strategy

The serial OMA migration should be validated behavior-first.

- Add characterization tests for message framing, checksum vectors, format
  selection, capability handling, start/setup responses, trace receipt, ACK and
  retry behavior, and failure handling.
- Use hand-authored or independently verified golden vectors where practical.
  Avoid deriving all expected outputs from the new implementation under test.
- Build a simulated OMA tracer that drives the app as host through successful,
  timeout, malformed, retry, and unsupported-format scenarios.
- Add transcript replay tests so saved field sessions can reproduce driver
  behavior locally without hardware.

Simulator coverage gives migration confidence. Real session transcripts and
hardware checks give model compatibility confidence. A device is not `Tested`
only because it maps to the OMA serial driver.

The first serial OMA decoder negotiates textual equi-angle `TRCFMT=1` trace
records because those normalize directly into the app trace pipeline. Packed,
delta, and other binary OMA trace payload variants must fail with session
evidence until a browser decoder for those formats is added.

## Evidence Storage

Use private object-storage artifacts first. A database index can be layered on
later by ingesting session manifests.

Store one session bundle per actual connection or capture attempt:

```text
tracer-sessions/
  YYYY/
    MM/
      DD/
        <session-id>/
          manifest.json
          communication.ndjson
          raw-payload.bin
          trace.oma
```

Artifacts are present when available:

- `manifest.json`: selected manufacturer/model, internal profile, transport,
  settings, app and driver versions, timestamps, and outcome.
- `communication.ndjson`: machine-readable RX/TX transcript and protocol
  event stream used for support and replay.
- `raw-payload.bin`: exact bytes handed to the decoder or parser.
- `trace.oma` or equivalent trace artifact: the generated or received
  interchange file used by the app after capture.

Successful sessions and failed sessions both need communication transcripts.
Successful transcripts become replay fixtures and compatibility evidence.
Failed transcripts are needed to reproduce field problems.

Communication transcripts must preserve:

- exact RX and TX byte chunks;
- order and timing offsets;
- protocol phase/event annotations;
- selected device profile and transport settings;
- outcome and error details.

The UI may render a human-readable protocol log, but replay must use the
machine-readable transcript artifact.

Unsupported-device selections need a smaller demand artifact even when no live
session starts:

```text
tracer-demand/
  YYYY/
    MM/
      DD/
        <event-id>.json
```

The demand event should include timestamp, selected manufacturer/model,
connection variant, internal profile family when known, support state, and app
version.

## Storage Security

- Keep session bundles and demand artifacts private.
- Do not embed long-lived object-storage credentials in the frontend.
- Use a narrow browser upload authorization path, such as temporary signed
  object uploads.
- Add an object-storage retention policy once the support value and compliance
  lifetime of session evidence are decided.

The repository includes the first AWS upload path under
`infra/tracer-evidence-signer/`: a private S3 bucket, lifecycle expiry rule,
direct browser `PUT` CORS, and a narrow presigned upload Lambda/API for the app
`VITE_TRACER_EVIDENCE_SIGNER_URL` setting.

## Deferred Work

- LAN tracer communication.
- Native USB and WebUSB tracer communication.
- Proprietary serial protocol families after serial OMA.
- Database-backed trace/session indexing.
- Customer, shop, order, and account workflows.
- Verified model support claims without hardware or field transcript evidence.
