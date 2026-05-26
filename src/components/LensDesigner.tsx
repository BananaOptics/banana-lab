import {
  type ChangeEvent,
  type PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileText,
  FileUp,
  Glasses,
  Grid2X2,
  Hand,
  Info,
  Keyboard,
  Lock,
  Minus,
  Move,
  PenLine,
  Plus,
  RotateCcw,
  RotateCw,
  ScanLine,
  Spline,
  Unlock,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { FRAME_TEMPLATES } from "@/lib/frame-templates";
import {
  createBlankDesign,
  createDesignFromTemplate,
  createDesignFromTrace,
  DESIGN_HANDOFF_KEY,
  downloadTextFile,
  parseDesignFile,
  serializeDesign,
} from "@/lib/lens-design-document";
import {
  clonePath,
  makeId,
  pathBounds,
  pathToSvg,
  splitCubic,
  transformPath,
  forEachCubic,
} from "@/lib/lens-bezier";
import { buildDesignerOma } from "@/lib/lens-design-oma";
import type { LensAnchor, LensDesignDocument, LensPoint } from "@/lib/lens-design-types";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { parseOmaContent } from "@/lib/oma";
import { formatNumber, polarRadiiToPoints } from "@/lib/trace-geometry";

// ── Design tokens (dark-only, matching Claude Design) ─────────────────────────
const DT = {
  bg: "#09090b",
  bgPanel: "#0c0c0e",
  card: "#101013",
  cardHover: "#15151a",
  border: "#1f1f23",
  borderStrong: "#2a2a30",
  fg: "#fafafa",
  muted: "#a1a1aa",
  mutedFg: "#71717a",
  subtle: "#52525b",
  accent: "#facc15",
  accentDim: "rgba(250,204,21,0.12)",
  canvasBg: "#08090b",
  gridLine: "rgba(255,255,255,0.045)",
  gridStrong: "rgba(255,255,255,0.085)",
  traceFill: "rgba(125,211,178,0.18)",
  traceStroke: "#7BD4B0",
  traceStrokeDim: "rgba(125,211,178,0.35)",
  annotation: "#5b8def",
  annotationDim: "rgba(91,141,239,0.55)",
  annotationLabel: "#9bb8f3",
  drillFill: "rgba(250,204,21,0.4)",
  drillStroke: "#facc15",
  safety: "rgba(250,204,21,0.45)",
  warnColor: "#f59e0b",
  warnBg: "rgba(245,158,11,0.10)",
  danger: "#ef4444",
  dangerBg: "rgba(239,68,68,0.10)",
  success: "#22c55e",
  selected: "#60a5fa",
  selectedFill: "rgba(96,165,250,0.35)",
  font: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

// ── Types ──────────────────────────────────────────────────────────────────────
type Tool = "select" | "direct";
type LayerKey = keyof LensDesignDocument["layers"];
type DragState =
  | { kind: "path"; start: LensPoint; original: LensDesignDocument }
  | { kind: "anchor"; anchorId: string; start: LensPoint; original: LensDesignDocument }
  | { kind: "handle"; anchorId: string; handle: "inHandle" | "outHandle"; start: LensPoint; original: LensDesignDocument }
  | { kind: "scale"; corner: "nw" | "ne" | "se" | "sw"; start: LensPoint; original: LensDesignDocument };

const CANVAS_W = 980;
const CANVAS_H = 620;
const MM_TO_SVG = 1;

// ── Main component ─────────────────────────────────────────────────────────────
export function LensDesigner() {
  const [doc, setDoc] = useState<LensDesignDocument | null>(() => readHandoff());
  const [tool, setTool] = useState<Tool>("select");
  const [selectedLayer, setSelectedLayer] = useState<LayerKey>("lens");
  const [selectedAnchors, setSelectedAnchors] = useState<string[]>([]);
  const [selectedHandle, setSelectedHandle] = useState<{ anchorId: string; handle: "inHandle" | "outHandle" } | null>(null);
  const [history, setHistory] = useState<LensDesignDocument[]>([]);
  const [future, setFuture] = useState<LensDesignDocument[]>([]);
  const [dirty, setDirty] = useState(false);
  const [previewPointCount, setPreviewPointCount] = useState<400 | 1000>(400);
  const [helpOpen, setHelpOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const omaInputRef = useRef<HTMLInputElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; }, [doc]);

  const exportData = useMemo(() => (doc ? buildDesignerOma(doc, previewPointCount) : null), [doc, previewPointCount]);
  const bounds = useMemo(() => (doc ? pathBounds(doc.rightPath) : null), [doc]);

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.key.toLowerCase() === "v") { event.preventDefault(); setTool("select"); return; }
      if (event.key.toLowerCase() === "a") { event.preventDefault(); setTool("direct"); return; }
      if ((event.key === "Delete" || event.key === "Backspace") && doc) {
        event.preventDefault();
        deleteSelectedAnchors();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      const current = docRef.current;
      if (!current) return;
      const factor = event.deltaY < 0 ? 1.12 : 1 / 1.12;
      const newZoom = clamp(current.viewport.zoom * factor, 0.5, 20);
      const view = getView(current);
      const rect = el.getBoundingClientRect();
      const sx = ((event.clientX - rect.left) / rect.width) * CANVAS_W;
      const sy = ((event.clientY - rect.top) / rect.height) * CANVAS_H;
      const wx = (sx - view.cx) / view.zoom;
      const wy = -(sy - view.cy) / view.zoom;
      const xMm = (sx - wx * newZoom - CANVAS_W / 2) / newZoom;
      const yMm = (CANVAS_H / 2 - sy - wy * newZoom) / newZoom;
      setDoc((d) => d ? { ...d, viewport: { zoom: newZoom, xMm, yMm } } : d);
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, [!!doc]);

  const commit = (updater: (current: LensDesignDocument) => LensDesignDocument, markDirty = true) => {
    setDoc((current) => {
      if (!current) return current;
      const next = updater(current);
      setHistory((h) => [...h, current].slice(-80));
      setFuture([]);
      if (markDirty) setDirty(true);
      return next;
    });
  };

  const undo = () => {
    setHistory((h) => {
      if (!doc || h.length === 0) return h;
      const previous = h[h.length - 1];
      setFuture((f) => [doc, ...f].slice(0, 80));
      setDoc(previous);
      setDirty(true);
      return h.slice(0, -1);
    });
  };

  const redo = () => {
    setFuture((f) => {
      if (!doc || f.length === 0) return f;
      const next = f[0];
      setHistory((h) => [...h, doc].slice(-80));
      setDoc(next);
      setDirty(true);
      return f.slice(1);
    });
  };

  const startNew = (next: LensDesignDocument) => {
    if (dirty && !window.confirm("Discard unsaved design changes?")) return;
    setDoc(next);
    setHistory([]);
    setFuture([]);
    setDirty(false);
    setSelectedAnchors([]);
    setSelectedHandle(null);
  };

  const saveProject = () => {
    if (!doc) return;
    downloadTextFile(`${safeName(doc.name || doc.jobInfo.job)}.lensdesign`, serializeDesign(doc));
    setDirty(false);
  };

  const openProject = async (file: File) => {
    try {
      startNew(parseDesignFile(await file.text()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open design file.");
    }
  };

  const openOma = async (file: File) => {
    try {
      const parsed = parseOmaContent(await file.text(), file.name);
      startNew(createDesignFromTrace(parsed.trace, { fileName: parsed.fileName, jobInfo: parsed.jobInfo, drillRecords: parsed.drillRecords }));
      setError(parsed.warnings.join(" ") || null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open trace file.");
    }
  };

  const hiddenInputs = (
    <>
      <input ref={projectInputRef} type="file" accept=".lensdesign,application/json" style={{ display: "none" }} onChange={(e) => pickFile(e, openProject)} />
      <input ref={omaInputRef} type="file" accept=".oma,.OMA,.vca,.VCA,text/plain" style={{ display: "none" }} onChange={(e) => pickFile(e, openOma)} />
    </>
  );

  // ── Start screen ──────────────────────────────────────────────────────────────
  if (!doc) {
    return (
      <DesignerRoot>
        <DesignerAppHeader />
        {hiddenInputs}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "40px 24px" }}>
          <div style={{ width: "100%", maxWidth: 920 }}>
            <div style={{ marginBottom: 28 }}>
              <DsBadge tone="accent">
                <Glasses size={11} style={{ marginRight: 4 }} />
                Frameless lens designer
              </DsBadge>
              <h1 style={{ margin: "12px 0 6px", fontSize: 26, fontWeight: 600, letterSpacing: -0.6, color: DT.fg, fontFamily: DT.font }}>
                Design a new lens
              </h1>
              <p style={{ margin: 0, fontSize: 13.5, color: DT.muted, lineHeight: 1.55, maxWidth: 560, fontFamily: DT.font }}>
                Choose a starting point. You can edit the lens outline with vector handles,
                keep drill safety margins visible, and export a lab-ready OMA when finished.
              </p>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14, marginBottom: 24 }}>
              <DsStartCard
                recommended
                title="Generic rimless template"
                desc="4-hole standards-sample geometry. Hardware locked, lens shape editable."
                meta={["DBL 18.0 mm", "4 drill holes", "Soft-rect starter"]}
                icon={
                  <svg viewBox="-30 -22 60 44" width="58" height="42">
                    <path d="M -22 -10 C -22 -16 -16 -18 -8 -18 C 4 -18 12 -16 18 -10 C 22 -4 22 4 18 10 C 12 16 4 18 -8 18 C -16 18 -22 16 -22 10 Z"
                      fill={DT.traceFill} stroke={DT.traceStroke} strokeWidth={0.7} />
                    {([[-15, -6], [-15, 6], [15, -6], [15, 6]] as [number, number][]).map(([x, y], i) => (
                      <circle key={i} cx={x} cy={y} r={1} fill={DT.drillStroke} />
                    ))}
                  </svg>
                }
                onClick={() => startNew(createDesignFromTemplate(FRAME_TEMPLATES[0]))}
              />
              <DsStartCard
                title="Open trace file"
                desc="Convert a trace file into editable Bezier anchors. Drill records preserved."
                meta={["Auto-simplify", "Reference layer kept"]}
                icon={<FileUp size={26} />}
                footer={<span style={{ fontSize: 11, color: DT.subtle }}>Accepts .oma / .vca files</span>}
                onClick={() => omaInputRef.current?.click()}
              />
              <DsStartCard
                title="Open project"
                desc="Resume an existing .lensdesign project with all layers, drill features, and viewport."
                meta={["Layers preserved", "Undo history fresh"]}
                icon={<FileText size={26} />}
                footer={<span style={{ fontSize: 11, color: DT.subtle }}>Accepts .lensdesign files</span>}
                onClick={() => projectInputRef.current?.click()}
              />
              <DsStartCard
                title="Blank starter shape"
                desc="Begin from a basic outline without a frame template. Add drill holes later."
                icon={<Plus size={26} />}
                shapes={[
                  { name: "Panto", onClick: () => startNew(createBlankDesign("panto")) },
                  { name: "Soft rect", onClick: () => startNew(createBlankDesign("panto")) },
                ]}
              />
            </div>

            <div style={{ height: 1, background: DT.border }} />
            <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, color: DT.mutedFg, fontFamily: DT.font }}>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Info size={13} />
                <span>Already captured a trace?</span>
                <Link to="/" style={{ color: DT.fg, textDecoration: "underline", textUnderlineOffset: 2 }}>Open in designer</Link>
                <span>from the Tracer page.</span>
              </div>
            </div>
          </div>
        </div>
        {error && (
          <div style={{ position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)", maxWidth: 480, background: DT.dangerBg, border: `1px solid ${DT.danger}`, borderRadius: 8, padding: "10px 16px", fontSize: 12.5, color: DT.danger, fontFamily: DT.font }}>
            {error}
          </div>
        )}
      </DesignerRoot>
    );
  }

  // ── Editor ────────────────────────────────────────────────────────────────────
  const selectedAnchorObjects = doc.rightPath.anchors.filter((a) => selectedAnchors.includes(a.id));
  const svg = getView(doc);

  return (
    <DesignerRoot>
      <DesignerAppHeader
        filename={doc.name || doc.jobInfo.job || "untitled.lensdesign"}
        dirty={dirty}
        rightExtra={
          <>
            <DsIconBtn icon={<RotateCcw size={14} />} title="Undo (⌘Z)" onClick={undo} disabled={history.length === 0} />
            <DsIconBtn icon={<RotateCw size={14} />} title="Redo (⌘⇧Z)" onClick={redo} disabled={future.length === 0} />
            <div style={{ width: 1, alignSelf: "stretch", background: DT.border, margin: "0 4px" }} />
            <DsIconBtn icon={<Keyboard size={14} />} title="Shortcuts" onClick={() => setHelpOpen((v) => !v)} />
            <DsBtn variant="secondary" onClick={() => projectInputRef.current?.click()} leftIcon={<FileUp size={13} />}>Open</DsBtn>
            <DsBtn variant="secondary" onClick={saveProject} leftIcon={<FileJson size={13} />}>Save</DsBtn>
            <DsBtn variant="secondary" onClick={() => omaInputRef.current?.click()} leftIcon={<FileUp size={13} />}>Import OMA</DsBtn>
            {exportData && (
              <DsBtn variant="accent" onClick={() => exportData.files[0] && downloadTextFile(exportData.files[0].fileName, exportData.files[0].content, "text/plain;charset=utf-8")} leftIcon={<Download size={13} />}>
                Export OMA
              </DsBtn>
            )}
          </>
        }
      />
      {hiddenInputs}

      {error && (
        <div style={{ margin: "0 10px", background: DT.warnBg, border: `1px solid ${DT.warnColor}`, borderRadius: 8, padding: "8px 12px", fontSize: 12, color: DT.warnColor, fontFamily: DT.font, display: "flex", gap: 8, alignItems: "center" }}>
          <FileJson size={13} />
          {error}
        </div>
      )}

      <div style={{ flex: 1, display: "grid", gridTemplateColumns: "56px minmax(0,1fr) 320px", gap: 10, padding: "0 10px 10px", minHeight: 0, overflow: "hidden" }}>
        {/* Vertical toolbar */}
        <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "center", background: DT.card, border: `1px solid ${DT.border}`, borderRadius: 10, padding: 6 }}>
          <ToolBtn active={tool === "select"} onClick={() => setTool("select")} title="Selection (V)" sc="V"><Move size={15} /></ToolBtn>
          <ToolBtn active={tool === "direct"} onClick={() => setTool("direct")} title="Direct selection (A)" sc="A"><PenLine size={15} /></ToolBtn>
          <div style={{ height: 1, width: "100%", background: DT.border, margin: "2px 0" }} />
          <ToolBtn title="Add anchor (+)" sc="+"><Plus size={15} /></ToolBtn>
          <ToolBtn title="Remove anchor (-)" sc="-"><Minus size={15} /></ToolBtn>
          <ToolBtn title="Smooth (S)" sc="S"><Spline size={15} /></ToolBtn>
          <ToolBtn title="Hand (H)" sc="H"><Hand size={15} /></ToolBtn>
        </div>

        {/* Canvas */}
        <div style={{ position: "relative", display: "flex", flexDirection: "column", background: DT.card, border: `1px solid ${DT.border}`, borderRadius: 10, overflow: "hidden", minHeight: 0 }}>
          {helpOpen && <ShortcutPopoverD onClose={() => setHelpOpen(false)} />}
          <div style={{ flex: 1, overflow: "hidden", background: DT.canvasBg, borderRadius: 9 }}>
            <svg
              ref={svgRef}
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              style={{ width: "100%", height: "100%", minHeight: 520, display: "block", touchAction: "none" }}
              onPointerMove={(event) => handlePointerMove(event, svg)}
              onPointerUp={(event) => handlePointerUp(event.currentTarget)}
              onPointerLeave={(event) => handlePointerUp(event.currentTarget)}
              onDoubleClick={(event) => insertAnchorAtEvent(event, svg)}
              role="application"
              aria-label="Lens designer canvas"
            >
              <defs>
                <pattern id="ds-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                  <path d="M 20 0 L 0 0 0 20" fill="none" stroke={DT.gridLine} strokeWidth="0.7" />
                </pattern>
              </defs>
              <rect width={CANVAS_W} height={CANVAS_H} fill="url(#ds-grid)" />
              <g transform={svg.transform}>
                {doc.layers.face.visible && <FaceLayer doc={doc} />}
                {doc.layers.blanks.visible && <BlankLayer doc={doc} />}
                {doc.layers.template.visible && <TemplateLayer doc={doc} />}
                {doc.layers.reference.visible && <ReferenceLayer doc={doc} />}
                {doc.layers.lens.visible && (
                  <LensLayer
                    doc={doc}
                    tool={tool}
                    selectedAnchors={selectedAnchors}
                    selectedHandle={selectedHandle}
                    onPathDown={(event) => {
                      if (tool !== "select" || doc.layers.lens.locked) return;
                      dragRef.current = { kind: "path", start: svgPoint(event, svg), original: doc };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onAnchorDown={(event, anchorId) => {
                      if (doc.layers.lens.locked) return;
                      event.stopPropagation();
                      setTool("direct");
                      setSelectedHandle(null);
                      setSelectedAnchors((current) => event.shiftKey ? toggleInArray(current, anchorId) : [anchorId]);
                      dragRef.current = { kind: "anchor", anchorId, start: svgPoint(event, svg), original: doc };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onHandleDown={(event, anchorId, handle) => {
                      if (doc.layers.lens.locked) return;
                      event.stopPropagation();
                      setTool("direct");
                      setSelectedAnchors([anchorId]);
                      setSelectedHandle({ anchorId, handle });
                      dragRef.current = { kind: "handle", anchorId, handle, start: svgPoint(event, svg), original: doc };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                    onScaleDown={(event, corner) => {
                      if (doc.layers.lens.locked || tool !== "select") return;
                      event.stopPropagation();
                      dragRef.current = { kind: "scale", corner, start: svgPoint(event, svg), original: doc };
                      event.currentTarget.setPointerCapture(event.pointerId);
                    }}
                  />
                )}
                {doc.layers.drills.visible && <DrillLayer doc={doc} />}
                {doc.layers.measurements.visible && bounds && <MeasurementLayer bounds={bounds} dblMm={doc.dblMm} />}
              </g>
            </svg>
          </div>
          {/* Canvas overlays */}
          <div style={{ position: "absolute", top: 10, right: 10, display: "flex", gap: 6, alignItems: "center" }}>
            <DsBadge>Dimensions in mm</DsBadge>
            <DsBadge>Right eye editable</DsBadge>
          </div>
          <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "6px 10px", background: "rgba(15,15,18,0.85)", border: `1px solid ${DT.border}`, backdropFilter: "blur(8px)", borderRadius: 7, fontSize: 11.5, color: DT.muted, fontFamily: DT.font }}>
              {tool === "select" ? (
                <span><b style={{ color: DT.fg }}>Selection</b> — drag to move, corner to scale. <KbdKey>A</KbdKey> for anchor edit.</span>
              ) : (
                <span><b style={{ color: DT.fg }}>Direct selection</b> — drag anchor or handle. <KbdKey>⇧</KbdKey> multi-select. <KbdKey>⌫</KbdKey> delete.</span>
              )}
              {selectedAnchorObjects.length > 0 && (
                <span style={{ color: DT.annotationLabel }}>{selectedAnchorObjects.length} anchor{selectedAnchorObjects.length !== 1 ? "s" : ""} selected</span>
              )}
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <aside style={{ display: "flex", flexDirection: "column", gap: 10, minHeight: 0, overflowY: "auto", overflowX: "hidden" }}>
          {/* Layers panel */}
          <DsCard
            header="Layers"
            headerSub="Visibility and locks"
          >
            <div>
              {(Object.keys(doc.layers) as LayerKey[]).map((key) => (
                <DsLayerRow
                  key={key}
                  name={layerNames[key]}
                  icon={layerIcons[key]}
                  state={doc.layers[key]}
                  selected={selectedLayer === key}
                  canLock={key === "face" || key === "lens" || key === "drills"}
                  onSelect={() => setSelectedLayer(key)}
                  onToggleVisible={() => commit((current) => updateLayer(current, key, { visible: !current.layers[key].visible }))}
                  onToggleLock={() => commit((current) => updateLayer(current, key, { locked: !current.layers[key].locked }))}
                />
              ))}
            </div>
            <div style={{ borderTop: `1px solid ${DT.border}`, padding: "10px 12px" }}>
              <LayerSettingsD doc={doc} selectedLayer={selectedLayer} commit={commit} />
            </div>
          </DsCard>

          {/* Status */}
          <DsCard
            header={
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                Status
                {exportData && exportData.warnings.length > 0
                  ? <DsBadge tone="warn">{exportData.warnings.length} warning{exportData.warnings.length !== 1 ? "s" : ""}</DsBadge>
                  : <DsBadge tone="success">All checks passing</DsBadge>
                }
              </span>
            }
            headerSub="Warnings do not block export"
          >
            {exportData && exportData.warnings.length > 0 ? (
              exportData.warnings.map((w) => (
                <div key={w.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "7px 12px", borderTop: `1px solid ${DT.border}` }}>
                  <div style={{ width: 16, height: 16, borderRadius: 999, marginTop: 1, background: DT.warnBg, color: DT.warnColor, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    <AlertTriangle size={10} />
                  </div>
                  <span style={{ fontSize: 11.5, color: DT.fg, fontFamily: DT.font, lineHeight: 1.45 }}>{w.message}</span>
                </div>
              ))
            ) : (
              <div style={{ padding: "8px 12px", display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ width: 16, height: 16, borderRadius: 999, background: "rgba(34,197,94,0.12)", color: DT.success, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Check size={10} />
                </div>
                <span style={{ fontSize: 11.5, color: DT.mutedFg, fontFamily: DT.font }}>No warnings.</span>
              </div>
            )}
          </DsCard>

          {/* Details */}
          <DsCard header="Details" headerSub="Project and export metadata">
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              <DsTextField label="Project name" value={doc.name} onChange={(v) => commit((c) => ({ ...c, name: v }))} />
              <DsTextField label="Job" value={doc.jobInfo.job} onChange={(v) => commit((c) => ({ ...c, jobInfo: { ...c.jobInfo, job: v } }))} />
              <DsTextField label="VEN" value={doc.jobInfo.ven} onChange={(v) => commit((c) => ({ ...c, jobInfo: { ...c.jobInfo, ven: v } }))} />
              <DsTextField label="MODEL" value={doc.jobInfo.model} onChange={(v) => commit((c) => ({ ...c, jobInfo: { ...c.jobInfo, model: v } }))} />
              <DsNumberField label="DBL mm" value={doc.dblMm} onChange={(v) => commit((c) => ({ ...c, dblMm: v }))} />
            </div>
          </DsCard>

          {/* OMA preview */}
          <DsCard
            header="OMA Preview"
            headerSub="Exact rounded export radii"
            headerRight={
              <select
                value={previewPointCount}
                onChange={(e) => setPreviewPointCount(Number(e.target.value) as 400 | 1000)}
                style={{ background: DT.bg, border: `1px solid ${DT.border}`, borderRadius: 5, padding: "2px 6px", fontSize: 11, color: DT.fg, fontFamily: DT.font, cursor: "pointer" }}
              >
                <option value={400}>400</option>
                <option value={1000}>1000</option>
              </select>
            }
          >
            <div style={{ padding: "8px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
              {exportData && <OmaPreviewD radii={exportData.preview.radii} />}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4, fontSize: 11, color: DT.mutedFg, fontFamily: DT.mono }}>
                <span>H {exportData ? formatNumber(exportData.preview.hboxMm, 1) : "-"} mm</span>
                <span>V {exportData ? formatNumber(exportData.preview.vboxMm, 1) : "-"} mm</span>
                <span>C {exportData ? formatNumber(exportData.preview.circMm, 1) : "-"} mm</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                {exportData?.files.map((file) => (
                  <DsBtn
                    key={file.pointCount}
                    variant={file.pointCount === 400 ? "accent" : "secondary"}
                    onClick={() => downloadTextFile(file.fileName, file.content, "text/plain;charset=utf-8")}
                    leftIcon={<Download size={12} />}
                  >
                    {file.pointCount}
                  </DsBtn>
                ))}
              </div>
            </div>
          </DsCard>
        </aside>
      </div>
    </DesignerRoot>
  );

  function handlePointerMove(event: PointerEvent<SVGSVGElement>, svgView: ReturnType<typeof getView>) {
    const drag = dragRef.current;
    if (!doc || !drag) return;
    const current = svgPoint(event, svgView);
    const dx = current.x - drag.start.x;
    const dy = current.y - drag.start.y;
    if (drag.kind === "path") {
      setDoc({ ...drag.original, rightPath: transformPath(drag.original.rightPath, { dx, dy }) });
      setDirty(true);
      return;
    }
    if (drag.kind === "scale") {
      const b = pathBounds(drag.original.rightPath);
      const origin = { x: drag.corner.includes("w") ? b.maxX : b.minX, y: drag.corner.includes("n") ? b.minY : b.maxY };
      const sx = clampScale((current.x - origin.x) / (drag.start.x - origin.x || 1));
      const sy = event.shiftKey ? sx : clampScale((current.y - origin.y) / (drag.start.y - origin.y || 1));
      setDoc({ ...drag.original, rightPath: transformPath(drag.original.rightPath, { sx, sy, origin }) });
      setDirty(true);
      return;
    }
    if (drag.kind === "anchor") {
      setDoc({ ...drag.original, rightPath: moveAnchor(drag.original.rightPath, drag.anchorId, dx, dy) });
      setDirty(true);
      return;
    }
    setDoc({ ...drag.original, rightPath: moveHandle(drag.original.rightPath, drag.anchorId, drag.handle, dx, dy) });
    setDirty(true);
  }

  function handlePointerUp(target: Element) {
    const drag = dragRef.current;
    if (!drag || !doc) return;
    setHistory((h) => [...h, drag.original].slice(-80));
    setFuture([]);
    dragRef.current = null;
    try { void target; } catch { /* ignore */ }
  }

  function deleteSelectedAnchors() {
    if (!doc || selectedAnchors.length === 0 || doc.layers.lens.locked) return;
    if (doc.rightPath.anchors.length - selectedAnchors.length < 3) return;
    commit((current) => ({
      ...current,
      rightPath: { ...current.rightPath, anchors: current.rightPath.anchors.filter((a) => !selectedAnchors.includes(a.id)) },
    }));
    setSelectedAnchors([]);
    setSelectedHandle(null);
  }

  function insertAnchorAtEvent(event: React.MouseEvent<SVGSVGElement>, svgView: ReturnType<typeof getView>) {
    if (!doc || doc.layers.lens.locked) return;
    const point = svgPoint(event, svgView);
    const hit = nearestSegment(doc.rightPath, point);
    if (!hit || hit.distance > 2.2) return;
    commit((current) => ({ ...current, rightPath: insertAnchor(current.rightPath, hit.segmentIndex, hit.t) }));
  }
}

// ── Design system primitives ───────────────────────────────────────────────────

function DesignerRoot({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ width: "100%", minHeight: "100vh", height: "100vh", background: DT.bg, color: DT.fg, display: "flex", flexDirection: "column", fontFamily: DT.font, overflow: "hidden" }}>
      {children}
    </div>
  );
}

function BananaMark({ size = 26 }: { size?: number }) {
  return (
    <div style={{ width: size, height: size, borderRadius: 6, background: DT.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#1c1500", flexShrink: 0 }}>
      <svg viewBox="0 0 24 24" width={size * 0.72} height={size * 0.72} fill="currentColor">
        <path d="M5 4c0 6 4 13 12 14 .8.1 1.4-.7 1-1.4-1.4-2.4-3-6.4-3-11 0-.6-.6-1-1.2-.8C11 5.4 9 6 8 6c-1 0-1.7-.4-2.2-1A.7.7 0 0 0 5 4z" />
        <path d="M4.5 3.8c.2-.4.8-.5 1.1-.2L7 4.8" stroke="#1c1500" strokeWidth="1.2" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

function DesignerAppHeader({ filename, dirty, rightExtra }: { filename?: string; dirty?: boolean; rightExtra?: React.ReactNode }) {
  return (
    <header style={{ height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 16px", borderBottom: `1px solid ${DT.border}`, background: DT.bg, flexShrink: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
        <BananaMark size={26} />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.1 }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: DT.fg, letterSpacing: -0.1 }}>Banana Sport Optics</span>
          <span style={{ fontSize: 10.5, color: DT.mutedFg, fontWeight: 500 }}>Lens Lab</span>
        </div>
        <div style={{ width: 1, alignSelf: "stretch", background: DT.border, margin: "0 4px" }} />
        <nav style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: DT.mutedFg }}>
          <Link to="/" style={{ color: DT.mutedFg, textDecoration: "none" }}>Tracer</Link>
          <ChevronRight size={12} />
          <span style={{ color: DT.fg, fontWeight: 500 }}>Designer</span>
        </nav>
        {filename && (
          <>
            <div style={{ width: 1, alignSelf: "stretch", background: DT.border, margin: "0 4px" }} />
            <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 9px", background: DT.card, border: `1px solid ${DT.border}`, borderRadius: 6, fontSize: 11.5, color: DT.muted, fontFamily: DT.mono }}>
              <FileText size={12} />
              <span>{filename}</span>
              {dirty && <span style={{ width: 5, height: 5, borderRadius: 999, background: DT.accent, marginLeft: 2, flexShrink: 0 }} />}
            </div>
          </>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {rightExtra}
      </div>
    </header>
  );
}

function DsBtn({ children, variant = "secondary", onClick, leftIcon, disabled, style }: {
  children?: React.ReactNode; variant?: "default" | "secondary" | "accent" | "ghost"; onClick?: () => void;
  leftIcon?: React.ReactNode; disabled?: boolean; style?: React.CSSProperties;
}) {
  const vars = {
    default: { bg: DT.fg, color: "#0a0a0c", border: "transparent" },
    secondary: { bg: DT.card, color: DT.fg, border: DT.border },
    accent: { bg: DT.accent, color: "#1c1500", border: "transparent" },
    ghost: { bg: "transparent", color: DT.fg, border: "transparent" },
  };
  const v = vars[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ height: 30, padding: "0 11px", fontSize: 12.5, lineHeight: 1, gap: 6, background: v.bg, color: v.color, border: `1px solid ${v.border}`, borderRadius: 6, fontFamily: DT.font, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap", userSelect: "none", opacity: disabled ? 0.45 : 1, ...style }}
    >
      {leftIcon}{children}
    </button>
  );
}

function DsIconBtn({ icon, onClick, title, disabled, size = 30 }: {
  icon: React.ReactNode; onClick?: () => void; title?: string; disabled?: boolean; size?: number;
}) {
  return (
    <button onClick={onClick} title={title} disabled={disabled} style={{ width: size, height: size, background: DT.card, color: disabled ? DT.subtle : DT.muted, border: `1px solid ${DT.border}`, borderRadius: 6, cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 0, opacity: disabled ? 0.45 : 1 }}>
      {icon}
    </button>
  );
}

function DsBadge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default" | "accent" | "warn" | "success" | "danger" }) {
  const tones = {
    default: { bg: DT.card, color: DT.muted, border: DT.border },
    accent: { bg: DT.accentDim, color: DT.accent, border: "rgba(250,204,21,0.25)" },
    warn: { bg: DT.warnBg, color: "#fbbf24", border: "rgba(245,158,11,0.3)" },
    success: { bg: "rgba(34,197,94,0.12)", color: "#86efac", border: "rgba(34,197,94,0.3)" },
    danger: { bg: DT.dangerBg, color: "#fca5a5", border: "rgba(239,68,68,0.3)" },
  };
  const t = tones[tone];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", fontSize: 10.5, fontWeight: 500, letterSpacing: 0.1, background: t.bg, color: t.color, border: `1px solid ${t.border}`, borderRadius: 5, fontFamily: DT.font, whiteSpace: "nowrap", lineHeight: 1.4 }}>
      {children}
    </span>
  );
}

function DsCard({ children, header, headerSub, headerRight }: { children: React.ReactNode; header?: React.ReactNode; headerSub?: string; headerRight?: React.ReactNode }) {
  return (
    <div style={{ background: DT.card, border: `1px solid ${DT.border}`, borderRadius: 10, overflow: "hidden" }}>
      {(header || headerRight) && (
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", padding: "10px 12px 8px", borderBottom: `1px solid ${DT.border}` }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: DT.fg, letterSpacing: -0.1 }}>{header}</div>
            {headerSub && <div style={{ fontSize: 11, color: DT.mutedFg, marginTop: 2 }}>{headerSub}</div>}
          </div>
          {headerRight}
        </div>
      )}
      {children}
    </div>
  );
}

function KbdKey({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 5px", background: DT.bg, border: `1px solid ${DT.borderStrong}`, borderBottomWidth: 2, borderRadius: 4, fontSize: 10, fontFamily: DT.mono, color: DT.muted, fontWeight: 600 }}>
      {children}
    </kbd>
  );
}

function ToolBtn({ children, active, onClick, title, sc }: { children?: React.ReactNode; active?: boolean; onClick?: () => void; title?: string; sc?: string }) {
  return (
    <button onClick={onClick} title={title} style={{ width: 32, height: 32, position: "relative", borderRadius: 6, background: active ? DT.cardHover : "transparent", border: `1px solid ${active ? DT.borderStrong : "transparent"}`, color: active ? DT.fg : DT.muted, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", padding: 0 }}>
      {children}
      {sc && <span style={{ position: "absolute", right: 2, bottom: 1, fontSize: 7, color: DT.subtle, fontFamily: DT.mono, fontWeight: 600 }}>{sc}</span>}
    </button>
  );
}

// ── Start card ────────────────────────────────────────────────────────────────
function DsStartCard({ title, desc, meta = [], icon, footer, shapes, recommended, onClick }: {
  title: string; desc: string; meta?: string[]; icon?: React.ReactNode; footer?: React.ReactNode;
  shapes?: { name: string; onClick: () => void }[]; recommended?: boolean; onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      style={{ background: DT.card, border: `1px solid ${recommended ? "rgba(250,204,21,0.4)" : DT.border}`, borderRadius: 10, padding: 18, position: "relative", cursor: "pointer", display: "flex", flexDirection: "column", gap: 12, boxShadow: recommended ? "0 0 0 1px rgba(250,204,21,0.1), 0 8px 28px rgba(0,0,0,0.3)" : "none" }}
    >
      {recommended && (
        <div style={{ position: "absolute", top: 14, right: 14 }}>
          <DsBadge tone="accent">Recommended</DsBadge>
        </div>
      )}
      {icon && (
        <div style={{ width: 64, height: 48, borderRadius: 8, background: DT.bg, border: `1px solid ${DT.border}`, color: DT.muted, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {icon}
        </div>
      )}
      <div>
        <div style={{ fontSize: 14, fontWeight: 600, color: DT.fg, marginBottom: 4, letterSpacing: -0.1 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: DT.muted, lineHeight: 1.5 }}>{desc}</div>
      </div>
      {meta.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {meta.map((m) => <DsBadge key={m}>{m}</DsBadge>)}
        </div>
      )}
      {shapes && (
        <div style={{ display: "flex", gap: 6, marginTop: "auto" }}>
          {shapes.map((s) => (
            <div key={s.name} onClick={(e) => { e.stopPropagation(); s.onClick(); }} title={s.name} style={{ flex: 1, height: 44, borderRadius: 6, background: DT.bg, border: `1px solid ${DT.border}`, color: DT.muted, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3, fontSize: 9.5, fontWeight: 500, cursor: "pointer" }}>
              <span style={{ color: DT.mutedFg }}>{s.name}</span>
            </div>
          ))}
        </div>
      )}
      {footer && <div style={{ marginTop: "auto", paddingTop: 6 }}>{footer}</div>}
    </div>
  );
}

// ── Layer row ─────────────────────────────────────────────────────────────────
function DsLayerRow({ name, icon, state, selected, canLock, onSelect, onToggleVisible, onToggleLock }: {
  name: string; icon: React.ReactNode; state: { visible: boolean; locked?: boolean };
  selected: boolean; canLock: boolean; onSelect: () => void; onToggleVisible: () => void; onToggleLock: () => void;
}) {
  return (
    <div
      onClick={onSelect}
      style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 10px", background: selected ? "rgba(91,141,239,0.08)" : "transparent", borderLeft: `2px solid ${selected ? DT.selected : "transparent"}`, fontSize: 11.5, color: DT.fg, cursor: "pointer" }}
    >
      <span style={{ color: selected ? DT.selected : DT.mutedFg, display: "flex" }}>{icon}</span>
      <span style={{ flex: 1, fontWeight: selected ? 500 : 400, color: selected ? DT.fg : DT.muted }}>{name}</span>
      <button type="button" onClick={(e) => { e.stopPropagation(); onToggleVisible(); }} style={{ width: 18, height: 18, padding: 0, background: "transparent", border: "none", color: state.visible ? DT.muted : DT.subtle, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {state.visible ? <Eye size={12} /> : <EyeOff size={12} />}
      </button>
      {canLock && (
        <button type="button" onClick={(e) => { e.stopPropagation(); onToggleLock(); }} style={{ width: 18, height: 18, padding: 0, background: "transparent", border: "none", color: state.locked ? DT.accent : DT.subtle, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {state.locked ? <Lock size={12} /> : <Unlock size={12} />}
        </button>
      )}
    </div>
  );
}

// ── Layer settings ────────────────────────────────────────────────────────────
function LayerSettingsD({ doc, selectedLayer, commit }: {
  doc: LensDesignDocument;
  selectedLayer: LayerKey;
  commit: (updater: (current: LensDesignDocument) => LensDesignDocument) => void;
}) {
  if (selectedLayer === "face") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <DsNumberField label="Opacity" value={doc.face.opacity} step={0.05} onChange={(v) => commit((c) => ({ ...c, face: { ...c.face, opacity: clamp(v, 0, 1) } }))} />
        <DsNumberField label="X mm" value={doc.face.xMm} onChange={(v) => commit((c) => ({ ...c, face: { ...c.face, xMm: v } }))} />
        <DsNumberField label="Y mm" value={doc.face.yMm} onChange={(v) => commit((c) => ({ ...c, face: { ...c.face, yMm: v } }))} />
        <DsNumberField label="Scale" value={doc.face.scale} step={0.05} onChange={(v) => commit((c) => ({ ...c, face: { ...c.face, scale: Math.max(0.2, v) } }))} />
      </div>
    );
  }
  if (selectedLayer === "blanks") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <DsNumberField label="Blank PD mm" value={doc.blanks.binocularPdMm} onChange={(v) => commit((c) => ({ ...c, blanks: { ...c.blanks, binocularPdMm: v } }))} />
        <DsNumberField label="Blank diameter mm" value={doc.blanks.diameterMm} onChange={(v) => commit((c) => ({ ...c, blanks: { ...c.blanks, diameterMm: v } }))} />
        <DsNumberField label="Opacity" value={doc.blanks.opacity} step={0.05} onChange={(v) => commit((c) => ({ ...c, blanks: { ...c.blanks, opacity: clamp(v, 0, 1) } }))} />
      </div>
    );
  }
  return <div style={{ fontSize: 11, color: DT.mutedFg }}>Select Face or Blanks for layer controls.</div>;
}

// ── Form fields ───────────────────────────────────────────────────────────────
function DsTextField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: DT.mutedFg, fontWeight: 500 }}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={{ background: DT.bg, border: `1px solid ${DT.border}`, borderRadius: 5, padding: "4px 8px", fontSize: 12, color: DT.fg, fontFamily: DT.font, outline: "none", width: "100%" }} />
    </label>
  );
}

function DsNumberField({ label, value, onChange, step = 0.1 }: { label: string; value: number; onChange: (v: number) => void; step?: number }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ fontSize: 11, color: DT.mutedFg, fontWeight: 500 }}>{label}</span>
      <input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(e) => onChange(parseFloat(e.target.value) || 0)} style={{ background: DT.bg, border: `1px solid ${DT.border}`, borderRadius: 5, padding: "4px 8px", fontSize: 12, color: DT.fg, fontFamily: DT.mono, outline: "none", width: "100%" }} />
    </label>
  );
}

