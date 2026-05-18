import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { formatNumber } from "@/lib/trace-geometry";

export type OmaPointCount = 400 | 1000;

export interface OmaFile {
  fileName: string;
  content: string;
  pointCount: OmaPointCount;
}

export function buildOmaFiles(trace: DecodedNidekTrace, capturedAt = new Date()): OmaFile[] {
  const stamp = capturedAt.toISOString().replace(/[:.]/g, "-");
  const baseName = `trace_nidek_lt900_std_${stamp}`;

  return [
    {
      fileName: `${baseName}_400.oma`,
      content: buildOmaContent(trace, 400, baseName),
      pointCount: 400,
    },
    {
      fileName: `${baseName}_1000.oma`,
      content: buildOmaContent(trace, 1000, baseName),
      pointCount: 1000,
    },
  ];
}

export function buildOmaContent(trace: DecodedNidekTrace, pointCount: OmaPointCount, jobName: string) {
  const radii = pointCount === 400 ? trace.radii400 : trace.radii1000;
  const lines = [
    `JOB=${jobName}`,
    "REQ=TRC",
    "VEN=Nidek",
    "MODEL=LT-900",
    `HBOX=${formatNumber(trace.stats.hboxMm, 2)}`,
    `VBOX=${formatNumber(trace.stats.vboxMm, 2)}`,
    `DBL=${formatNumber(trace.metadata.dblMm, 2)}`,
    `CIRC=${formatNumber(trace.stats.circMm, 2)}`,
    `FCRV=${formatNumber(trace.metadata.fcrv, 1)}`,
    `TRCFMT=1;${pointCount};E;R;${trace.metadata.dblMm > 0 ? "B" : trace.metadata.side}`,
    ...(trace.metadata.side === "R" || trace.metadata.side === "B" || trace.metadata.dblMm > 0 ? [`R=${radii.join(";")}`] : []),
    ...(trace.metadata.side === "L" || trace.metadata.side === "B" || trace.metadata.dblMm > 0 ? [`L=${radii.join(";")}`] : []),
  ];

  return `${lines.join("\r\n")}\r\n`;
}
