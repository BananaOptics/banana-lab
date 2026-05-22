# Lens Shape Designing Plan

## Goal

Add a lens-designing mode for frameless and rimless frames where non-engineers can design usable lens shapes with an Illustrator-like path editing experience.

The target workflow is: start from a template, OMA trace, or blank lens; edit the shape visually; keep drill holes and safety constraints visible; preview the design on a face; then export a lab-ready OMA file.

## Target User

The primary user is an optical shop user, designer, or advanced customer who understands the desired look but should not need engineering knowledge, geometry tools, or file-format details.

The UI should guide the user with visible constraints, locked reference layers, warnings, and sensible defaults instead of exposing raw OMA or coordinate concepts first.

## Core Experience

The designer should feel closer to Illustrator than to CAD.

- `V` switches to a selection tool for selecting the whole lens shape, holes, templates, and guide layers.
- `A` switches to a direct selection tool for editing individual path anchors and Bezier handles.
- MVP does not need a pen tool. The important daily flow is selecting and refining an existing path, with insert/delete anchor and smooth/corner conversion.
- The app should show anchor points, handles, smooth/corner point states, and hover targets clearly.
- The design should remain a closed path at all times.
- When a user drags points, the app should keep the path structurally closed, allow temporary invalid or risky geometry, and warn when the path becomes unsafe, non-manufacturable, or poorly represented by OMA polar export.
- The editor should show a full pair by default, with the right eye as the canonical editable shape and the left eye as a passive mirror. A visible "Mirrored R to L" indicator should make that relationship clear.

## Canvas Layers

Use explicit layers so non-engineers understand what they are editing.

1. Face background layer
   - Shows a human face behind the lens for context.
   - Locked by default.
   - Adjustable opacity.
   - Uses a built-in neutral illustrative SVG face in MVP.
   - Can be explicitly unlocked from the layers panel for move/scale positioning.
   - Stores face translation in millimeters and scale as a unitless value.
   - Should support importing a face photo later.

2. Frame template layer
   - Shows the frameless bridge/temple hardware and drill holes.
   - Locked by default.
   - Can be preloaded from known frame templates or a generic standards-sample rimless template.
   - Should include left/right eye mirroring rules and DBL assumptions.

3. Lens shape layer
   - The primary editable closed Bezier path.
   - Shows fill, stroke, anchors, handles, and selected segments.
   - Can start from a template, imported OMA trace, or blank starter shape.
   - Lockable, but unlocked by default.

4. Drill hole layer
   - Shows actual drill features.
   - Supports regular round holes with start `x/y` coordinates.
   - Supports slots with start `x/y` and end `x/y` coordinates.
   - Shows dotted safety margin around each hole or slot.
   - Holes can be locked to a frame template so users do not accidentally move hardware-critical geometry.
   - Imported OMA drill features are editable and are preserved when a captured/imported trace is opened in the designer.
   - The drill layer is lockable; template drill features remain locked regardless of layer state.

5. Uncut lens blank overlay
   - Optional visual overlay showing the available uncut lens blank boundary.
   - Uses configurable Blank PD and blank diameter settings with sensible defaults.
   - Default Blank PD is `64 mm` binocular / `32 mm` monocular.
   - Default circular blank diameter is `70 mm`.
   - Helps users design within available lens material before export.
   - Should be visual guidance plus warning/status checks, not an export blocker.

6. Warning/measurement overlay
   - Shows HBOX, VBOX, DBL, minimum hole-to-edge distance, and symmetry state.
   - Uses warnings only when action is needed.
   - Canvas measurement overlays can be hidden, but critical warnings remain visible in the persistent status panel.

Layer order is fixed in MVP: face, blanks, frame/template, original trace reference, lens shape, drill features, warnings/measurements. The layers panel controls visibility and lock state. Selecting a layer reveals layer-specific controls such as face opacity/transform or blank PD/diameter/opacity.

The original trace/reference layer is always locked, visible by default after OMA import, and only supports visibility/opacity changes.

## Safety Guidance

The app should make safety margins visible without making the workflow feel technical.

- Show dotted safety envelopes around drill holes and slots.
- For a regular hole, the dotted circle radius should be the feature radius plus the configured minimum material margin.
- For a slot, the dotted capsule should follow the start/end coordinates with radius equal to the slot radius plus the configured minimum material margin.
- Warn when the lens edge enters the dotted safety zone.
- Warn when drill features are too close to each other.
- Warn when the path self-intersects.
- Warn when there are sharp spikes or very tight curves near holes.
- Warn when exported HBOX, VBOX, DBL, or drill locations look outside expected limits.
- Warn when the designed lens shape does not fit within the configured uncut lens blank overlay.
- Make safety thresholds configurable because different labs, materials, and mounting systems may require different values.

