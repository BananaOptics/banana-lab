import { useMemo } from "react";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { formatNumber } from "@/lib/trace-geometry";

interface TracePreviewProps {
  trace: DecodedNidekTrace | null;
}

export function TracePreview({ trace }: TracePreviewProps) {
  const path = useMemo(() => {
    if (!trace) return null;
    return buildSvgPath(trace.stats.points);
  }, [trace]);

  if (!trace || !path) {
    return (
      <div className="flex aspect-[4/3] min-h-[240px] items-center justify-center rounded-md border border-dashed bg-muted/30 px-6 text-center text-sm text-muted-foreground sm:min-h-[320px]">
        <span className="max-w-[260px]">Trace preview appears after a successful capture.</span>
      </div>
    );
  }

  const stats = trace.stats;
  const metadata = trace.metadata;

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
          <path d={path} fill="hsl(154 22% 90% / 0.68)" stroke="hsl(163 42% 28%)" strokeWidth="3" />
        </svg>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Metric label="Side" value={{ R: "Right", L: "Left", B: "Both" }[metadata.side]} />
        <Metric label="HBOX" value={`${formatNumber(stats.hboxMm, 2)} mm`} />
        <Metric label="VBOX" value={`${formatNumber(stats.vboxMm, 2)} mm`} />
        <Metric label="DBL" value={`${formatNumber(metadata.dblMm, 2)} mm`} />
        <Metric label="CIRC" value={`${formatNumber(stats.circMm, 2)} mm`} />
        <Metric label="FCRV" value={formatNumber(metadata.fcrv, 1)} />
      </div>
    </div>
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

function buildSvgPath(points: { x: number; y: number }[]) {
  if (points.length === 0) return "";

  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX || 1;
  const height = maxY - minY || 1;
  const scale = Math.min(460 / width, 340 / height);
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  const commands = points.map((point, index) => {
    const x = 320 + (point.x - centerX) * scale;
    const y = 240 - (point.y - centerY) * scale;
    return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
  });

  return `${commands.join(" ")} Z`;
}
