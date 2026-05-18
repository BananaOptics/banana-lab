import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { formatNumber, polarRadiiToPoints } from "@/lib/trace-geometry";

interface TracePreviewProps {
  trace: DecodedNidekTrace | null;
  isLoading?: boolean;
}

export function TracePreview({ trace, isLoading = false }: TracePreviewProps) {
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

  return (
    <div className="space-y-4">
      <div className="relative aspect-[4/3] min-h-[240px] overflow-hidden rounded-md border bg-white sm:min-h-[320px]">
        <svg viewBox="0 0 640 480" className="h-full w-full" role="img" aria-label="Decoded frame trace preview">
          <defs>
            <pattern id="grid" width="32" height="32" patternUnits="userSpaceOnUse">
              <path d="M 32 0 L 0 0 0 32" fill="none" stroke="hsl(220 10% 90%)" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="640" height="480" fill="url(#grid)" />
          <line x1="320" y1="40" x2="320" y2="440" stroke="hsl(220 10% 80%)" strokeWidth="1.5" />
          <line x1="80" y1="240" x2="560" y2="240" stroke="hsl(220 10% 80%)" strokeWidth="1.5" />

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
            </>
          ) : (
            <>
              {/* DBL shaded region */}
              <rect
                x={svgPaths.dblX1}
                y={40}
                width={svgPaths.dblX2 - svgPaths.dblX1}
                height={400}
                fill="hsl(220 15% 50% / 0.07)"
              />
              {/* DBL boundary lines */}
              <line x1={svgPaths.dblX1} y1={40} x2={svgPaths.dblX1} y2={440} stroke="hsl(220 30% 55%)" strokeWidth="1.5" strokeDasharray="5 4" />
              <line x1={svgPaths.dblX2} y1={40} x2={svgPaths.dblX2} y2={440} stroke="hsl(220 30% 55%)" strokeWidth="1.5" strokeDasharray="5 4" />
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
              {/* Lens shapes */}
              <path d={svgPaths.r} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
              <path d={svgPaths.l} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
              {/* DBL dimension annotation — on top of everything */}
              <line x1={svgPaths.dblX1} y1={64} x2={svgPaths.dblX2} y2={64} stroke="hsl(220 30% 50%)" strokeWidth="1" />
              <line x1={svgPaths.dblX1} y1={57} x2={svgPaths.dblX1} y2={71} stroke="hsl(220 30% 50%)" strokeWidth="1" />
              <line x1={svgPaths.dblX2} y1={57} x2={svgPaths.dblX2} y2={71} stroke="hsl(220 30% 50%)" strokeWidth="1" />
              <rect x={(svgPaths.dblX1 + svgPaths.dblX2) / 2 - 36} y={51} width={72} height={16} fill="white" rx="3" />
              <text
                x={(svgPaths.dblX1 + svgPaths.dblX2) / 2}
                y={63}
                textAnchor="middle"
                fontSize="11"
                fill="hsl(220 30% 40%)"
                fontFamily="system-ui, sans-serif"
              >
                {`DBL ${formatNumber(metadata.dblMm, 1)} mm`}
              </text>
            </>
          )}
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Side" value={isBoth ? "Both" : ({ R: "Right", L: "Left", B: "Both" }[metadata.side] ?? metadata.side)} />
        <Metric label="HBOX" value={`${formatNumber(stats.hboxMm, 2)} mm`} />
        <Metric label="VBOX" value={`${formatNumber(stats.vboxMm, 2)} mm`} />
        <Metric label="DBL" value={`${formatNumber(metadata.dblMm, 2)} mm`} />
        <Metric label="CIRC" value={`${formatNumber(stats.circMm, 2)} mm`} />
        <Metric label="FCRV" value={formatNumber(metadata.fcrv, 1)} />
      </div>
    </div>
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

  // VBOX: dimension line 14px outside the box on the chosen side
  const vAnnX = vboxSide === "right" ? right + 14 : left - 14;

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
            {`HBOX ${formatNumber(hboxMm, 1)} mm`}
          </text>
        </>
      )}

      {/* VBOX dimension */}
      {showVbox && (
        <>
          <line x1={vAnnX} y1={top} x2={vAnnX} y2={bottom} stroke={annColor} strokeWidth="1" />
          <line x1={vAnnX - 6} y1={top} x2={vAnnX + 6} y2={top} stroke={annColor} strokeWidth="1" />
          <line x1={vAnnX - 6} y1={bottom} x2={vAnnX + 6} y2={bottom} stroke={annColor} strokeWidth="1" />
          {vboxSide === "right" ? (
            <>
              <rect x={vAnnX + 4} y={cy - 8} width={76} height={16} fill="white" rx="3" />
              <text x={vAnnX + 8} y={cy + 4} textAnchor="start" fontSize="11" fill={labelColor} fontFamily={font}>
                {`VBOX ${formatNumber(vboxMm, 1)} mm`}
              </text>
            </>
          ) : (
            <>
              <rect x={vAnnX - 80} y={cy - 8} width={76} height={16} fill="white" rx="3" />
              <text x={vAnnX - 8} y={cy + 4} textAnchor="end" fontSize="11" fill={labelColor} fontFamily={font}>
                {`VBOX ${formatNumber(vboxMm, 1)} mm`}
              </text>
            </>
          )}
        </>
      )}
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <div className="text-xs font-medium uppercase tracking-normal text-muted-foreground">{label}</div>
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

function buildTwoLensPaths(trace: DecodedNidekTrace) {
  const rPoints = polarRadiiToPoints(trace.radii400);
  const hboxMm = trace.stats.hboxMm;
  const dblMm = trace.metadata.dblMm;
  const vboxMm = trace.stats.vboxMm;

  const totalWidthMm = 2 * hboxMm + dblMm;
  const scale = Math.min(560 / totalWidthMm, 340 / vboxMm);

  const rCenterX = 320 + (dblMm / 2 + hboxMm / 2) * scale;
  const lCenterX = 320 - (dblMm / 2 + hboxMm / 2) * scale;

  const buildPath = (points: { x: number; y: number }[], cx: number, mirrorX: boolean) =>
    points
      .map((p, i) => {
        const x = cx + (mirrorX ? -p.x : p.x) * scale;
        const y = 240 - p.y * scale;
        return `${i === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(" ") + " Z";

  return {
    r: buildPath(rPoints, rCenterX, false),
    l: buildPath(rPoints, lCenterX, true),
    dblX1: 320 - (dblMm / 2) * scale,
    dblX2: 320 + (dblMm / 2) * scale,
    scale,
    rCenterX,
    lCenterX,
  };
}
