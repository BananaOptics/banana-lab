import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import type { DrillRecord } from "@/lib/oma";
import { buildTwoLensPaths } from "@/lib/trace-rendering";
import { formatNumber, polarRadiiToPoints } from "@/lib/trace-geometry";

const PREVIEW_WIDTH = 640;
const PREVIEW_HEIGHT = 480;
const VBOX_LABEL_WIDTH = 76;
const VBOX_LABEL_HEIGHT = 16;
const VBOX_LABEL_GAP = 4;
const VBOX_OUTSET = 14;
const DBL_LABEL_WIDTH = 72;
const DBL_LABEL_HEIGHT = 16;

interface TracePreviewProps {
  trace: DecodedNidekTrace | null;
  drillRecords?: DrillRecord[];
  invalidDrillRecordIds?: Set<string>;
  isLoading?: boolean;
  zoom?: "fit" | "1:1";
  pxPerMm?: number | null;
}

export function TracePreview({ trace, drillRecords = [], invalidDrillRecordIds = new Set(), isLoading = false, zoom = "fit", pxPerMm = null }: TracePreviewProps) {
  const svgPaths = useMemo(() => {
    if (!trace) return null;
    if (trace.metadata.dblMm > 0) {
      return buildTwoLensPaths(trace);
    }
    return { single: buildSvgPath(trace.stats.points) };
  }, [trace]);

  if (!trace || !svgPaths) {
    return (
      <div className="flex aspect-[4/3] min-h-[240px] items-center justify-center rounded-md border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground sm:min-h-[320px]">
        {isLoading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/60" />
            <span className="max-w-[260px]">Capturing trace&hellip;</span>
          </div>
        ) : (
          <span className="max-w-[260px]">Trace preview appears after a successful capture.</span>
        )}
      </div>
    );
  }

  const stats = trace.stats;
  const metadata = trace.metadata;
  const isBoth = metadata.dblMm > 0;

  const svgScale = "single" in svgPaths ? svgPaths.single.scale : svgPaths.scale;
  const oneToOneW = zoom === "1:1" && pxPerMm ? PREVIEW_WIDTH * pxPerMm / svgScale : null;
  const oneToOneH = oneToOneW ? PREVIEW_HEIGHT * pxPerMm! / svgScale : null;

  return (
    <div className="space-y-4">
      <div className={oneToOneW ? "overflow-auto rounded-md border bg-white flex justify-center items-start" : "relative aspect-[4/3] min-h-[240px] overflow-hidden rounded-md border bg-white sm:min-h-[320px]"}>
        <svg
          viewBox={`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`}
          {...(oneToOneW
            ? { width: Math.round(oneToOneW), height: Math.round(oneToOneH!) }
            : { className: "h-full w-full" })}
          role="img"
          aria-label="Decoded frame trace preview"
        >
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="hsl(220 10% 90%)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width={PREVIEW_WIDTH} height={PREVIEW_HEIGHT} fill="url(#grid)" />
          <line x1="320" y1="40" x2="320" y2="440" stroke="hsl(220 10% 80%)" strokeWidth="1.5" />
          <line x1="80" y1="240" x2="560" y2="240" stroke="hsl(220 10% 80%)" strokeWidth="1.5" />
          <text x={PREVIEW_WIDTH - 24} y={28} textAnchor="end" fontSize="11" fill="hsl(220 12% 42%)" fontFamily="system-ui, sans-serif">
            Dimensions in mm
          </text>

          {"single" in svgPaths ? (
            <>
              <HVBoxAnnotation
                cx={320}
                cy={240}
                hboxMm={stats.hboxMm}
                vboxMm={stats.vboxMm}
                scale={svgPaths.single.scale}
              />
              <path d={svgPaths.single.path} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
              <DrillRecordOverlay
                records={drillRecords}
                invalidRecordIds={invalidDrillRecordIds}
                scale={svgPaths.single.scale}
                rightCenterX={320}
                leftCenterX={320}
                cy={240}
                singleSide={metadata.side}
              />
            </>
          ) : (
            <>
              {/* HBOX/VBOX boxes — drawn before lens paths so shapes appear on top */}
              <HVBoxAnnotation
                cx={svgPaths.rCenterX}
                cy={240}
                hboxMm={stats.hboxMm}
                vboxMm={stats.vboxMm}
                scale={svgPaths.scale}
                showVbox={false}
              />
              <HVBoxAnnotation
                cx={svgPaths.lCenterX}
                cy={240}
                hboxMm={stats.hboxMm}
                vboxMm={stats.vboxMm}
                scale={svgPaths.scale}
                showHbox={false}
                vboxSide="left"
              />
              <DblBoxAnnotation
                x1={svgPaths.dblX1}
                x2={svgPaths.dblX2}
                cy={240}
                vboxMm={stats.vboxMm}
                scale={svgPaths.scale}
                dblMm={metadata.dblMm}
              />
              {/* Lens shapes */}
              <path d={svgPaths.r} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
              <path d={svgPaths.l} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
              <DrillRecordOverlay
                records={drillRecords}
                invalidRecordIds={invalidDrillRecordIds}
                scale={svgPaths.scale}
                rightCenterX={svgPaths.rCenterX}
                leftCenterX={svgPaths.lCenterX}
                cy={240}
              />
            </>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Captured side" field="Side" value={{ R: "Right lens", L: "Left lens", B: "Both lenses" }[metadata.side] ?? metadata.side} />
        <Metric label="Lens width" field="HBOX" value={`${formatNumber(stats.hboxMm, 2)} mm`} />
        <Metric label="Lens height" field="VBOX" value={`${formatNumber(stats.vboxMm, 2)} mm`} />
        <Metric label="Bridge distance" field="DBL" value={`${formatNumber(metadata.dblMm, 2)} mm`} />
        <Metric label="Circumference" field="CIRC" value={`${formatNumber(stats.circMm, 2)} mm`} />
        <Metric label="Base curve" field="FCRV" value={formatNumber(metadata.fcrv, 1)} />
      </div>
    </div>
  );
}

function DrillRecordOverlay({
  records,
  invalidRecordIds,
  scale,
  rightCenterX,
  leftCenterX,
  cy,
  singleSide,
}: {
  records: DrillRecord[];
  invalidRecordIds: Set<string>;
  scale: number;
  rightCenterX: number;
  leftCenterX: number;
  cy: number;
  singleSide?: "R" | "L" | "B";
}) {
  if (records.length === 0) return null;

  const strokeWidth = Math.max(1.5, 0.12 * scale);

  return (
    <g aria-label="Drill records">
      {records.flatMap((rec) => {
        const isInvalid = invalidRecordIds.has(rec.id);
        const stroke = isInvalid ? "hsl(0 78% 50%)" : "hsl(30 92% 42%)";
        const fill = isInvalid ? "hsl(0 78% 50% / 0.18)" : "hsl(42 96% 58% / 0.32)";
        const isSlot = rec.x2 !== null && rec.y2 !== null;

        const renderFor = (key: string, cx: number, mirrorX: boolean) => {
          const sx1 = mirrorX ? -rec.x1 : rec.x1;
          const svgX1 = cx + sx1 * scale;
          const svgY1 = cy - rec.y1 * scale;

          if (isSlot) {
            const sx2 = mirrorX ? -rec.x2! : rec.x2!;
            const svgX2 = cx + sx2 * scale;
            const svgY2 = cy - rec.y2! * scale;
            const dx = svgX2 - svgX1;
            const dy = svgY2 - svgY1;
            const len = Math.sqrt(dx * dx + dy * dy) || 1;
            const hw = (rec.diameter / 2) * scale;
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            const mcx = (svgX1 + svgX2) / 2;
            const mcy = (svgY1 + svgY2) / 2;
            return (
              <rect
                key={key}
                x={mcx - len / 2}
                y={mcy - hw}
                width={len}
                height={hw * 2}
                rx={hw}
                fill={fill}
                stroke={stroke}
                strokeWidth={strokeWidth}
                transform={`rotate(${angle}, ${mcx}, ${mcy})`}
              />
            );
          }

          const r = Math.max((rec.diameter / 2) * scale, 3);
          return (
            <g key={key}>
              <circle cx={svgX1} cy={svgY1} r={r} fill={fill} stroke={stroke} strokeWidth={strokeWidth} />
              <line x1={svgX1 - r - 3} y1={svgY1} x2={svgX1 + r + 3} y2={svgY1} stroke={stroke} strokeWidth="1" />
              <line x1={svgX1} y1={svgY1 - r - 3} x2={svgX1} y2={svgY1 + r + 3} stroke={stroke} strokeWidth="1" />
            </g>
          );
        };

        if (singleSide === "R") {
          if (rec.eye === "L") return [];
          return [renderFor(`${rec.id}-r`, rightCenterX, false)];
        }
        if (singleSide === "L") {
          if (rec.eye === "R") return [];
          return [renderFor(`${rec.id}-l`, leftCenterX, true)];
        }
        return [
          ...(rec.eye === "B" || rec.eye === "R" ? [renderFor(`${rec.id}-r`, rightCenterX, false)] : []),
          ...(rec.eye === "B" || rec.eye === "L" ? [renderFor(`${rec.id}-l`, leftCenterX, true)] : []),
        ];
      })}
    </g>
  );
}

function HVBoxAnnotation({
  cx,
  cy,
  hboxMm,
  vboxMm,
  scale,
  showHbox = true,
  showVbox = true,
  vboxSide = "right",
}: {
  cx: number;
  cy: number;
  hboxMm: number;
  vboxMm: number;
  scale: number;
  showHbox?: boolean;
  showVbox?: boolean;
  vboxSide?: "left" | "right";
}) {
  const hw = (hboxMm / 2) * scale;
  const hh = (vboxMm / 2) * scale;
  const left = cx - hw;
  const right = cx + hw;
  const top = cy - hh;
  const bottom = cy + hh;

  const annColor = "hsl(210 55% 48%)";
  const labelColor = "hsl(210 55% 32%)";
  const font = "system-ui, sans-serif";

  // HBOX: dimension line 14px below the box
  const hAnnY = bottom + 14;

  const rightLabelEnd = right + VBOX_OUTSET + VBOX_LABEL_GAP + VBOX_LABEL_WIDTH;
  const leftLabelStart = left - VBOX_OUTSET - VBOX_LABEL_GAP - VBOX_LABEL_WIDTH;
  const canUseRightVbox = rightLabelEnd <= PREVIEW_WIDTH;
  const canUseLeftVbox = leftLabelStart >= 0;
  const resolvedVboxSide =
    vboxSide === "right"
      ? canUseRightVbox || !canUseLeftVbox
        ? "right"
        : "left"
      : canUseLeftVbox || !canUseRightVbox
        ? "left"
        : "right";

  // VBOX: dimension line outside the box on whichever side fits in the preview.
  const vAnnX = resolvedVboxSide === "right" ? right + VBOX_OUTSET : left - VBOX_OUTSET;
  const vboxLabelX =
    resolvedVboxSide === "right"
      ? clamp(vAnnX + VBOX_LABEL_GAP, 0, PREVIEW_WIDTH - VBOX_LABEL_WIDTH)
      : clamp(vAnnX - VBOX_LABEL_GAP - VBOX_LABEL_WIDTH, 0, PREVIEW_WIDTH - VBOX_LABEL_WIDTH);

  return (
    <>
      {/* Bounding box */}
      <rect
        x={left}
        y={top}
        width={hw * 2}
        height={hh * 2}
        fill="none"
        stroke={annColor}
        strokeWidth="1"
        strokeDasharray="4 3"
        opacity="0.65"
      />

      {/* HBOX dimension */}
      {showHbox && (
        <>
          <line x1={left} y1={hAnnY} x2={right} y2={hAnnY} stroke={annColor} strokeWidth="1" />
          <line x1={left} y1={hAnnY - 6} x2={left} y2={hAnnY + 6} stroke={annColor} strokeWidth="1" />
          <line x1={right} y1={hAnnY - 6} x2={right} y2={hAnnY + 6} stroke={annColor} strokeWidth="1" />
          <rect x={cx - 38} y={hAnnY + 4} width={76} height={16} fill="white" rx="3" />
          <text x={cx} y={hAnnY + 16} textAnchor="middle" fontSize="11" fill={labelColor} fontFamily={font}>
            {`HBOX ${formatNumber(hboxMm, 1)}`}
          </text>
        </>
      )}

      {/* VBOX dimension */}
      {showVbox && (
        <>
          <line x1={vAnnX} y1={top} x2={vAnnX} y2={bottom} stroke={annColor} strokeWidth="1" />
          <line x1={vAnnX - 6} y1={top} x2={vAnnX + 6} y2={top} stroke={annColor} strokeWidth="1" />
          <line x1={vAnnX - 6} y1={bottom} x2={vAnnX + 6} y2={bottom} stroke={annColor} strokeWidth="1" />
          {resolvedVboxSide === "right" ? (
            <>
              <rect x={vboxLabelX} y={cy - VBOX_LABEL_HEIGHT / 2} width={VBOX_LABEL_WIDTH} height={VBOX_LABEL_HEIGHT} fill="white" rx="3" />
              <text x={vboxLabelX + 4} y={cy + 4} textAnchor="start" fontSize="11" fill={labelColor} fontFamily={font}>
                {`VBOX ${formatNumber(vboxMm, 1)}`}
              </text>
            </>
          ) : (
            <>
              <rect x={vboxLabelX} y={cy - VBOX_LABEL_HEIGHT / 2} width={VBOX_LABEL_WIDTH} height={VBOX_LABEL_HEIGHT} fill="white" rx="3" />
              <text x={vboxLabelX + VBOX_LABEL_WIDTH - 4} y={cy + 4} textAnchor="end" fontSize="11" fill={labelColor} fontFamily={font}>
                {`VBOX ${formatNumber(vboxMm, 1)}`}
              </text>
            </>
          )}
        </>
      )}
    </>
  );
}

function DblBoxAnnotation({
  x1,
  x2,
  cy,
  vboxMm,
  scale,
  dblMm,
}: {
  x1: number;
  x2: number;
  cy: number;
  vboxMm: number;
  scale: number;
  dblMm: number;
}) {
  const hh = (vboxMm / 2) * scale;
  const top = cy - hh;
  const bottom = cy + hh;
  const centerX = (x1 + x2) / 2;
  const labelX = clamp(centerX - DBL_LABEL_WIDTH / 2, 0, PREVIEW_WIDTH - DBL_LABEL_WIDTH);
  const annColor = "hsl(210 55% 48%)";
  const labelColor = "hsl(210 55% 32%)";
  const font = "system-ui, sans-serif";

  return (
    <>
      <rect
        x={x1}
        y={top}
        width={x2 - x1}
        height={bottom - top}
        fill="hsl(210 55% 48% / 0.06)"
        stroke={annColor}
        strokeWidth="1"
        strokeDasharray="4 3"
        opacity="0.75"
      />
      <line x1={x1} y1={top} x2={x2} y2={top} stroke={annColor} strokeWidth="1" />
      <line x1={x1} y1={top - 6} x2={x1} y2={top + 6} stroke={annColor} strokeWidth="1" />
      <line x1={x2} y1={top - 6} x2={x2} y2={top + 6} stroke={annColor} strokeWidth="1" />
      <rect x={labelX} y={top - DBL_LABEL_HEIGHT / 2} width={DBL_LABEL_WIDTH} height={DBL_LABEL_HEIGHT} fill="white" rx="3" />
      <text x={labelX + DBL_LABEL_WIDTH / 2} y={top + 4} textAnchor="middle" fontSize="11" fill={labelColor} fontFamily={font}>
        {`DBL ${formatNumber(dblMm, 1)}`}
      </text>
    </>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function Metric({ label, field, value }: { label: string; field: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-xs font-medium tracking-normal text-foreground">{label}</div>
        <div className="text-[10px] font-medium uppercase tracking-normal text-muted-foreground">{field}</div>
      </div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function buildSvgPath(points: { x: number; y: number }[]): { path: string; scale: number } {
  if (points.length === 0) return { path: "", scale: 1 };

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const scale = Math.min(460 / width, 340 / height);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const commands = points.map((p, i) => {
    const x = 320 + (p.x - centerX) * scale;
    const y = 240 - (p.y - centerY) * scale;
    return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return { path: `${commands.join(" ")} Z`, scale };
}
