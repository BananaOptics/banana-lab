import type { DecodedNidekTrace } from "@/lib/nidek-native";
import {
  formatNumber,
  mirrorClosedRadiiHorizontally,
} from "@/lib/trace-geometry";

export type OmaPointCount = 400 | 1000;
export type DrillEye = "B" | "R" | "L";
export type DrillReference = "C";

/**
 * A drill record. If x2/y2 are null it is a hole (DRILLE); if x2/y2 are
 * provided it is a slot (DRILLES) defined by its two endpoints.
 */
export interface DrillRecord {
  id: string;
  eye: DrillEye;
  reference: DrillReference;
  x1: number;
  y1: number;
  x2: number | null;
  y2: number | null;
  diameter: number;
}

export interface OmaFile {
  fileName: string;
  content: string;
  pointCount: OmaPointCount;
}

export interface OmaJobInfo {
  job: string;
  ven: string;
  model: string;
  wrapang: string;
  panto: string;
}

export function freshJobName(): string {
  return `trace_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function buildOmaFiles(
  trace: DecodedNidekTrace,
  jobInfo: OmaJobInfo,
  drillRecords: DrillRecord[] = [],
  dblOverrideMm?: number,
): OmaFile[] {
  return [
    {
      fileName: `${jobInfo.job}_400.oma`,
      content: buildOmaContent(trace, 400, jobInfo, drillRecords, dblOverrideMm),
      pointCount: 400,
    },
    {
      fileName: `${jobInfo.job}_1000.oma`,
      content: buildOmaContent(trace, 1000, jobInfo, drillRecords, dblOverrideMm),
      pointCount: 1000,
    },
  ];
}

export function buildOmaContent(
  trace: DecodedNidekTrace,
  pointCount: OmaPointCount,
  jobInfo: OmaJobInfo,
  drillRecords: DrillRecord[] = [],
  dblOverrideMm?: number,
) {
  const radii = pointCount === 400 ? trace.radii400 : trace.radii1000;
  const wrapang = parseFloat(jobInfo.wrapang);
  const panto = parseFloat(jobInfo.panto);

  // For single-lens frameless traces (side=R or side=L, no measured DBL), output
  // TRCFMT=B with both R= and L= — the untraced eye is the horizontal mirror of
  // the traced eye. This is the standard approach for rimless/frameless orders and
  // prevents lab software from misidentifying which eye is which.
  const isSingleLens = trace.metadata.side !== "B";
  const dblMm =
    dblOverrideMm !== undefined ? dblOverrideMm : trace.metadata.dblMm;

  // Determine R and L radii arrays.
  // The raw radii always represent the right-lens shape (or the bilateral right half).
  // L= must always be the horizontal mirror, except when the device traced the left
  // lens only (side="L"), in which case the raw radii are already the left shape.
  const rRadii =
    isSingleLens && trace.metadata.side === "L"
      ? mirrorClosedRadiiHorizontally(radii)
      : radii;
  const lRadii =
    trace.metadata.side === "L"
      ? radii
      : mirrorClosedRadiiHorizontally(radii);

  const lines = [
    `JOB=${jobInfo.job}`,
    "REQ=TRC",
    ...(jobInfo.ven ? [`VEN=${jobInfo.ven}`] : []),
    ...(jobInfo.model ? [`MODEL=${jobInfo.model}`] : []),
    `HBOX=${formatNumber(trace.stats.hboxMm, 2)}`,
    `VBOX=${formatNumber(trace.stats.vboxMm, 2)}`,
    `DBL=${dblMm.toFixed(2)}`,
    `CIRC=${formatNumber(trace.stats.circMm, 2)}`,
    `FCRV=${formatNumber(trace.metadata.fcrv, 1)}`,
    ...(!isNaN(wrapang) ? [`WRAPANG=${formatNumber(wrapang, 1)}`] : []),
    ...(!isNaN(panto) ? [`PANTO=${formatNumber(panto, 1)}`] : []),
    `TRCFMT=1;${pointCount};E;R;B`,
    `R=${rRadii.join(";")}`,
    `L=${lRadii.join(";")}`,
    ...drillRecords.map(formatDrillRecord),
  ];

  return `${lines.join("\r\n")}\r\n`;
}

function formatDrillRecord(r: DrillRecord): string {
  if (r.x2 === null || r.y2 === null) {
    // Hole
    return `DRILLE=${[r.eye, r.reference, formatNumber(r.x1, 2), formatNumber(r.y1, 2), formatNumber(r.diameter, 2)].join(";")}`;
  }
  // Slot — compute center, angle, and length from the two endpoints
  const cx = (r.x1 + r.x2) / 2;
  const cy = (r.y1 + r.y2) / 2;
  const dx = r.x2 - r.x1;
  const dy = r.y2 - r.y1;
  const length = Math.sqrt(dx * dx + dy * dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return `DRILLES=${[r.eye, r.reference, formatNumber(cx, 2), formatNumber(cy, 2), formatNumber(angle, 1), formatNumber(length, 2), formatNumber(r.diameter, 2)].join(";")}`;
}
