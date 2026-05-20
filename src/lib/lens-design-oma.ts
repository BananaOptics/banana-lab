import { LENS_DESIGN_CONSTANTS } from "@/lib/lens-design-constants";
import {
  distanceToSegment,
  flattenPath,
  minDistancePointToPolyline,
  pathBounds,
  pointInPolygon,
} from "@/lib/lens-bezier";
import type { LensDesignDocument, LensPath, LensPoint } from "@/lib/lens-design-types";
import type { DrillRecord, OmaFile, OmaPointCount } from "@/lib/oma";
import { formatNumber, mirrorClosedRadiiHorizontally, roundMm, summarizeRadii } from "@/lib/trace-geometry";

export interface DesignerOmaResult {
  files: OmaFile[];
  preview: {
    pointCount: OmaPointCount;
    radii: number[];
    leftRadii: number[];
    hboxMm: number;
    vboxMm: number;
    circMm: number;
  };
  warnings: DesignWarning[];
}

export interface DesignWarning {
  id: string;
  severity: "warning" | "error";
  message: string;
}

export function buildDesignerOma(doc: LensDesignDocument, previewPointCount: OmaPointCount = 400): DesignerOmaResult {
  const warnings = validateDesign(doc);
  const radii400 = pathToRadii(doc.rightPath, 400, warnings);
  const radii1000 = pathToRadii(doc.rightPath, 1000, warnings);
  const previewRadii = previewPointCount === 400 ? radii400 : radii1000;
  const stats = summarizeRadii(previewRadii);
  return {
    files: [
      { fileName: `${cleanJob(doc.jobInfo.job)}.oma`, pointCount: 400, content: buildOmaContentFromRadii(doc, radii400, 400) },
      { fileName: `${cleanJob(doc.jobInfo.job)}.oma`, pointCount: 1000, content: buildOmaContentFromRadii(doc, radii1000, 1000) },
    ],
    preview: {
      pointCount: previewPointCount,
      radii: previewRadii,
      leftRadii: mirrorClosedRadiiHorizontally(previewRadii),
      hboxMm: stats.hboxMm,
      vboxMm: stats.vboxMm,
      circMm: stats.circMm,
    },
    warnings: dedupeWarnings(warnings),
  };
}

export function pathToRadii(path: LensPath, count: OmaPointCount, warnings: DesignWarning[] = []) {
  const polyline = flattenPath(path);
  const center = pathBounds(path);
  const radii: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2;
    const dir = { x: Math.cos(angle), y: Math.sin(angle) };
    const intersections: number[] = [];
    for (let j = 0; j < polyline.length; j += 1) {
      const a = polyline[j];
      const b = polyline[(j + 1) % polyline.length];
      const t = raySegmentIntersection({ x: center.cx, y: center.cy }, dir, a, b);
      if (t !== null && t >= 0) intersections.push(t);
    }
    if (intersections.length > 1) {
      warnings.push({
        id: "polar-multiple-intersections",
        severity: "warning",
        message: "The shape has angles with multiple edge intersections; standard polar OMA may not match the visual shape exactly.",
      });
    }
    const radiusMm = Math.max(0, ...(intersections.length ? intersections : [0]));
    radii.push(Math.round(radiusMm * 100));
  }
  return radii;
}

function raySegmentIntersection(origin: LensPoint, dir: LensPoint, a: LensPoint, b: LensPoint) {
  const sx = b.x - a.x;
  const sy = b.y - a.y;
  const denom = cross(dir.x, dir.y, sx, sy);
  if (Math.abs(denom) < 1e-9) return null;
  const qpx = a.x - origin.x;
  const qpy = a.y - origin.y;
  const t = cross(qpx, qpy, sx, sy) / denom;
  const u = cross(qpx, qpy, dir.x, dir.y) / denom;
  if (t >= -1e-9 && u >= -1e-9 && u <= 1 + 1e-9) return t;
  return null;
}

function cross(ax: number, ay: number, bx: number, by: number) {
  return ax * by - ay * bx;
}