The first version should avoid claiming a design is "safe." It should say whether it passes the configured checks.

Initial tunable MVP thresholds should assume a professional lab can produce the job, but should still catch shapes that are likely to cause avoidable manufacturing trouble:

- Drill/slot edge material margin: `2.0 mm`.
- Drill-feature-to-drill-feature minimum spacing: `1.0 mm`.
- Tight-curve warning: local radius of curvature below `2.0 mm`.
- Sharp-spike warning: path direction change above `70 deg` across a short local neighborhood.
- Broad HBOX sanity warning: outside `35-70 mm`.
- Broad VBOX sanity warning: outside `20-60 mm`.

These are warning thresholds, not export blockers. They should live in a dedicated constants module so they can be adjusted after real lab validation.

Drill and slot clearance should be measured against the flattened curved lens edge, not just the bounding box. Round holes warn when the center is outside the lens. Slots warn when their start or end centers are outside the lens, but do not warn merely because the slot segment crosses outside the lens; slots may be intentionally designed that way. Slots still participate in edge-clearance and feature-to-feature spacing warnings.

Blank-fit validation should use current frame PD (`HBOX + DBL`) versus configured Blank PD to compute decentration, then check whether the full lens outline fits inside the configured circular blank for each eye.

## Starting Points

### Preloaded Frame Template

A frame template should include:

- Frame/model name.
- Bridge and temple hardware preview.
- Drill hole positions and diameters.
- Optional slot geometry.
- DBL.
- Right/left mirroring behavior.
- Recommended starter lens shape.
- Safety margin settings.

This is important for rimless frames because the drill holes are often the real fixed geometry, while the lens outline is the design surface.

For MVP, frame templates should be static, typed TypeScript data rather than dynamically loaded JSON. This keeps the first `FrameTemplate` schema close to the code while the shape is still changing, gives compiler/autocomplete support for required fields, and makes the initial generic rimless template easier to review. A later template library can move the stable schema to JSON once multiple templates and external sharing are real requirements.

The first MVP template should be a generic standards-sample rimless template, not a Silhouette-branded model. Public Silhouette documentation refers to drilling-coordinate files, but exact model coordinates should come from measured frames or authorized manufacturer/lab data before being shipped. A generic template can be seeded from public Rimless Frame Drill Mount Standard example geometry and labeled as generic/test data.

The generic template should include locked four-hole standards-sample geometry, simplified unbranded bridge/temple hardware markers, a default DBL, and a clean editable starter shape that fits the holes. Template drill coordinates should be lens-box-center referenced, matching the existing `DRILLE` center-reference semantics.

### OMA Trace Import

An imported OMA trace should be converted into an editable path with fewer points.

Suggested flow:

1. Parse OMA radii and drill records using the existing OMA parser.
2. Convert polar radii into a closed Cartesian polyline.
3. Normalize the polyline around the lens-box center.
4. Simplify the polyline using a hardcoded tunable constant while preserving visual shape.
5. Fit a closed cubic Bezier path.
6. Show the result as editable anchors and handles.
7. Keep the original trace available as a faint locked reference layer for comparison only.

The user should edit the simplified Bezier path, not hundreds of raw OMA points.

The imported OMA radii are provenance/comparison data only. Export always generates a fully new OMA from the current design document. Imported OMA drill records are preserved as editable drill features. OMA files with arbitrary point counts above the parser minimum can be imported; the designer normalizes them for editing/export as needed.

OMA import should create a no-template design by default. Users can apply a template later. Captured or imported traces from the existing capture flow should offer an "Open in designer" action that preserves current job metadata, DBL override, and drill records.

### Blank Starter Shape

Provide a few editable starter shapes:

- Round.
- Panto.
- Soft rectangle.
- Aviator-like.
- Cat-eye.
- Template-matched default shape.

These should be normal Bezier paths, not special generated shapes after creation.

Users can start with a shape alone, without a frame template. No-template designs default DBL to `18 mm`, allow OMA export, and clearly show that no template-specific holes or hardware are present.

## Geometry Model

Internally, represent the design shape as a closed Bezier path.

Recommended shape model:

```ts
type LensPath = {
  id: string;
  anchors: LensAnchor[];
  closed: true;
};

type LensAnchor = {
  id: string;
  point: { x: number; y: number };
  inHandle: { x: number; y: number } | null;
  outHandle: { x: number; y: number } | null;
  kind: "smooth" | "corner";
};
```

Use millimeters as the canonical coordinate unit with y-up lens coordinates internally. The SVG canvas can scale to pixels and flip y at render boundaries, but exported values should come from millimeter geometry.

