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
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileUp,
  HelpCircle,
  Keyboard,
  Lock,
  Move,
  PenLine,
  RotateCcw,
  Save,
  Unlock,
} from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
  flattenPath,
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
import { cn } from "@/lib/utils";

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
      if (event.key.toLowerCase() === "v") {
        event.preventDefault();
        setTool("select");
        return;
      }
      if (event.key.toLowerCase() === "a") {
        event.preventDefault();
        setTool("direct");
        return;
      }
      if ((event.key === "Delete" || event.key === "Backspace") && doc) {
        event.preventDefault();
        deleteSelectedAnchors();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

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
      setError(e instanceof Error ? e.message : "Could not open OMA file.");
    }
  };

  if (!doc) {
    return (
      <main className="min-h-screen bg-background px-4 py-6 sm:px-6 lg:px-8">
        <DesignerHeader dirty={dirty} />
        <section className="mx-auto mt-8 grid max-w-5xl gap-4 md:grid-cols-2 lg:grid-cols-4">
          <StartCard title="Generic rimless" description="Standards-sample holes, hardware markers, and starter lens." onClick={() => startNew(createDesignFromTemplate(FRAME_TEMPLATES[0]))} />
          <StartCard title="Import OMA" description="Create a new design from existing trace and drill records." onClick={() => omaInputRef.current?.click()} />
          <StartCard title="Open design" description="Load a saved .lensdesign project file." onClick={() => projectInputRef.current?.click()} />
          <StartCard title="Starter shape" description="Begin with a panto lens and no frame template." onClick={() => startNew(createBlankDesign("panto"))} />
        </section>
        <HiddenInputs projectInputRef={projectInputRef} omaInputRef={omaInputRef} onProject={openProject} onOma={openOma} />
        {error && <StartError message={error} />}
      </main>
    );
  }

  const selectedAnchorObjects = doc.rightPath.anchors.filter((anchor) => selectedAnchors.includes(anchor.id));
  const svg = getView(doc);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <DesignerHeader dirty={dirty}>
          <Button variant="outline" onClick={() => projectInputRef.current?.click()}><FileUp className="h-4 w-4" /> Open</Button>
          <Button variant="outline" onClick={saveProject}><Save className="h-4 w-4" /> Save</Button>
          <Button variant="outline" onClick={() => omaInputRef.current?.click()}><FileUp className="h-4 w-4" /> Import OMA</Button>
        </DesignerHeader>
        <HiddenInputs projectInputRef={projectInputRef} omaInputRef={omaInputRef} onProject={openProject} onOma={openOma} />
        {error && (
          <Alert className="grid grid-cols-[auto_1fr] items-start gap-x-3">
            <FileJson className="mt-0.5 h-4 w-4" />
            <AlertTitle className="mb-0">Import note</AlertTitle>
            <AlertDescription className="col-start-2">{error}</AlertDescription>
          </Alert>
        )}

        <section className="grid gap-4 xl:grid-cols-[280px_minmax(0,1fr)_360px]">
          <Card>
            <CardHeader>
              <CardTitle>Layers</CardTitle>
              <CardDescription>Visibility, locks, and layer settings.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {(Object.keys(doc.layers) as LayerKey[]).map((key) => (
                <LayerRow
                  key={key}
                  name={layerNames[key]}
                  state={doc.layers[key]}
                  selected={selectedLayer === key}
                  canLock={key === "face" || key === "lens" || key === "drills"}
                  onSelect={() => setSelectedLayer(key)}
                  onToggleVisible={() => commit((current) => updateLayer(current, key, { visible: !current.layers[key].visible }))}
                  onToggleLock={() => commit((current) => updateLayer(current, key, { locked: !current.layers[key].locked }))}
                />
              ))}
              <LayerSettings doc={doc} selectedLayer={selectedLayer} commit={commit} />
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
              <div>
                <CardTitle>Designer</CardTitle>
                <CardDescription>{doc.symmetryMode === "mirrored" ? "Mirrored R to L" : "Independent R/L"}</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex overflow-hidden rounded-md border text-sm">
                  <button className={toolButton(tool === "select")} onClick={() => setTool("select")} title="Selection tool (V)"><Move className="h-4 w-4" /></button>
                  <button className={toolButton(tool === "direct")} onClick={() => setTool("direct")} title="Direct selection (A)"><PenLine className="h-4 w-4" /></button>
                </div>
                <Button variant="outline" size="icon" onClick={undo} disabled={history.length === 0} title="Undo"><RotateCcw className="h-4 w-4" /></Button>
                <Button variant="outline" size="icon" onClick={() => setHelpOpen((v) => !v)} title="Shortcuts"><Keyboard className="h-4 w-4" /></Button>
              </div>
            </CardHeader>
            <CardContent className="relative">
              {helpOpen && <ShortcutPopover />}
              <div className="overflow-hidden rounded-md border bg-[hsl(var(--preview-background))]">
                <svg
                  viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
                  className="h-[min(72vh,720px)] min-h-[520px] w-full touch-none"
                  onPointerMove={(event) => handlePointerMove(event, svg)}
                  onPointerUp={(event) => handlePointerUp(event.currentTarget)}
                  onPointerLeave={(event) => handlePointerUp(event.currentTarget)}
                  onDoubleClick={(event) => insertAnchorAtEvent(event, svg)}
                  role="application"
                  aria-label="Lens designer"
                >
                  <defs>
                    <pattern id="designer-grid" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="hsl(var(--preview-grid))" strokeWidth="0.7" />
                    </pattern>
                  </defs>
                  <rect width={CANVAS_W} height={CANVAS_H} fill="url(#designer-grid)" />
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
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="secondary">Right eye editable</Badge>
                <span>Tool: {tool === "select" ? "Selection" : "Direct selection"}</span>
                {selectedAnchorObjects.length > 0 && <span>{selectedAnchorObjects.length} anchor{selectedAnchorObjects.length === 1 ? "" : "s"} selected</span>}
              </div>
            </CardContent>
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Status</CardTitle>
                <CardDescription>Warnings do not block export.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {exportData && exportData.warnings.length > 0 ? exportData.warnings.map((warning) => (
                  <div key={warning.id} className="rounded-md border border-warning-border bg-warning-background px-3 py-2 text-sm">{warning.message}</div>
                )) : <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">No configured warnings.</div>}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Details</CardTitle>
                <CardDescription>Project and export metadata.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <TextField label="Project name" value={doc.name} onChange={(value) => commit((current) => ({ ...current, name: value }))} />
                <TextField label="Job" value={doc.jobInfo.job} onChange={(value) => commit((current) => ({ ...current, jobInfo: { ...current.jobInfo, job: value } }))} />
                <TextField label="VEN" value={doc.jobInfo.ven} onChange={(value) => commit((current) => ({ ...current, jobInfo: { ...current.jobInfo, ven: value } }))} />
                <TextField label="MODEL" value={doc.jobInfo.model} onChange={(value) => commit((current) => ({ ...current, jobInfo: { ...current.jobInfo, model: value } }))} />
                <NumberField label="DBL mm" value={doc.dblMm} onChange={(value) => commit((current) => ({ ...current, dblMm: value }))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center justify-between gap-2 space-y-0">
                <div>
                  <CardTitle>OMA Preview</CardTitle>
                  <CardDescription>Exact rounded export radii.</CardDescription>
                </div>
                <select value={previewPointCount} onChange={(event) => setPreviewPointCount(Number(event.target.value) as 400 | 1000)} className="rounded-md border bg-background px-2 py-1 text-sm">
                  <option value={400}>400</option>
                  <option value={1000}>1000</option>
                </select>
              </CardHeader>
              <CardContent className="space-y-3">
                {exportData && <OmaPreview doc={doc} radii={exportData.preview.radii} />}
                <div className="grid grid-cols-3 gap-2 text-xs text-muted-foreground">
                  <span>H {exportData ? formatNumber(exportData.preview.hboxMm, 1) : "-"} mm</span>
                  <span>V {exportData ? formatNumber(exportData.preview.vboxMm, 1) : "-"} mm</span>
                  <span>C {exportData ? formatNumber(exportData.preview.circMm, 1) : "-"} mm</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {exportData?.files.map((file) => (
                    <Button key={file.pointCount} variant={file.pointCount === 400 ? "default" : "outline"} onClick={() => downloadTextFile(file.fileName, file.content, "text/plain;charset=utf-8")}>
                      <Download className="h-4 w-4" />
                      {file.pointCount}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </main>
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
    try {
      if ("releasePointerCapture" in target) {
        // The active pointer id is not needed; browsers ignore non-captured ids inconsistently.
      }
    } catch {
      // ignore
    }
  }

  function deleteSelectedAnchors() {
    if (!doc || selectedAnchors.length === 0 || doc.layers.lens.locked) return;
    if (doc.rightPath.anchors.length - selectedAnchors.length < 3) return;
    commit((current) => ({
      ...current,
      rightPath: { ...current.rightPath, anchors: current.rightPath.anchors.filter((anchor) => !selectedAnchors.includes(anchor.id)) },
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

function readHandoff() {
  const raw = sessionStorage.getItem(DESIGN_HANDOFF_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(DESIGN_HANDOFF_KEY);
  try {
    return parseDesignFile(raw);
  } catch {
    return null;
  }
}

function DesignerHeader({ dirty, children }: { dirty: boolean; children?: React.ReactNode }) {
  return (
    <header className="flex flex-col gap-3 border-b pb-4 md:flex-row md:items-center md:justify-between">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Lens Designer</h1>
          {dirty && <Badge variant="secondary">Unsaved</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">Bezier design document with OMA export preview.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" asChild><Link to="/">Capture</Link></Button>
        {children}
      </div>
    </header>
  );
}

function StartCard({ title, description, onClick }: { title: string; description: string; onClick: () => void }) {
  return (
    <Card className="flex min-h-[220px] flex-col">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Button className="w-full" onClick={onClick}>Start</Button>
      </CardContent>
    </Card>
  );
}

function HiddenInputs({ projectInputRef, omaInputRef, onProject, onOma }: {
  projectInputRef: React.RefObject<HTMLInputElement>;
  omaInputRef: React.RefObject<HTMLInputElement>;
  onProject: (file: File) => void;
  onOma: (file: File) => void;
}) {
  return (
    <>
      <input ref={projectInputRef} type="file" accept=".lensdesign,application/json" className="hidden" onChange={(event) => pickFile(event, onProject)} />
      <input ref={omaInputRef} type="file" accept=".oma,.OMA,text/plain" className="hidden" onChange={(event) => pickFile(event, onOma)} />
    </>
  );
}

function pickFile(event: ChangeEvent<HTMLInputElement>, cb: (file: File) => void) {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (file) void cb(file);
}

function StartError({ message }: { message: string }) {
  return <div className="mx-auto mt-6 max-w-3xl rounded-md border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm">{message}</div>;
}

function LayerRow({ name, state, selected, canLock, onSelect, onToggleVisible, onToggleLock }: {
  name: string;
  state: { visible: boolean; locked?: boolean };
  selected: boolean;
  canLock: boolean;
  onSelect: () => void;
  onToggleVisible: () => void;
  onToggleLock: () => void;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-md border px-2 py-1.5", selected && "border-ring bg-accent/60")} onClick={onSelect}>
      <button type="button" onClick={(event) => { event.stopPropagation(); onToggleVisible(); }} title={state.visible ? "Hide" : "Show"}>
        {state.visible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
      <span className="min-w-0 flex-1 text-sm">{name}</span>
      {canLock && (
        <button type="button" onClick={(event) => { event.stopPropagation(); onToggleLock(); }} title={state.locked ? "Unlock" : "Lock"}>
          {state.locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function LayerSettings({ doc, selectedLayer, commit }: {
  doc: LensDesignDocument;
  selectedLayer: LayerKey;
  commit: (updater: (current: LensDesignDocument) => LensDesignDocument) => void;
}) {
  if (selectedLayer === "face") {
    return (
      <div className="border-t pt-3">
        <NumberField label="Face opacity" value={doc.face.opacity} step={0.05} onChange={(value) => commit((current) => ({ ...current, face: { ...current.face, opacity: clamp(value, 0, 1) } }))} />
        <NumberField label="Face X mm" value={doc.face.xMm} onChange={(value) => commit((current) => ({ ...current, face: { ...current.face, xMm: value } }))} />
        <NumberField label="Face Y mm" value={doc.face.yMm} onChange={(value) => commit((current) => ({ ...current, face: { ...current.face, yMm: value } }))} />
        <NumberField label="Face scale" value={doc.face.scale} step={0.05} onChange={(value) => commit((current) => ({ ...current, face: { ...current.face, scale: Math.max(0.2, value) } }))} />
      </div>
    );
  }
  if (selectedLayer === "blanks") {
    return (
      <div className="border-t pt-3">
        <NumberField label="Blank PD mm" value={doc.blanks.binocularPdMm} onChange={(value) => commit((current) => ({ ...current, blanks: { ...current.blanks, binocularPdMm: value } }))} />
        <NumberField label="Blank diameter mm" value={doc.blanks.diameterMm} onChange={(value) => commit((current) => ({ ...current, blanks: { ...current.blanks, diameterMm: value } }))} />
        <NumberField label="Blank opacity" value={doc.blanks.opacity} step={0.05} onChange={(value) => commit((current) => ({ ...current, blanks: { ...current.blanks, opacity: clamp(value, 0, 1) } }))} />
      </div>
    );
  }
  return <div className="border-t pt-3 text-xs text-muted-foreground">Select face or blanks for layer-specific controls.</div>;
}

function FaceLayer({ doc }: { doc: LensDesignDocument }) {
  const o = doc.face.opacity;
  const s = doc.face.scale;
  return (
    <g opacity={o} transform={`translate(${doc.face.xMm} ${-doc.face.yMm}) scale(${s})`}>
      <ellipse cx="0" cy="-4" rx="38" ry="52" fill="hsl(var(--muted))" stroke="hsl(var(--border))" />
      <path d="M -44 -6 C -62 12 -62 42 -36 58 M 44 -6 C 62 12 62 42 36 58" fill="none" stroke="hsl(var(--border))" strokeWidth="2" />
      <path d="M -20 -5 C -10 -10 10 -10 20 -5 M -15 18 C -5 24 6 24 16 18" fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="1.4" />
      <circle cx="-14" cy="2" r="2" fill="hsl(var(--muted-foreground))" />
      <circle cx="14" cy="2" r="2" fill="hsl(var(--muted-foreground))" />
    </g>
  );
}

function BlankLayer({ doc }: { doc: LensDesignDocument }) {
  const b = pathBounds(doc.rightPath);
  const framePd = b.width + doc.dblMm;
  const dec = (framePd - doc.blanks.binocularPdMm) / 2;
  const r = doc.blanks.diameterMm / 2;
  const rightX = -((b.width + doc.dblMm) / 2) + b.width / 2 - dec;
  const leftX = ((b.width + doc.dblMm) / 2) - b.width / 2 + dec;
  return (
    <g opacity={doc.blanks.opacity} fill="hsl(var(--annotation) / 0.08)" stroke="hsl(var(--annotation))" strokeDasharray="1.5 1.5">
      <circle cx={rightX} cy={-b.cy} r={r} />
      <circle cx={leftX} cy={-b.cy} r={r} />
    </g>
  );
}

function TemplateLayer({ doc }: { doc: LensDesignDocument }) {
  if (!doc.templateSnapshot) return null;
  const b = pathBounds(doc.rightPath);
  const offset = (b.width + doc.dblMm) / 2;
  return (
    <g fill="none" stroke="hsl(var(--muted-foreground))" strokeWidth="0.5" opacity={doc.layers.template.opacity ?? 1}>
      <text x={-offset - 28} y={-34} fontSize="3.5" fill="hsl(var(--muted-foreground))">{doc.templateSnapshot.name}</text>
      <path d={`M ${-offset - 20} -18 C ${-offset - 12} -25 ${offset + 12} -25 ${offset + 20} -18`} />
      <path d={`M ${-offset + 21} -12 L ${-offset + 34} -8 M ${offset - 21} -12 L ${offset - 34} -8`} />
    </g>
  );
}

function ReferenceLayer({ doc }: { doc: LensDesignDocument }) {
  if (!doc.referenceTrace) return null;
  const pts = polarRadiiToPoints(doc.referenceTrace.radii);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${-p.y}`).join(" ") + " Z";
  return <path d={d} fill="none" stroke="hsl(var(--annotation))" strokeWidth="0.5" strokeDasharray="1.2 1.2" opacity={doc.layers.reference.opacity ?? 0.35} />;
}

function LensLayer({ doc, tool, selectedAnchors, selectedHandle, onPathDown, onAnchorDown, onHandleDown, onScaleDown }: {
  doc: LensDesignDocument;
  tool: Tool;
  selectedAnchors: string[];
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
      <g transform={leftTransform} opacity="0.38">
        <path d={d} fill="hsl(var(--trace-fill) / 0.55)" stroke="hsl(var(--trace-stroke))" strokeWidth="0.7" />
      </g>
      <g transform={rightTransform}>
        <path d={d} fill="hsl(var(--trace-fill) / 0.68)" stroke="hsl(var(--trace-stroke))" strokeWidth="0.8" onPointerDown={onPathDown} className={tool === "select" ? "cursor-move" : ""} />
        {tool === "select" && (
          <g fill="none" stroke="hsl(var(--annotation))" strokeWidth="0.45" strokeDasharray="1 1">
            <rect x={b.minX} y={-b.maxY} width={b.width} height={b.height} />
            {(["nw", "ne", "se", "sw"] as const).map((corner) => {
              const x = corner.includes("w") ? b.minX : b.maxX;
              const y = corner.includes("n") ? -b.maxY : -b.minY;
              return <rect key={corner} x={x - 1.2} y={y - 1.2} width="2.4" height="2.4" fill="hsl(var(--annotation-label))" stroke="hsl(var(--annotation))" onPointerDown={(event) => onScaleDown(event, corner)} />;
            })}
          </g>
        )}
        {tool === "direct" && doc.rightPath.anchors.map((anchor) => (
          <g key={anchor.id}>
            {selectedAnchors.includes(anchor.id) && anchor.inHandle && <HandleLine anchor={anchor} handle="inHandle" selected={selectedHandle?.anchorId === anchor.id && selectedHandle.handle === "inHandle"} onHandleDown={onHandleDown} />}
            {selectedAnchors.includes(anchor.id) && anchor.outHandle && <HandleLine anchor={anchor} handle="outHandle" selected={selectedHandle?.anchorId === anchor.id && selectedHandle.handle === "outHandle"} onHandleDown={onHandleDown} />}
            <circle cx={anchor.point.x} cy={-anchor.point.y} r={selectedAnchors.includes(anchor.id) ? 1.4 : 1.05} fill={selectedAnchors.includes(anchor.id) ? "hsl(var(--annotation))" : "hsl(var(--annotation-label))"} stroke="hsl(var(--annotation))" strokeWidth="0.45" onPointerDown={(event) => onAnchorDown(event, anchor.id)} />
          </g>
        ))}
      </g>
    </g>
  );
}

function HandleLine({ anchor, handle, selected, onHandleDown }: { anchor: LensAnchor; handle: "inHandle" | "outHandle"; selected: boolean; onHandleDown: (event: PointerEvent<SVGCircleElement>, anchorId: string, handle: "inHandle" | "outHandle") => void }) {
  const p = anchor[handle];
  if (!p) return null;
  return (
    <g>
      <line x1={anchor.point.x} y1={-anchor.point.y} x2={p.x} y2={-p.y} stroke="hsl(var(--annotation))" strokeWidth="0.4" />
      <circle cx={p.x} cy={-p.y} r={selected ? 1.2 : 1} fill="hsl(var(--annotation-label))" stroke="hsl(var(--annotation))" strokeWidth="0.4" onPointerDown={(event) => onHandleDown(event, anchor.id, handle)} />
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
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="hsl(var(--drill-stroke))" strokeWidth={record.diameter} strokeLinecap="round" />
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="hsl(var(--drill-stroke))" strokeWidth={record.diameter + 4} strokeLinecap="round" strokeDasharray="1 1" opacity="0.5" />
      </g>
    );
  }
  return (
    <g key={key}>
      <circle cx={x1} cy={y1} r={r + 2} fill="none" stroke="hsl(var(--drill-stroke))" strokeDasharray="1 1" opacity="0.55" />
      <circle cx={x1} cy={y1} r={Math.max(r, 0.8)} fill="hsl(var(--drill-fill) / 0.5)" stroke="hsl(var(--drill-stroke))" strokeWidth="0.4" />
    </g>
  );
}

function MeasurementLayer({ bounds, dblMm }: { bounds: ReturnType<typeof pathBounds>; dblMm: number }) {
  return (
    <g fill="hsl(var(--preview-text))" fontSize="3.8">
      <text x="-126" y="-80">HBOX {formatNumber(bounds.width, 1)} mm</text>
      <text x="-126" y="-74">VBOX {formatNumber(bounds.height, 1)} mm</text>
      <text x="-126" y="-68">DBL {formatNumber(dblMm, 1)} mm</text>
    </g>
  );
}

function OmaPreview({ radii }: { doc: LensDesignDocument; radii: number[] }) {
  const pts = polarRadiiToPoints(radii);
  const b = {
    minX: Math.min(...pts.map((p) => p.x)),
    maxX: Math.max(...pts.map((p) => p.x)),
    minY: Math.min(...pts.map((p) => p.y)),
    maxY: Math.max(...pts.map((p) => p.y)),
  };
  const w = b.maxX - b.minX || 1;
  const h = b.maxY - b.minY || 1;
  const scale = Math.min(240 / w, 150 / h);
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${160 + (p.x - (b.minX + w / 2)) * scale} ${90 - (p.y - (b.minY + h / 2)) * scale}`).join(" ") + " Z";
  return (
    <svg viewBox="0 0 320 180" className="h-[180px] w-full rounded-md border bg-[hsl(var(--preview-background))]" aria-label="OMA export preview">
      <path d={d} fill="hsl(var(--trace-fill) / 0.7)" stroke="hsl(var(--trace-stroke))" strokeWidth="2" />
    </svg>
  );
}

function ShortcutPopover() {
  return (
    <div className="absolute right-6 top-5 z-20 w-[300px] rounded-md border bg-popover p-4 text-sm shadow-md">
      <div className="mb-2 flex items-center gap-2 font-semibold"><HelpCircle className="h-4 w-4" /> Shortcuts</div>
      <div className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-xs">
        <kbd>V</kbd><span>Selection tool</span>
        <kbd>A</kbd><span>Direct selection</span>
        <kbd>Shift</kbd><span>Multi-select anchors / preserve scale aspect</span>
        <kbd>Del</kbd><span>Delete selected anchors</span>
        <kbd>Double click</kbd><span>Insert anchor on nearest segment</span>
        <kbd>Cmd/Ctrl Z</kbd><span>Undo</span>
      </div>
    </div>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block space-y-1 text-sm"><span className="text-xs font-medium text-muted-foreground">{label}</span><input value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-md border bg-background px-3 py-1.5" /></label>;
}

function NumberField({ label, value, onChange, step = 0.1 }: { label: string; value: number; onChange: (value: number) => void; step?: number }) {
  return <label className="mb-2 block space-y-1 text-sm"><span className="text-xs font-medium text-muted-foreground">{label}</span><input type="number" step={step} value={Number.isFinite(value) ? value : 0} onChange={(event) => onChange(parseFloat(event.target.value) || 0)} className="w-full rounded-md border bg-background px-3 py-1.5" /></label>;
}

const layerNames: Record<LayerKey, string> = {
  face: "Face",
  blanks: "Uncut blanks",
  template: "Frame template",
  reference: "Original trace",
  lens: "Lens shape",
  drills: "Drill features",
  measurements: "Warnings/measurements",
};

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
      if (distance < bestDistance) {
        bestSegmentIndex = segmentIndex;
        bestDistance = distance;
        bestT = t;
      }
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

function toggleInArray(values: string[], value: string) {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

function safeName(value: string) {
  return (value || "lens_design").replace(/[^\w.-]+/g, "_");
}

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable);
}

function toolButton(active: boolean) {
  return `px-3 py-2 transition-colors ${active ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`;
}

function clampScale(value: number) {
  return clamp(value, 0.2, 4);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}
