# Designer Summary

This project is a browser-based Banana Optics lab tool for reading, previewing, editing, and exporting optical frame trace data. It is an operational application, not a marketing site. New features should feel precise, calm, and reliable for people working with physical frames, tracers, drill holes, and lab-ready OMA files.

Use this as the designer-facing summary of the current product. For the future lens-shape editor concept, also read `lens-designing.md`.

## Product Shape

- The app connects to a Nidek LT-900 tracer through Web Serial in supported desktop Chromium browsers.
- Users can capture a physical trace, open an existing `.oma` file, preview lens geometry, edit frame metadata, manage drill records, and download OMA exports.
- The product is client-only: no backend, account system, project dashboard, or marketing funnel exists in the current app.
- Core user confidence comes from clear states, visible measurements, accurate geometry, and cautious export warnings.

## Primary Users

- Optical shop operators who need to capture or revise frame trace data.
- Lab or technical users who understand terms like OMA, DBL, HBOX, VBOX, CIRC, FCRV, drill records, and frame model.
- Future design work can make these concepts easier, but should not hide critical lab data from users who rely on it.

## Current Workflows

The first screen has two equal entry points:

- `Trace form`: connects to a physical tracer, reads a trace, and shows protocol progress.
- `From file`: opens or drag-drops an existing OMA file.

After a trace or OMA import, the app shifts into an editor layout:

- Main preview panel on the left.
- Details panel on the right.
- Download action above the editor.
- Drill record management inside the preview panel.
- Settings available globally from the header.

Dialogs are used for focused tasks:

- Capture dialog: tracer connection, progress, errors, and protocol log.
- Drill records dialog: lens canvas plus editable table.
- Settings dialog: theme and 1:1 screen calibration.

## Design Personality

The interface should feel like lab equipment software made modern:

- Quiet, dense, and task-focused.
- High trust over delight.
- Clear measurement hierarchy over decorative visuals.
- Compact controls over oversized marketing sections.
- Subtle brand presence through the Banana Optics logo and restrained yellow accents.

Avoid adding playful UI, large hero areas, decorative gradients, lifestyle imagery, or explanatory marketing copy inside the app shell.

## Layout System

- Page shell: centered max width, currently `max-w-7xl`, with `px-4/6/8` responsive padding and `gap-6`.
- Header: logo and status on the left, task actions on the right, bottom border.
- Editor grid: primary working area plus a fixed-width right panel, currently `lg:grid-cols-[minmax(0,1fr)_380px]`.
- Cards are used for actual panels and repeated entry choices, not for every section.
- Card radius is modest (`0.5rem`) with thin borders and light shadow.
- Keep controls close to the object they affect, especially preview zoom, pair display, drill records, and export options.

## Visual Tokens

The design uses Tailwind with CSS variables in `src/index.css`. New designs should reuse these semantic tokens rather than introducing raw colors.

Core tokens:

- `background`, `foreground`
- `card`, `card-foreground`
- `popover`, `popover-foreground`
- `primary`, `primary-foreground`
- `secondary`, `secondary-foreground`
- `muted`, `muted-foreground`
- `accent`, `accent-foreground`
- `destructive`, `destructive-foreground`
- `border`, `input`, `ring`

Domain visualization tokens:

- `preview-background`
- `preview-grid`, `preview-grid-strong`
- `preview-text`
- `trace-fill`, `trace-stroke`
- `annotation`, `annotation-foreground`, `annotation-label`
- `drill-fill`, `drill-stroke`, `drill-active-stroke`
- `selected`

Status/log tokens:

- `success`, `success-foreground`
- `warning`, `warning-foreground`, `warning-border`, `warning-background`
- `log-background`, `log-foreground`, `log-muted`
- `log-rx`, `log-tx`, `log-warning`, `log-error`

Both light and dark themes are supported. Any new color or visualization state needs both theme values.

## Component Conventions

Buttons:

- Use icon plus text for primary task actions.
- Use lucide icons where possible.
- Primary buttons trigger the main step: connect, read trace, save, download.
- Outline buttons are secondary but still important.
- Ghost buttons are low-emphasis utility actions such as reset, clear, show more, or release ports.
- Icon-only buttons need an accessible label and title when helpful.

