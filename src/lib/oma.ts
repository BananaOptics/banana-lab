import type { DecodedNidekTrace } from "@/lib/nidek-native";
import {
  formatNumber,
  mirrorClosedRadiiHorizontally,
  resampleClosedRadii,
  summarizeRadii,
} from "@/lib/trace-geometry";

export type OmaPointCount = 400 | 1000;
export type DrillEye = "B" | "R" | "L";
export type DrillReference = "C";

/**
 * A drill record. If x2/y2 are null it is a hole; if x2/y2 are provided it is
 * a slot. VCA/OMA uses DRILLE for both cases, with optional end coordinates
 * for slots.
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

export interface ParsedOmaDocument {
  fileName: string;
  jobInfo: OmaJobInfo;
  trace: DecodedNidekTrace;
  drillRecords: DrillRecord[];
  pointCount: OmaPointCount;
  warnings: string[];
}

export function freshJobName(): string {
  return `trace_${new Date().toISOString().replace(/[:.]/g, "-")}`;
}

export function parseOmaContent(content: string, fileName: string): ParsedOmaDocument {
  const records = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq === -1) return { key: line.toUpperCase(), value: "" };
      return {
        key: line.slice(0, eq).trim().toUpperCase(),
        value: line.slice(eq + 1).trim(),
      };
    });

  const firstValue = (key: string) =>
    records.find((record) => record.key === key)?.value ?? "";

  // Walk records in order, using TRCFMT eye field (index 3: "R" or "L") to
  // assign R= lines to the correct eye.  Some OMA files use two TRCFMT
  // sections (one per eye) where both sections use R= for data.
  const rightParts: string[] = [];
  const leftParts: string[] = [];
  let currentEye: "R" | "L" = "R";
  for (const record of records) {
    if (record.key === "TRCFMT") {
      const eyeField = record.value.split(";")[3];
      currentEye = eyeField === "L" ? "L" : "R";
    } else if (record.key === "R") {
      (currentEye === "L" ? leftParts : rightParts).push(record.value);
    } else if (record.key === "L") {
      leftParts.push(record.value);
    }
  }
  const rightRadiiStr = rightParts.join(";");
  const leftRadiiStr = leftParts.join(";");
  const radiiRecord = rightRadiiStr || leftRadiiStr;

  if (!radiiRecord) {
    throw new Error("The OMA file does not contain an R= or L= trace record.");
  }

  const sourceRadii = parseRadiiRecord(radiiRecord);
  const pointCount = normalizePointCount(
    parseInt(firstValue("TRCFMT").split(";")[1] ?? String(sourceRadii.length), 10),
    sourceRadii.length,
  );
  const radii1000 =
    sourceRadii.length === 1000 ? sourceRadii : resampleClosedRadii(sourceRadii, 1000);
  const radii400 =
    sourceRadii.length === 400 ? sourceRadii : resampleClosedRadii(sourceRadii, 400);
  const stats = summarizeRadii(radii1000);
  const dblMm = parseOptionalNumber(firstValue("DBL")) ?? 0;
  const fcrv = parseOptionalNumber(firstValue("FCRV")) ?? 0;
  const warnings: string[] = [];
  const right = parseMaybeRadii(rightRadiiStr);
  const left = parseMaybeRadii(leftRadiiStr);
  const side = left && !right ? "L" : dblMm > 0 ? "B" : "R";

  if (right && left && !radiiAreMirrored(right, left)) {
    warnings.push(
      "This OMA has independent R/L trace records. The editor currently uses one shape and mirrors it on export.",
    );
  }

  const trace: DecodedNidekTrace = {
    rawFrame: new Uint8Array(),
    cleanFrame: new Uint8Array(),
    radii1000,
    radii400,
    metadata: {
      frameType: dblMm > 0 ? "full" : "partial",
      side,
      encoding: "native",
      fcrv,
      centerDistanceMm: stats.hboxMm + dblMm,
      dblMm,
      byte2Raw: 0,
    },
    stats,
  };

  return {
    fileName,
    jobInfo: {
      job: firstValue("JOB") || stripOmaExtension(fileName) || freshJobName(),
      ven: firstValue("VEN"),
      model: firstValue("MODEL"),
      wrapang: firstValue("WRAPANG"),
      panto: firstValue("PANTO"),
    },
    trace,
    drillRecords: records
      .filter((record) => record.key === "DRILLE")
      .map((record, index) => parseDrillRecord(record.value, index))
      .filter((record): record is DrillRecord => record !== null),
    pointCount,
    warnings,
  };
}

export function buildOmaFiles(
  trace: DecodedNidekTrace,
  jobInfo: OmaJobInfo,
  drillRecords: DrillRecord[] = [],
  dblOverrideMm?: number,
): OmaFile[] {
  return [
    {
      fileName: `${jobInfo.job}.oma`,
      content: buildOmaContent(trace, 400, jobInfo, drillRecords, dblOverrideMm),
      pointCount: 400,
    },
    {
      fileName: `${jobInfo.job}.oma`,
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
  // Slot: fields 6 and 7 are the end coordinates; absent feature type implies
  // the standard hole/slot interpretation.
  return `DRILLE=${[
    r.eye,
    r.reference,
    formatNumber(r.x1, 2),
    formatNumber(r.y1, 2),
    formatNumber(r.diameter, 2),
    formatNumber(r.x2, 2),
    formatNumber(r.y2, 2),
  ].join(";")}`;
}

function parseRadiiRecord(value: string) {
  const radii = value
    .split(";")
    .map((part) => parseInt(part.trim(), 10))
    .filter((n) => Number.isFinite(n));

  if (radii.length < 32) {
    throw new Error(`The OMA trace record has too few points (${radii.length}).`);
  }

  return radii;
}

function parseMaybeRadii(value: string) {
  if (!value) return null;
  try {
    return parseRadiiRecord(value);
  } catch {
    return null;
  }
}

function normalizePointCount(value: number, fallback: number): OmaPointCount {
  if (value === 400 || value === 1000) return value;
  if (fallback === 400 || fallback === 1000) return fallback;
  return fallback < 700 ? 400 : 1000;
}

function parseOptionalNumber(value: string) {
  if (!value) return undefined;
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : undefined;
}

function parseDrillRecord(value: string, index: number): DrillRecord | null {
  const parts = value.split(";").map((part) => part.trim());
  const eye = parts[0] === "R" || parts[0] === "L" || parts[0] === "B" ? parts[0] : "B";
  const reference = parts[1] === "C" ? parts[1] : "C";
  const x1 = parseFloat(parts[2]);
  const y1 = parseFloat(parts[3]);
  const diameter = parseFloat(parts[4]);
  const x2 = parts[5] ? parseFloat(parts[5]) : null;
  const y2 = parts[6] ? parseFloat(parts[6]) : null;

  if (![x1, y1, diameter].every(Number.isFinite)) return null;
  if ((x2 !== null && !Number.isFinite(x2)) || (y2 !== null && !Number.isFinite(y2))) return null;

  return {
    id: `oma-drill-${index}`,
    eye,
    reference,
    x1,
    y1,
    x2,
    y2,
    diameter,
  };
}

function stripOmaExtension(fileName: string) {
  return fileName.replace(/\.[^.]+$/, "").replace(/_(?:400|1000)$/i, "");
}

function radiiAreMirrored(right: number[], left: number[]) {
  if (right.length !== left.length) return false;
  const mirrored = mirrorClosedRadiiHorizontally(right);
  return mirrored.every((radius, index) => Math.abs(radius - left[index]) <= 1);
}
