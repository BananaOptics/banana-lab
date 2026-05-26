import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import type { DrillEye, DrillRecord } from "@/lib/oma";
import { polarRadiiToPoints } from "@/lib/trace-geometry";

const CANVAS_W = 460;
const CANVAS_H = 420;
const CX = CANVAS_W / 2;
const CY = CANVAS_H / 2;
const DIALOG_MARGIN = 16;
const DIALOG_MAX_W = 1100;
const DIALOG_DEFAULT_H = 500;

type DialogPosition = { x: number; y: number };

interface DrillDialogProps {
  trace: DecodedNidekTrace;
  initialRecords: DrillRecord[];
  pxPerMm?: number | null;
  onSave: (records: DrillRecord[]) => void;
  onCancel: () => void;
}

export function DrillDialog({
  trace,
  initialRecords,
  pxPerMm,
  onSave,
  onCancel,
}: DrillDialogProps) {
  const [records, setRecords] = useState<DrillRecord[]>(initialRecords);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverCoords, setHoverCoords] = useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<"fit" | "1:1">("fit");
  const [pos, setPos] = useState(getInitialDialogPosition);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    lastPos: DialogPosition;
  } | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const getDialogBounds = () => {
    const rect = dialogRef.current?.getBoundingClientRect();
    return {
      width: rect?.width ?? Math.min(DIALOG_MAX_W, Math.max(0, window.innerWidth - DIALOG_MARGIN * 2)),
      height: rect?.height ?? DIALOG_DEFAULT_H,
    };
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, lastPos: pos };
    const onMove = (me: MouseEvent) => {
      if (!dragRef.current) return;
      const nextPos = clampDialogPosition({
        x: dragRef.current.origX + me.clientX - dragRef.current.startX,
        y: dragRef.current.origY + me.clientY - dragRef.current.startY,
      }, getDialogBounds());
      dragRef.current.lastPos = nextPos;
      setPos(nextPos);
    };
    const onUp = () => {
      if (dragRef.current) {
        setPos(dragRef.current.lastPos);
      }
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  useEffect(() => {
    const centerInViewport = () => {
      setPos(getCenteredDialogPosition(getDialogBounds()));
    };

    centerInViewport();
    window.addEventListener("resize", centerInViewport);
    return () => window.removeEventListener("resize", centerInViewport);
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  const { lensPath, scale } = useMemo(() => {
    // Produce left-lens points with x+ = temporal, y+ = up.
    // Negate X from source radii so the lens renders front-facing (matching
    // the main preview) — nasal on the left, temporal on the right.
    const rawPts =
      trace.metadata.dblMm > 0
        ? polarRadiiToPoints(trace.radii400)
        : trace.stats.points;
    const pts = rawPts.map((p) => ({ x: -p.x, y: p.y }));

    const xs = pts.map((p) => p.x);
    const ys = pts.map((p) => p.y);
    const w = Math.max(...xs) - Math.min(...xs) || 1;
    const h = Math.max(...ys) - Math.min(...ys) || 1;
    const s = Math.min((CANVAS_W - 80) / w, (CANVAS_H - 80) / h);

    const path =
      pts
        .map((p, i) => {
          const x = CX + p.x * s;
          const y = CY - p.y * s;
          return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
        })
        .join(" ") + " Z";

    return { lensPath: path, scale: s };
  }, [trace]);

  const toOmaCoords = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const svgY = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    return {
      hx: Math.round(((CX - svgX) / scale) * 100) / 100,
      hy: Math.round(((CY - svgY) / scale) * 100) / 100,
    };
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const { hx, hy } = toOmaCoords(e);
    setHoverCoords({ x: hx, y: hy });
  };

  const handleCanvasClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const svgX = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const svgY = (e.clientY - rect.top) * (CANVAS_H / rect.height);
    const hx = Math.round(((CX - svgX) / scale) * 100) / 100;
    const hy = Math.round(((CY - svgY) / scale) * 100) / 100;
    const rec: DrillRecord = {
      id: createId(),
      eye: "B",
      reference: "C",
      x1: hx,
      y1: hy,
      x2: null,
      y2: null,
      diameter: 1.5,
    };
    setRecords((prev) => [...prev, rec]);
    setSelectedId(rec.id);
  };

  const updateRecord = (id: string, patch: Partial<DrillRecord>) =>
    setRecords((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  const removeRecord = (id: string) => {
    setRecords((prev) => prev.filter((r) => r.id !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const addRecord = () => {
    const r: DrillRecord = { id: createId(), eye: "B", reference: "C", x1: 0, y1: 0, x2: null, y2: null, diameter: 1.5 };
    setRecords((prev) => [...prev, r]);
    setSelectedId(r.id);
  };

  const oneToOneW = zoom === "1:1" && pxPerMm ? Math.round(CANVAS_W * pxPerMm / scale) : null;
  const oneToOneH = oneToOneW && pxPerMm ? Math.round(CANVAS_H * pxPerMm / scale) : null;

  // Grid pattern offsets — align grid lines to the boxing centre (CX, CY)
  const minorOx = CX % scale;
  const minorOy = CY % scale;
  const majorOx = CX % (scale * 10);
  const majorOy = CY % (scale * 10);

  return (
    <div
      className="fixed inset-0 z-50 bg-[hsl(var(--overlay)/0.56)]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={dialogRef}
        className="absolute flex max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1100px] flex-col rounded-lg border bg-card text-card-foreground shadow-2xl"
        style={{ left: pos.x, top: pos.y }}
      >
        {/* Header */}
        <div
          className="flex cursor-move select-none items-center justify-between border-b px-6 py-4"
          onMouseDown={handleHeaderMouseDown}
        >
          <h2 className="text-xs font-semibold uppercase tracking-widest">Drill Records</h2>
          <button
            onClick={onCancel}
            className="rounded p-1 text-muted-foreground hover:bg-muted"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1">
          {/* Canvas */}
          <div className="shrink-0 border-r bg-muted/30 p-4">
            <div className="mb-2 flex items-center justify-between">
              <p className="text-[10px] text-muted-foreground">
                Left lens — click to add a record
              </p>
              <div className="flex overflow-hidden rounded border text-[10px] font-medium">
                <button
                  className={`px-2 py-0.5 transition-colors ${zoom === "fit" ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
                  onClick={() => setZoom("fit")}
                >
                  Fit
                </button>
                <button
                  className={`border-l px-2 py-0.5 transition-colors ${zoom === "1:1" ? "bg-primary text-primary-foreground" : "hover:bg-accent"} disabled:cursor-not-allowed disabled:opacity-40`}
                  onClick={() => setZoom("1:1")}
                  disabled={!pxPerMm}
                  title={!pxPerMm ? "Calibrate screen scale first" : "True 1:1 physical scale"}
                >
                  1:1
                </button>
              </div>
            </div>
            <div className={oneToOneW ? "overflow-auto rounded border bg-[hsl(var(--preview-background))]" : ""}>
            <svg
              viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
              {...(oneToOneW
                ? { width: oneToOneW, height: oneToOneH! }
                : { width: CANVAS_W, height: CANVAS_H })}
              onClick={handleCanvasClick}
              onMouseMove={handleCanvasMouseMove}
              onMouseLeave={() => setHoverCoords(null)}
              className="cursor-crosshair rounded border bg-[hsl(var(--preview-background))]"
            >
              <defs>
                <pattern
                  id="drill-minor"
                  width={scale}
                  height={scale}
                  patternUnits="userSpaceOnUse"
                  x={minorOx}
                  y={minorOy}
                >
                  <path
                    d={`M ${scale} 0 L 0 0 0 ${scale}`}
                    fill="none"
                    stroke="hsl(var(--preview-grid))"
                    strokeWidth="0.5"
                  />
                </pattern>
                <pattern
                  id="drill-major"
                  width={scale * 10}
                  height={scale * 10}
                  patternUnits="userSpaceOnUse"
                  x={majorOx}
                  y={majorOy}
                >
                  <path
                    d={`M ${scale * 10} 0 L 0 0 0 ${scale * 10}`}
                    fill="none"
                    stroke="hsl(var(--preview-grid-strong))"
                    strokeWidth="1"
                  />
                </pattern>
              </defs>

              {/* Grid */}
              <rect width={CANVAS_W} height={CANVAS_H} fill="url(#drill-minor)" />
              <rect width={CANVAS_W} height={CANVAS_H} fill="url(#drill-major)" />

              {/* Centre crosshair */}
              <line x1={CX} y1={0} x2={CX} y2={CANVAS_H} stroke="hsl(var(--preview-text))" strokeWidth="1" />
              <line x1={0} y1={CY} x2={CANVAS_W} y2={CY} stroke="hsl(var(--preview-text))" strokeWidth="1" />

              {/* Lens outline */}
              <path
                d={lensPath}
                fill="hsl(var(--trace-fill) / 0.55)"
                stroke="hsl(var(--trace-stroke))"
                strokeWidth="2"
              />

              {/* Drill records */}
              {records
                .filter((r) => r.eye !== "R")
                .map((rec, idx) => {
                  const x1 = CX - rec.x1 * scale;
                  const y1 = CY - rec.y1 * scale;
                  const active = selectedId === rec.id;
                  const fill = active ? "hsl(var(--drill-fill) / 0.55)" : "hsl(var(--drill-fill) / 0.35)";
                  const stroke = active ? "hsl(var(--drill-active-stroke))" : "hsl(var(--drill-stroke))";
                  const sw = active ? 2 : 1.5;
                  const isSlot = rec.x2 !== null && rec.y2 !== null;
                  const cr = Math.max((rec.diameter / 2) * scale, 4);
                  return (
                    <g
                      key={rec.id}
                      onClick={(e) => { e.stopPropagation(); setSelectedId(rec.id); }}
                      style={{ cursor: "pointer" }}
                    >
                      {isSlot ? (() => {
                        const x2 = CX - rec.x2! * scale;
                        const y2 = CY - rec.y2! * scale;
                        const hw = (rec.diameter / 2) * scale;
                        const dx = x2 - x1;
                        const dy = y2 - y1;
                        const len = Math.sqrt(dx * dx + dy * dy) || 1;
                        const angle = Math.atan2(dy, dx) * 180 / Math.PI;
                        const cx2 = (x1 + x2) / 2;
                        const cy2 = (y1 + y2) / 2;
                        return (
                          <rect
                            x={cx2 - len / 2}
                            y={cy2 - hw}
                            width={len}
                            height={hw * 2}
                            rx={hw}
                            fill={fill}
                            stroke={stroke}
                            strokeWidth={sw}
                            transform={`rotate(${angle}, ${cx2}, ${cy2})`}
                          />
                        );
                      })() : (
                        <>
                          <circle cx={x1} cy={y1} r={cr} fill={fill} stroke={stroke} strokeWidth={sw} />
                          <line x1={x1 - cr - 3} y1={y1} x2={x1 + cr + 3} y2={y1} stroke={stroke} strokeWidth="1" />
                          <line x1={x1} y1={y1 - cr - 3} x2={x1} y2={y1 + cr + 3} stroke={stroke} strokeWidth="1" />
                        </>
                      )}
                      <text x={x1} y={y1 - cr - 5} textAnchor="middle" fontSize="10" fill="hsl(var(--preview-text))" fontFamily="system-ui, sans-serif">
                        {idx + 1}
                      </text>
                    </g>
                  );
                })}
              {/* Hover coordinates */}
              {hoverCoords && (
                <text
                  x={CANVAS_W - 6}
                  y={CANVAS_H - 6}
                  textAnchor="end"
                  fontSize="10"
                  fill="hsl(var(--preview-text))"
                  fontFamily="system-ui, sans-serif"
                >
                  {hoverCoords.x.toFixed(2)}, {hoverCoords.y.toFixed(2)}
                </text>
              )}
            </svg>
            </div>
          </div>

          {/* Edit panel */}
          <div className="flex min-h-0 flex-1 flex-col overflow-auto p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-widest">Drill Records</h3>
              <Button variant="outline" size="sm" onClick={addRecord}>
                <Plus className="h-3.5 w-3.5" />
                Add
              </Button>
            </div>
            {records.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No records. Click in the lens or use Add.
              </p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className="pb-1.5 text-left font-medium w-5">#</th>
                    <th className="pb-1.5 text-left font-medium">X1</th>
                    <th className="pb-1.5 text-left font-medium">Y1</th>
                    <th className="pb-1.5 text-left font-medium">X2</th>
                    <th className="pb-1.5 text-left font-medium">Y2</th>
                    <th className="pb-1.5 text-left font-medium">Ø</th>
                    <th className="pb-1.5 text-left font-medium">Eye</th>
                    <th className="pb-1.5 w-7" />
                  </tr>
                </thead>
                <tbody>
                  {records.map((rec, idx) => (
                    <tr
                      key={rec.id}
                      className={`border-b last:border-0 transition-colors ${selectedId === rec.id ? "bg-[hsl(var(--selected))]" : "hover:bg-muted/30"}`}
                      onClick={() => setSelectedId(rec.id)}
                    >
                      <td className="py-1.5 pr-2 text-[11px] text-muted-foreground">{idx + 1}</td>
                      <td className="py-1.5 pr-1">
                        <DrillNumInput value={rec.x1} onChange={(x1) => updateRecord(rec.id, { x1 })} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <DrillNumInput value={rec.y1} onChange={(y1) => updateRecord(rec.id, { y1 })} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <DrillNullableInput
                          value={rec.x2}
                          onChange={(x2) => updateRecord(rec.id, { x2 })}
                        />
                      </td>
                      <td className="py-1.5 pr-1">
                        <DrillNullableInput
                          value={rec.y2}
                          onChange={(y2) => updateRecord(rec.id, { y2 })}
                        />
                      </td>
                      <td className="py-1.5 pr-1">
                        <DrillNumInput value={rec.diameter} onChange={(diameter) => updateRecord(rec.id, { diameter })} />
                      </td>
                      <td className="py-1.5 pr-1">
                        <select
                          value={rec.eye}
                          onChange={(e) => updateRecord(rec.id, { eye: e.target.value as DrillEye })}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded border bg-background px-1 py-1 text-xs"
                        >
                          <option value="B">Both</option>
                          <option value="R">R</option>
                          <option value="L">L</option>
                        </select>
                      </td>
                      <td className="py-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); removeRecord(rec.id); }}
                          className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          aria-label="Remove"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 border-t px-6 py-4">
          <Button onClick={() => onSave(records)}>Save</Button>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
    </div>
  );
}

function DrillNumInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(String(value));
  }, [focused, value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value);
        if (!isNaN(n)) onChange(n);
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(String(value));
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-14 rounded border bg-background px-1.5 py-1 text-xs"
    />
  );
}

function DrillNullableInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) setDraft(value === null ? "" : String(value));
  }, [focused, value]);

  return (
    <input
      type="text"
      inputMode="decimal"
      placeholder="—"
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value === "" || e.target.value === "-") {
          onChange(null);
        } else {
          const n = parseFloat(e.target.value);
          if (!isNaN(n)) onChange(n);
        }
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setDraft(value === null ? "" : String(value));
      }}
      onClick={(e) => e.stopPropagation()}
      className="w-14 rounded border bg-background px-1.5 py-1 text-xs placeholder:text-muted-foreground/50"
    />
  );
}

function createId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `d_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getInitialDialogPosition(): DialogPosition {
  const width = Math.min(DIALOG_MAX_W, Math.max(0, window.innerWidth - DIALOG_MARGIN * 2));
  return getCenteredDialogPosition({ width, height: DIALOG_DEFAULT_H });
}

function getCenteredDialogPosition(size: { width: number; height: number }): DialogPosition {
  return clampDialogPosition(
    {
      x: (window.innerWidth - size.width) / 2,
      y: (window.innerHeight - size.height) / 2,
    },
    size,
  );
}

function clampDialogPosition(
  pos: DialogPosition,
  size: { width: number; height: number },
): DialogPosition {
  const maxX = Math.max(DIALOG_MARGIN, window.innerWidth - size.width - DIALOG_MARGIN);
  const maxY = Math.max(DIALOG_MARGIN, window.innerHeight - size.height - DIALOG_MARGIN);

  return {
    x: Math.min(Math.max(pos.x, DIALOG_MARGIN), maxX),
    y: Math.min(Math.max(pos.y, DIALOG_MARGIN), maxY),
  };
}