MVP should introduce a serializable `LensDesignDocument` as the design source of truth instead of extending `DecodedNidekTrace`. It should include `schemaVersion`, job info, right-eye path, optional future left-eye path, `symmetryMode: "mirrored" | "independent"`, drill features, current DBL, template ID and critical template geometry snapshot, face layer settings, blank overlay settings, layer settings, viewport state, and optional original OMA comparison reference. MVP uses `symmetryMode: "mirrored"` with the right eye as canonical; independent R/L geometry is a future extension.

Generated IDs should use `crypto.randomUUID()` with a fallback. Built-in template IDs should be human-readable slugs.

Project files should be JSON with a `.lensdesign` extension. MVP should include `schemaVersion` and a versioning structure, but does not need to enforce future-version rejection yet. Load should still use hand-written TypeScript guards for required geometry fields. Project save/load can use simple download/upload rather than the browser File System Access API. Project files save viewport and layer settings, but not current selection, current tool, or undo history.

## OMA Export

OMA export should be generated from the editable path.

Suggested flow:

1. Flatten the Bezier path into a high-resolution closed polyline.
2. Resample the closed shape to 400 and 1000 equiangular radii.
3. Compute HBOX, VBOX, CIRC, and DBL from the final geometry.
4. Export R/L records using the same mirroring behavior as the current OMA export.
5. Export drill records from the drill hole layer.

This lets the app preserve an Illustrator-like editing experience while still producing the OMA data labs expect.

MVP OMA export should stay conservative and lab-compatible: generate simple equiangular polar `R`/`L` traces, with 400 points as the primary output and 1000 points as secondary output. If a Bezier shape is not star-shaped from the lens-box center and cannot be represented faithfully as one radius per angle, warn that standard polar OMA export may not match the visual shape. In that case, use the outermost radial intersection as the fallback export value rather than blocking export.

Export radii should be generated from the lens-box center after adaptive Bezier flattening. Default flattening tolerance is `0.05 mm`. The export preview should use the exact rounded 400/1000-point radii that will be written into the downloaded OMA file, defaulting to the 400-point preview with a 1000-point toggle. The preview should show the generated OMA outline, drill features, and key dimensions, but not full editing safety overlays. OMA export should use standard records only; designer provenance belongs in `.lensdesign`, not the lab OMA.

## Editing Tools

### Selection Tool (`V`)

- Select whole lens path.
- Move selected objects when allowed.
- Select frame template or face layer only if unlocked.
- Select drill holes if they are editable.
- Show bounding box and transform handles for unlocked objects.
- Move and scale the whole lens shape, including independent width/height scaling with an aspect-lock option.
- Do not rotate the whole lens shape in MVP.

### Direct Selection Tool (`A`)

- Select anchors and segments.
- Drag anchors.
- Drag Bezier handles.
- Convert smooth/corner point.
- Delete selected anchor if the path remains valid.
- Insert anchor on segment.
- Multi-select anchors with shift.
- Smooth points keep handles aligned while corner points allow independent handles.
- Insert anchors by splitting the cubic segment with De Casteljau subdivision so the shape is preserved.
- Delete anchors by minimally reconnecting neighboring anchors without aggressive auto-smoothing.

### Useful Additional Tools

- Add anchor tool.
- Remove anchor tool.
- Smooth tool.
- Measurement tool.
- Hand/pan and zoom.

Pan/zoom is in MVP and is viewport state only. Zoom should be pointer-centered. Anchor/handle hit targets and editor overlay strokes should remain screen-stable across zoom. Segment hit-testing can use flattened polyline distance with a screen-pixel hit tolerance.

## User Guidance

Non-engineer guidance should be embedded in the canvas, not hidden in documentation.

- Snap anchors to symmetry guides, horizontal/vertical guides, and template reference points.
- Show a soft warning badge near unsafe holes instead of a long modal.
- Keep a persistent checklist/status panel for warnings and export readiness. Do not include "shape closed" as a user-facing checklist item because closed-path structure is an invariant.
- Provide "restore from template" and "reset shape" actions.
- Make the original imported OMA or template shape visible as a locked ghost reference.
- Keep export warnings visible in the editor/export area; warnings should not block download and MVP should not add a separate final warning step.
- Show an OMA export preview generated from the actual 400/1000-point radii so polar-export artifacts can be caught before download.
- Provide a compact shortcut/interaction cheat sheet in a popover opened from a small help/keyboard button.

Avoid asking users to understand raw coordinates unless they open an advanced panel.