// ── Shortcut popover ──────────────────────────────────────────────────────────
function ShortcutPopoverD({ onClose }: { onClose: () => void }) {
  return (
    <div style={{ position: "absolute", right: 12, top: 12, zIndex: 20, width: 280, background: DT.bgPanel, border: `1px solid ${DT.borderStrong}`, borderRadius: 8, padding: 14, boxShadow: "0 8px 28px rgba(0,0,0,0.4)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: DT.fg }}>Shortcuts</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: DT.subtle, cursor: "pointer", padding: 0 }}>✕</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "80px 1fr", gap: "4px 8px", fontSize: 11, color: DT.muted }}>
        {[
          ["V", "Selection tool"],
          ["A", "Direct selection"],
          ["Shift", "Multi-select anchors"],
          ["Del", "Delete anchors"],
          ["Dbl-click", "Insert anchor"],
          ["⌘Z", "Undo"],
          ["⌘⇧Z", "Redo"],
        ].map(([k, d]) => (
          <>
            <KbdKey key={k + "k"}>{k}</KbdKey>
            <span key={k + "d"} style={{ alignSelf: "center" }}>{d}</span>
          </>
        ))}
      </div>
    </div>
  );
}

// ── OMA preview ───────────────────────────────────────────────────────────────
function OmaPreviewD({ radii }: { radii: number[] }) {
  const pts = polarRadiiToPoints(radii);
  const b = {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const scale = Math.min(240 / w, 120 / h);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${140 + (p.x - (b.minX + w / 2)) * scale} ${70 - (p.y - (b.minY + h / 2)) * scale}`).join(" ") + " Z";
  return (
    <svg viewBox="0 0 280 140" style={{ width: "100%", height: 140, borderRadius: 6, background: DT.canvasBg, border: `1px solid ${DT.border}`, display: "block" }} aria-label="OMA export preview">
      <path d={d} fill={DT.traceFill} stroke={DT.traceStroke} strokeWidth="1.5" />
    </svg>
  );
}

// ── SVG layer components (updated to use DT colors) ───────────────────────────
function FaceLayer({ doc }: { doc: LensDesignDocument }) {
  const o = doc.face.opacity;
  const s = doc.face.scale;
  return (
    <g opacity={o} transform={`translate(${doc.face.xMm} ${-doc.face.yMm}) scale(${s})`}>
      <ellipse cx="0" cy="-4" rx="38" ry="52" fill={DT.card} stroke={DT.border} />
      <path d="M -44 -6 C -62 12 -62 42 -36 58 M 44 -6 C 62 12 62 42 36 58" fill="none" stroke={DT.border} strokeWidth="2" />
      <path d="M -20 -5 C -10 -10 10 -10 20 -5 M -15 18 C -5 24 6 24 16 18" fill="none" stroke={DT.subtle} strokeWidth="1.4" />
      <circle cx="-14" cy="2" r="2" fill={DT.subtle} />
      <circle cx="14" cy="2" r="2" fill={DT.subtle} />
    </g>
  );
}

function BlankLayer({ doc }: { doc: LensDesignDocument }) {
  const r = doc.blanks.diameterMm / 2;
  const rightX = -doc.blanks.binocularPdMm / 2;
  const leftX = doc.blanks.binocularPdMm / 2;
  return (
    <g opacity={doc.blanks.opacity} fill={DT.annotationDim + "14"} stroke={DT.annotation} strokeWidth="0.5" strokeDasharray="1.5 1.5">
      <circle cx={rightX} cy={0} r={r} />
      <circle cx={leftX} cy={0} r={r} />
    </g>
  );
}

function TemplateLayer({ doc }: { doc: LensDesignDocument }) {
  if (!doc.templateSnapshot) return null;
  const b = pathBounds(doc.rightPath);
  const offset = (b.width + doc.dblMm) / 2;
  return (
    <g fill="none" stroke={DT.subtle} strokeWidth="0.5" opacity={doc.layers.template.opacity ?? 1}>
      <text x={-offset - 28} y={-34} fontSize="3.5" fill={DT.subtle}>{doc.templateSnapshot.name}</text>
      <path d={`M ${-offset - 20} -18 C ${-offset - 12} -25 ${offset + 12} -25 ${offset + 20} -18`} />
      <path d={`M ${-offset + 21} -12 L ${-offset + 34} -8 M ${offset - 21} -12 L ${offset - 34} -8`} />
    </g>
  );
}

function ReferenceLayer({ doc }: { doc: LensDesignDocument }) {
  if (!doc.referenceTrace) return null;
  const pts = polarRadiiToPoints(doc.referenceTrace.radii);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${-p.y}`).join(" ") + " Z";
  return <path d={d} fill="none" stroke={DT.annotation} strokeWidth="0.5" strokeDasharray="1.2 1.2" opacity={doc.layers.reference.opacity ?? 0.35} />;
}

function LensLayer({ doc, tool, selectedAnchors, selectedHandle, onPathDown, onAnchorDown, onHandleDown, onScaleDown }: {
  doc: LensDesignDocument; tool: Tool; selectedAnchors: string[];
  selectedHandle: { anchorId: string; handle: "inHandle" | "outHandle" } | null;
  onPathDown: (event: PointerEvent<SVGPathElement>) => void;
  onAnchorDown: (event: PointerEvent<SVGCircleElement>, anchorId: string) => void;
  onHandleDown: (event: PointerEvent<SVGCircleElement>, anchorId: string, handle: "inHandle" | "outHandle") => void;
  onScaleDown: (event: PointerEvent<SVGRectElement>, corner: "nw" | "ne" | "se" | "sw") => void;
}) {
  const b = pathBounds(doc.rightPath);
  const offset = (b.width + doc.dblMm) / 2;
  const rightTransform = `translate(${-offset - b.cx} ${b.cy})`;
  const leftTransform = `translate(${offset + b.cx} ${b.cy}) scale(-1 1)`;
  const d = pathToSvg(doc.rightPath);
  return (
    <g>
      <g transform={leftTransform} opacity="0.35">
        <path d={d} fill={DT.traceFill} stroke={DT.traceStrokeDim} strokeWidth="0.45" strokeDasharray="0.7 0.4" />
      </g>
      <g transform={rightTransform}>
        <path d={d} fill={DT.traceFill} stroke={DT.traceStroke} strokeWidth="0.55" onPointerDown={onPathDown} style={{ cursor: tool === "select" ? "move" : "default" }} />
        {tool === "select" && (
          <g fill="none" stroke={DT.annotation} strokeWidth="0.45" strokeDasharray="1 1">
            <rect x={b.minX} y={-b.maxY} width={b.width} height={b.height} />
            {(["nw", "ne", "se", "sw"] as const).map((corner) => {
              const x = corner.includes("w") ? b.minX : b.maxX;
              const y = corner.includes("n") ? -b.maxY : -b.minY;
              return <rect key={corner} x={x - 1.2} y={y - 1.2} width="2.4" height="2.4" fill={DT.annotationLabel} stroke={DT.annotation} onPointerDown={(event) => onScaleDown(event, corner)} style={{ cursor: "nwse-resize" }} />;
            })}
          </g>
        )}
        {tool === "direct" && doc.rightPath.anchors.map((anchor) => (
          <g key={anchor.id}>
            {selectedAnchors.includes(anchor.id) && anchor.inHandle && <HandleLineD anchor={anchor} handle="inHandle" selected={selectedHandle?.anchorId === anchor.id && selectedHandle.handle === "inHandle"} onHandleDown={onHandleDown} />}
            {selectedAnchors.includes(anchor.id) && anchor.outHandle && <HandleLineD anchor={anchor} handle="outHandle" selected={selectedHandle?.anchorId === anchor.id && selectedHandle.handle === "outHandle"} onHandleDown={onHandleDown} />}
            <circle cx={anchor.point.x} cy={-anchor.point.y} r={selectedAnchors.includes(anchor.id) ? 1.4 : 1.05}
              fill={selectedAnchors.includes(anchor.id) ? DT.selected : DT.bg}
              stroke={DT.selected} strokeWidth="0.45"
              onPointerDown={(event) => onAnchorDown(event, anchor.id)}
              style={{ cursor: "pointer" }}
            />
          </g>
        ))}
      </g>
    </g>
  );
}

function HandleLineD({ anchor, handle, selected, onHandleDown }: {
  anchor: LensAnchor; handle: "inHandle" | "outHandle"; selected: boolean;
  onHandleDown: (event: PointerEvent<SVGCircleElement>, anchorId: string, handle: "inHandle" | "outHandle") => void;
}) {
  const p = anchor[handle];
  if (!p) return null;
  return (
    <g>
      <line x1={anchor.point.x} y1={-anchor.point.y} x2={p.x} y2={-p.y} stroke={DT.selected} strokeWidth="0.4" />
      <circle cx={p.x} cy={-p.y} r={selected ? 1.2 : 1} fill={DT.bg} stroke={DT.selected} strokeWidth="0.4" onPointerDown={(event) => onHandleDown(event, anchor.id, handle)} style={{ cursor: "pointer" }} />
    </g>
  );
}

function DrillLayer({ doc }: { doc: LensDesignDocument }) {
  const b = pathBounds(doc.rightPath);
  const offset = (b.width + doc.dblMm) / 2;
  return (
    <g>
      {doc.drills.flatMap((record) => [
        ...(record.eye === "B" || record.eye === "R" ? [renderDrill(record, -offset - b.cx, b.cy, false, `${record.id}-r`)] : []),
        ...(record.eye === "B" || record.eye === "L" ? [renderDrill(record, offset + b.cx, b.cy, true, `${record.id}-l`)] : []),
      ])}
    </g>
  );
}

function renderDrill(record: { x1: number; y1: number; x2: number | null; y2: number | null; diameter: number }, ox: number, oy: number, mirror: boolean, key: string) {
  const x1 = ox + (mirror ? -record.x1 : record.x1);
  const y1 = oy - record.y1;
  const r = record.diameter / 2;
  if (record.x2 !== null && record.y2 !== null) {
    const x2 = ox + (mirror ? -record.x2 : record.x2);
    const y2 = oy - record.y2;
    return (
      <g key={key}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DT.drillStroke} strokeWidth={record.diameter} strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={DT.drillStroke} strokeWidth={record.diameter + 4} strokeLinecap="round" strokeDasharray="1 1" opacity="0.3" />
      </g>
    );
  }
  return (
    <g key={key}>
      <circle cx={x1} cy={y1} r={r + 2} fill="none" stroke={DT.safety} strokeDasharray="1 1" opacity="0.6" />
      <circle cx={x1} cy={y1} r={Math.max(r, 0.8)} fill={DT.drillFill} stroke={DT.drillStroke} strokeWidth="0.4" />
    </g>
  );
}

function MeasurementLayer({ bounds, dblMm }: { bounds: ReturnType<typeof pathBounds>; dblMm: number }) {
  return (
    <g fill={DT.annotationLabel} fontSize="3.8" fontFamily={DT.font}>
      <text x="-126" y="-80">HBOX {formatNumber(bounds.width, 1)} mm</text>
      <text x="-126" y="-74">VBOX {formatNumber(bounds.height, 1)} mm</text>
      <text x="-126" y="-68">DBL {formatNumber(dblMm, 1)} mm</text>
    </g>
  );
}

// ── Layer metadata ─────────────────────────────────────────────────────────────
const layerNames: Record<LayerKey, string> = {
  face: "Face",
  blanks: "Uncut blanks",
  template: "Frame template",
  reference: "Original trace",
  lens: "Lens shape",
  drills: "Drill features",
  measurements: "Measurements",
};

const layerIcons: Record<LayerKey, React.ReactNode> = {
  face: <Eye size={12} />,
  blanks: <Circle size={12} />,
  template: <Grid2X2 size={12} />,
  reference: <Clock size={12} />,
  lens: <Glasses size={12} />,
  drills: <ScanLine size={12} />,
  measurements: <AlertTriangle size={12} />,
};

// ── Utility functions (unchanged logic) ────────────────────────────────────────
function readHandoff() {
  const raw = sessionStorage.getItem(DESIGN_HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DESIGN_HANDOFF_KEY);
  try { return parseDesignFile(raw); } catch { return null; }
}

function getView(doc: LensDesignDocument) {
  const zoom = doc.viewport.zoom * MM_TO_SVG;
  return {
    zoom,
    transform: `translate(${CANVAS_W / 2 + doc.viewport.xMm * zoom} ${CANVAS_H / 2 - doc.viewport.yMm * zoom}) scale(${zoom})`,
    cx: CANVAS_W / 2 + doc.viewport.xMm * zoom,
    cy: CANVAS_H / 2 - doc.viewport.yMm * zoom,
  };
}

function svgPoint(event: { clientX: number; clientY: number; currentTarget: Element }, view: ReturnType<typeof getView>): LensPoint {
  const element = event.currentTarget as SVGElement;
  const rect = (element.ownerSVGElement ?? element).getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * CANVAS_W;
  const y = ((event.clientY - rect.top) / rect.height) * CANVAS_H;
  return { x: (x - view.cx) / view.zoom, y: -(y - view.cy) / view.zoom };
}

function updateLayer(doc: LensDesignDocument, key: LayerKey, patch: Partial<LensDesignDocument["layers"][LayerKey]>) {
  return { ...doc, layers: { ...doc.layers, [key]: { ...doc.layers[key], ...patch } } };
}

function moveAnchor(path: LensDesignDocument["rightPath"], anchorId: string, dx: number, dy: number) {
  return {
    ...path,
    anchors: path.anchors.map((anchor) => anchor.id === anchorId ? {
      ...anchor,
      point: { x: anchor.point.x + dx, y: anchor.point.y + dy },
      inHandle: anchor.inHandle ? { x: anchor.inHandle.x + dx, y: anchor.inHandle.y + dy } : null,
      outHandle: anchor.outHandle ? { x: anchor.outHandle.x + dx, y: anchor.outHandle.y + dy } : null,
    } : anchor),
  };
}

function moveHandle(path: LensDesignDocument["rightPath"], anchorId: string, handle: "inHandle" | "outHandle", dx: number, dy: number) {
  return {
    ...path,
    anchors: path.anchors.map((anchor) => {
      if (anchor.id !== anchorId || !anchor[handle]) return anchor;
      const moved = { x: anchor[handle]!.x + dx, y: anchor[handle]!.y + dy };
      const opposite = handle === "inHandle" ? "outHandle" : "inHandle";
      if (anchor.kind !== "smooth" || !anchor[opposite]) return { ...anchor, [handle]: moved };
      const vx = moved.x - anchor.point.x;
      const vy = moved.y - anchor.point.y;
      const oppositeLen = Math.hypot(anchor[opposite]!.x - anchor.point.x, anchor[opposite]!.y - anchor.point.y);
      const movedLen = Math.hypot(vx, vy) || 1;
      return { ...anchor, [handle]: moved, [opposite]: { x: anchor.point.x - (vx / movedLen) * oppositeLen, y: anchor.point.y - (vy / movedLen) * oppositeLen } };
    }),
  };
}

function insertAnchor(path: LensDesignDocument["rightPath"], segmentIndex: number, t: number) {
  const anchors = clonePath(path).anchors;
  const current = anchors[segmentIndex];
  const nextIndex = (segmentIndex + 1) % anchors.length;
  const next = anchors[nextIndex];
  const [left, right] = splitCubic(current.point, current.outHandle ?? current.point, next.inHandle ?? next.point, next.point, t);
  current.outHandle = left[1];
  next.inHandle = right[2];
  const inserted: LensAnchor = { id: makeId("anchor"), point: left[3], inHandle: left[2], outHandle: right[1], kind: "smooth" };
  anchors.splice(nextIndex, 0, inserted);
  return { ...path, anchors };
}

function nearestSegment(path: LensDesignDocument["rightPath"], point: LensPoint) {
  let bestSegmentIndex = -1;
  let bestDistance = Infinity;
  let bestT = 0;
  forEachCubic(path, (p0, p1, p2, p3, segmentIndex) => {
    for (let i = 1; i <= 24; i += 1) {
      const t = i / 24;
      const p = cubicPoint(p0, p1, p2, p3, t);
      const distance = Math.hypot(p.x - point.x, p.y - point.y);
      if (distance < bestDistance) { bestSegmentIndex = segmentIndex; bestDistance = distance; bestT = t; }
    }
  });
  return bestSegmentIndex === -1 ? null : { segmentIndex: bestSegmentIndex, distance: bestDistance, t: bestT };
}

function cubicPoint(p0: LensPoint, p1: LensPoint, p2: LensPoint, p3: LensPoint, t: number) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y,
  };
}

function pickFile(event: ChangeEvent<HTMLInputElement>, cb: (file: File) => void) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (file) void cb(file);
}

function toggleInArray(values: string[], value: string) {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function safeName(value: string) {
  return (value || "lens_design").replace(/[^\w.-]+/g, "_");
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function clampScale(value: number) { return clamp(value, 0.2, 4); }
function clamp(value: number, min: number, max: number) { return Math.min(max, Math.max(min, value)); }