function buildOmaContentFromRadii(doc: LensDesignDocument, radii: number[], pointCount: OmaPointCount) {
  const stats = summarizeRadii(radii);
  const wrapang = parseFloat(doc.jobInfo.wrapang);
  const panto = parseFloat(doc.jobInfo.panto);
  const lines = [
    `JOB=${cleanJob(doc.jobInfo.job)}`,
    "REQ=TRC",
    ...(doc.jobInfo.ven ? [`VEN=${doc.jobInfo.ven}`] : []),
    ...(doc.jobInfo.model ? [`MODEL=${doc.jobInfo.model}`] : []),
    `HBOX=${formatNumber(stats.hboxMm, 2)}`,
    `VBOX=${formatNumber(stats.vboxMm, 2)}`,
    `DBL=${formatNumber(doc.dblMm, 2)}`,
    `CIRC=${formatNumber(stats.circMm, 2)}`,
    "FCRV=0",
    ...(!Number.isNaN(wrapang) ? [`WRAPANG=${formatNumber(wrapang, 1)}`] : []),
    ...(!Number.isNaN(panto) ? [`PANTO=${formatNumber(panto, 1)}`] : []),
    `TRCFMT=1;${pointCount};E;R;B`,
    `R=${radii.join(";")}`,
    `L=${mirrorClosedRadiiHorizontally(radii).join(";")}`,
    ...doc.drills.map(formatDrillRecord),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

function formatDrillRecord(r: DrillRecord): string {
  const base = [r.eye, r.reference, formatNumber(r.x1, 2), formatNumber(r.y1, 2), formatNumber(r.diameter, 2)];
  if (r.x2 !== null && r.y2 !== null) base.push(formatNumber(r.x2, 2), formatNumber(r.y2, 2));
  return `DRILLE=${base.join(";")}`;
}

function cleanJob(job: string) {
  return (job || "lens_design").replace(/(?:_(?:400|1000))?\.oma$/i, "") || "lens_design";
}

export function validateDesign(doc: LensDesignDocument): DesignWarning[] {
  const warnings: DesignWarning[] = [];
  const polyline = flattenPath(doc.rightPath, 0.15);
  const bounds = pathBounds(doc.rightPath);

  if (bounds.width < LENS_DESIGN_CONSTANTS.hboxMinMm || bounds.width > LENS_DESIGN_CONSTANTS.hboxMaxMm) {
    warnings.push({ id: "hbox-range", severity: "warning", message: `HBOX ${formatNumber(bounds.width, 1)} mm is outside the broad expected range.` });
  }
  if (bounds.height < LENS_DESIGN_CONSTANTS.vboxMinMm || bounds.height > LENS_DESIGN_CONSTANTS.vboxMaxMm) {
    warnings.push({ id: "vbox-range", severity: "warning", message: `VBOX ${formatNumber(bounds.height, 1)} mm is outside the broad expected range.` });
  }
  if (hasSelfIntersection(polyline)) {
    warnings.push({ id: "self-intersection", severity: "warning", message: "Lens path self-intersects." });
  }
  validateDrills(doc.drills, polyline, warnings);
  validateBlankFit(doc, polyline, bounds, warnings);
  validateShapeKinks(polyline, warnings);
  return dedupeWarnings(warnings);
}

function validateDrills(records: DrillRecord[], polyline: LensPoint[], warnings: DesignWarning[]) {
  records.forEach((record) => {
    const p1 = { x: record.x1, y: record.y1 };
    if (!pointInPolygon(p1, polyline)) {
      warnings.push({ id: `drill-outside-${record.id}`, severity: "warning", message: `Drill feature ${record.id} start center is outside the lens.` });
    }
    if (record.x2 !== null && record.y2 !== null && !pointInPolygon({ x: record.x2, y: record.y2 }, polyline)) {
      warnings.push({ id: `slot-end-outside-${record.id}`, severity: "warning", message: `Slot ${record.id} end center is outside the lens.` });
    }
    const clearance = minDistanceFeatureToEdge(record, polyline) - record.diameter / 2;
    if (clearance < LENS_DESIGN_CONSTANTS.drillEdgeMarginMm) {
      warnings.push({ id: `drill-clearance-${record.id}`, severity: "warning", message: `Drill feature ${record.id} has ${formatNumber(clearance, 2)} mm edge clearance.` });
    }
  });

  for (let i = 0; i < records.length; i += 1) {
    for (let j = i + 1; j < records.length; j += 1) {
      const gap = featureDistance(records[i], records[j]) - records[i].diameter / 2 - records[j].diameter / 2;
      if (gap < LENS_DESIGN_CONSTANTS.drillFeatureSpacingMm) {
        warnings.push({ id: `drill-spacing-${records[i].id}-${records[j].id}`, severity: "warning", message: `Drill features ${records[i].id} and ${records[j].id} are close together.` });
      }
    }
  }
}

function minDistanceFeatureToEdge(record: DrillRecord, polyline: LensPoint[]) {
  if (record.x2 === null || record.y2 === null) {
    return minDistancePointToPolyline({ x: record.x1, y: record.y1 }, polyline);
  }
  let best = Infinity;
  const steps = 12;
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    best = Math.min(best, minDistancePointToPolyline({ x: record.x1 + (record.x2 - record.x1) * t, y: record.y1 + (record.y2 - record.y1) * t }, polyline));
  }
  return best;
}

function featureDistance(a: DrillRecord, b: DrillRecord) {
  const a1 = { x: a.x1, y: a.y1 };
  const a2 = a.x2 !== null && a.y2 !== null ? { x: a.x2, y: a.y2 } : a1;
  const b1 = { x: b.x1, y: b.y1 };
  const b2 = b.x2 !== null && b.y2 !== null ? { x: b.x2, y: b.y2 } : b1;
  if (a1 === a2 && b1 === b2) return Math.hypot(a.x1 - b.x1, a.y1 - b.y1);
  return Math.min(distanceToSegment(a1, b1, b2), distanceToSegment(a2, b1, b2), distanceToSegment(b1, a1, a2), distanceToSegment(b2, a1, a2));
}

function validateBlankFit(doc: LensDesignDocument, polyline: LensPoint[], bounds: ReturnType<typeof pathBounds>, warnings: DesignWarning[]) {
  if (!doc.blanks.visible) return;
  const framePd = bounds.width + doc.dblMm;
  const decentration = (framePd - doc.blanks.binocularPdMm) / 2;
  const radius = doc.blanks.diameterMm / 2;
  const center = { x: bounds.cx - decentration, y: bounds.cy };
  const outside = polyline.some((p) => Math.hypot(p.x - center.x, p.y - center.y) > radius + 0.001);
  if (outside) {
    warnings.push({ id: "blank-fit", severity: "warning", message: "Lens outline does not fit inside the configured uncut blank." });
  }
}

function validateShapeKinks(polyline: LensPoint[], warnings: DesignWarning[]) {
  for (let i = 0; i < polyline.length; i += 1) {
    const a = polyline[(i - 2 + polyline.length) % polyline.length];
    const b = polyline[i];
    const c = polyline[(i + 2) % polyline.length];
    const ab = Math.hypot(b.x - a.x, b.y - a.y);
    const bc = Math.hypot(c.x - b.x, c.y - b.y);
    if (ab < 0.1 || bc < 0.1) continue;
    const dot = ((a.x - b.x) * (c.x - b.x) + (a.y - b.y) * (c.y - b.y)) / (ab * bc);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
    if (angle < 180 - LENS_DESIGN_CONSTANTS.sharpSpikeAngleDeg) {
      warnings.push({ id: "sharp-spike", severity: "warning", message: "Lens outline has a sharp local direction change." });
      return;
    }
  }
}

function hasSelfIntersection(polyline: LensPoint[]) {
  for (let i = 0; i < polyline.length; i += 1) {
    const a1 = polyline[i];
    const a2 = polyline[(i + 1) % polyline.length];
    for (let j = i + 2; j < polyline.length; j += 1) {
      if (j === i || (j + 1) % polyline.length === i) continue;
      const b1 = polyline[j];
      const b2 = polyline[(j + 1) % polyline.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

function segmentsIntersect(a: LensPoint, b: LensPoint, c: LensPoint, d: LensPoint) {
  const ccw = (p1: LensPoint, p2: LensPoint, p3: LensPoint) => (p3.y - p1.y) * (p2.x - p1.x) > (p2.y - p1.y) * (p3.x - p1.x);
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

function dedupeWarnings(warnings: DesignWarning[]) {
  return Array.from(new Map(warnings.map((warning) => [warning.id, warning])).values());
}