Keyboard shortcuts are scoped to the designer route and ignored while typing in inputs. Delete/Backspace removes selected editable anchors or drill features while respecting layer locks and validity constraints. Undo/redo is required for document edits, but undo history is not saved in project files.

## MVP Scope

The first useful version should include:

- One editable lens shape layer.
- React Router with a real `/designer` route.
- SVG-based MVP editor canvas.
- A compact start screen for an empty designer route with generic rimless template, import OMA, open design file, and starter shape choices.
- Import OMA and simplify to editable Bezier path.
- Preload one generic standards-sample rimless frame template with locked holes and simplified hardware markers.
- Dotted drill safety margins.
- Built-in neutral SVG face background with opacity and explicit unlock-to-transform controls.
- Optional uncut lens blank overlay with configurable PD and blank diameter defaults.
- Illustrator-like layers panel for visibility, locks, and layer-specific controls.
- `V` and `A` keyboard shortcuts.
- Anchor and handle editing.
- Undo/redo for path, drill, face transform, and other document edits.
- A compact shortcut and interaction cheat sheet.
- Basic safety checks.
- Conservative sharp-spike and tight-curve warnings using tunable lab-oriented thresholds.
- Save/load the design document as a project file on the user's filesystem.
- Dirty-state tracking and before-unload warning on the designer route.
- Export 400-point and 1000-point OMA files.
- OMA export preview generated from exact rounded output radii.

## Later Scope

- Multiple frame templates.
- Face photo upload and alignment.
- Material-specific safety presets.
- Advanced slot editing controls.
- Pen tool / free path drawing.
- Better curve fitting controls.
- Version snapshots.
- Side-by-side right/left lens editing.
- Template marketplace or shared template library.
- Measurement annotations on export preview.

## Implementation Plan

### Phase 1: Geometry Foundation

- Add a dedicated tunable constants module.
- Add a serializable `LensDesignDocument` model and hand-written project-file guards.
- Add a Bezier path data model.
- Add utilities for path flattening, bounds, circumference, self-intersection checks, and point-to-edge distances.
- Add drill/slot clearance, feature spacing, blank-fit, sharp-spike, and tight-curve warning checks.
- Add OMA trace to editable path conversion.
- Add editable path to OMA radii conversion.

### Phase 2: Canvas Editor

- Add React Router and a `/designer` route.
- Build a dedicated lens design canvas.
- Add pan/zoom.
- Add layer rendering for face, blanks, template, original trace reference, shape, drill features, and warnings.
- Add a fixed-order layers panel with visibility/lock controls.
- Add `V` and `A` tools.
- Add anchor/handle hit testing and dragging.
- Add undo/redo and shortcut cheat sheet.

### Phase 3: Templates And Safety

- Define typed frame template data in TypeScript.
- Add one generic standards-sample rimless template.
- Render locked drill holes.
- Render dotted safety margins.
- Render circular uncut lens blank overlays and blank-fit warnings.
- Add safety checks and export readiness status.

### Phase 4: Import And Export Workflow

- Let users start from OMA, frame template, or blank shape.
- Keep the existing direct trace-to-OMA capture workflow and add an "Open in designer" handoff action.
- Do not add direct Nidek tracer connection inside the designer MVP.
- Preserve imported OMA as a reference layer.
- Save and load the serializable design document as a project file.
- Track dirty state and warn before tab close when unsaved.
- Export generated OMA files using the existing download flow.
- Show export readiness and warnings in the editor/export area.
- Show an export preview generated from the exact OMA radii that will be downloaded.

### Phase 5: Usability Pass

- Polish undo/redo behavior.
- Improve keyboard shortcuts.
- Add guide snapping.
- Add inline help for non-engineers.
- Test with real frame templates and lab software.

## Open Decisions

No blocking MVP product decisions remain from this review. Remaining calibration work should be validated against real lab output, especially template data, drill safety thresholds, blank-fit assumptions, and Bezier-to-OMA export behavior.

## Key Risks

- Curve simplification can change a traced shape too much if the tolerance is too high.
- A design may look good visually but fail lab/manufacturing constraints.
- Drill hole safety depends on material, lens thickness, mounting hardware, and lab rules.
- Illustrator-like tools can become too complex unless the MVP stays focused.
- OMA export from freeform Bezier paths must be validated against downstream lab software.

## Recommended Product Direction

Start with template-based rimless design rather than a completely blank drawing tool.

The most valuable first experience is:

1. Choose a rimless frame template.
2. See face, hardware, drill holes, and safety margins.
3. Adjust the lens outline with `A`.
4. Preview warnings.
5. Export OMA.

This keeps creative control high while preventing users from creating designs that ignore the fixed hardware geometry.