Badges:

- Use for compact source/status markers in the header.
- Current meanings: connected/success, disconnected/secondary, file/source labels.

Alerts:

- Use for real system state: unsupported browser, failed connection, import warning, invalid drill placement.
- Alerts should be short and actionable.
- Destructive alerts are for blocking or high-risk errors.
- Warning/default alerts are for compatibility notes and recoverable conditions.

Inputs:

- Keep labels explicit.
- Use smaller secondary code labels for lab fields, such as `DBL`, `VEN`, `MODEL`, `WRAPANG`, and `PANTO`.
- Use suffixes for units such as `mm`.
- Preserve typed numeric input behavior: users may temporarily enter incomplete decimals while editing.

Dialogs:

- Use a dark overlay token, a bordered card surface, and compact headers.
- Escape closes dialogs when it is safe to close.
- The drill dialog is draggable and larger than a standard modal because it is a work surface.

Tables:

- Tables are acceptable for dense technical editing, such as drill coordinates.
- Keep headers small and uppercase.
- Selected rows use the `selected` token.

## Geometry And Preview Language

The preview is the most important visual object in the app.

- Lens shapes are rendered as SVG paths over a measurement grid.
- The default preview uses a 4:3 work area with a minimum desktop-like height.
- Trace fill is translucent; trace stroke is stronger.
- Grid lines should remain low-contrast but visible.
- HBOX, VBOX, and DBL annotations use dashed boxes, thin dimension lines, and small labels.
- Drill holes use yellow fills/strokes; invalid drill features use destructive red.
- Slots are shown as rounded capsules.
- Crosshairs are used for hole centers.
- `Fit` and `1:1` are presented as compact segmented controls.

New geometry features should expose their state directly on the canvas instead of only in side panels. Use overlays, small labels, selection states, and warnings near the relevant shape.

## Content Voice

The product copy is direct and practical:

- "Connect tracer"
- "Read trace"
- "Open OMA"
- "Download"
- "Check drill placement"
- "OMA compatibility note"
- "Tracer capture unavailable"

Prefer short, concrete labels. Avoid friendly filler, sales language, and long instructions. Technical abbreviations are acceptable when paired with a plain-language label in editing contexts.

Good pattern:

- Label: `Bridge distance`
- Field hint: `DBL`
- Unit: `mm`

Poor pattern:

- `Let's configure your awesome bridge distance before continuing`

## Responsive Behavior

- The app is desktop-first because Web Serial and optical lab workflows target desktop browsers.
- Narrow viewports should remain usable, but not mobile-optimized at the expense of lab density.
- Header actions wrap.
- Entry cards become a two-column grid from small screens upward.
- Editor panels collapse to a single column before the large breakpoint.
- Text must not overflow buttons, tables, segmented controls, or preview annotations.

## States To Design

Every new feature should include these states where applicable:

- Empty/no data.
- Loading or active operation.
- Success/ready.
- Warning or compatibility issue.
- Error/failure.
- Disabled because the required context is missing.
- Dark theme.
- Narrow viewport.

For hardware or file operations, assume failure is normal and design recovery paths.

## Feature Design Checklist

Before adding a new feature, check:

- Does it fit the capture/import/edit/export workflow?
- Is the primary action obvious without adding instructional text?
- Are lab measurements, units, and coordinate assumptions visible where needed?
- Does it use existing semantic color tokens?
- Does it support light and dark themes?
- Does it have clear disabled, warning, and error states?
- Does it keep dense technical data scannable?
- Does it avoid blocking export unless the condition truly prevents output?
- Does the canvas show the feature visually if it affects geometry?

## Source References

- App shell and workflows: `src/App.tsx`
- Global tokens and themes: `src/index.css`
- Tailwind semantic token mapping: `tailwind.config.ts`
- UI primitives: `src/components/ui/*`
- Trace visualization: `src/components/TracePreview.tsx`
- Drill record editor: `src/components/DrillDialog.tsx`
- OMA import/export behavior: `src/lib/oma.ts`
- Product specification: `specifications.md`
- Future lens-designing plan: `lens-designing.md`
