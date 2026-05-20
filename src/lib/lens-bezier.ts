import { LENS_DESIGN_CONSTANTS } from "@/lib/lens-design-constants";
import type { LensAnchor, LensPath, LensPoint } from "@/lib/lens-design-types";
import { polarRadiiToPoints, roundMm, type TracePoint } from "@/lib/trace-geometry";

export function makeId(prefix: string) {
  const uuid =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${uuid}`;
}

export function pathToSvg(path: LensPath) {
  if (path.anchors.length === 0) return "";
  const [first, ...rest] = path.anchors;
  const parts = [`M ${first.point.x} ${-first.point.y}`];
  let prev = first;
  for (const anchor of rest) {
    const c1 = prev.outHandle ?? prev.point;
    const c2 = anchor.inHandle ?? anchor.point;
    parts.push(`C ${c1.x} ${-c1.y} ${c2.x} ${-c2.y} ${anchor.point.x} ${-anchor.point.y}`);
    prev = anchor;
  }
  const c1 = prev.outHandle ?? prev.point;
  const c2 = first.inHandle ?? first.point;
  parts.push(`C ${c1.x} ${-c1.y} ${c2.x} ${-c2.y} ${first.point.x} ${-first.point.y} Z`);
  return parts.join(" ");
}

export function radiiToEditablePath(radii: number[], id = makeId("path")): LensPath {
  const points = polarRadiiToPoints(radii);
  const count = Math.min(LENS_DESIGN_CONSTANTS.omaImportAnchorCount, points.length);
  const step = points.length / count;
  const sampled = Array.from({ length: count }, (_, i) => points[Math.round(i * step) % points.length]);
  return pointsToSmoothPath(sampled, id);
}

export function pointsToSmoothPath(points: TracePoint[], id = makeId("path")): LensPath {
  const anchors: LensAnchor[] = points.map((point, index) => {
    const prev = points[(index - 1 + points.length) % points.length];
    const next = points[(index + 1) % points.length];
    const tension = 1 / 6;
    return {
      id: makeId("anchor"),
      point: { x: roundMm(point.x), y: roundMm(point.y) },
      inHandle: {
        x: roundMm(point.x - (next.x - prev.x) * tension),
        y: roundMm(point.y - (next.y - prev.y) * tension),
      },
      outHandle: {
        x: roundMm(point.x + (next.x - prev.x) * tension),
        y: roundMm(point.y + (next.y - prev.y) * tension),
      },
      kind: "smooth",
    };
  });
  return { id, anchors, closed: true };
}

export function starterPath(kind: "round" | "panto" | "soft-rectangle" | "aviator" | "cat-eye" = "panto") {
  const shapes: Record<typeof kind, TracePoint[]> = {
    round: ellipsePoints(25, 22, 12),
    panto: [
      { x: 0, y: 23 }, { x: 20, y: 18 }, { x: 26, y: 0 }, { x: 14, y: -20 },
      { x: -8, y: -22 }, { x: -24, y: -8 }, { x: -21, y: 14 },
    ],
    "soft-rectangle": [
      { x: -26, y: 15 }, { x: 0, y: 18 }, { x: 26, y: 15 }, { x: 28, y: 0 },
      { x: 24, y: -15 }, { x: 0, y: -18 }, { x: -24, y: -15 }, { x: -28, y: 0 },
    ],
    aviator: [
      { x: -23, y: 14 }, { x: 0, y: 20 }, { x: 24, y: 12 }, { x: 23, y: -12 },
      { x: 9, y: -25 }, { x: -13, y: -24 }, { x: -27, y: -6 },
    ],
    "cat-eye": [
      { x: -27, y: 10 }, { x: -8, y: 20 }, { x: 24, y: 18 }, { x: 28, y: 4 },
      { x: 18, y: -16 }, { x: -8, y: -21 }, { x: -25, y: -8 },
    ],
  };
  return pointsToSmoothPath(shapes[kind], makeId("path"));
}

function ellipsePoints(rx: number, ry: number, count: number) {
  return Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * Math.PI * 2;
    return { x: rx * Math.cos(angle), y: ry * Math.sin(angle) };
  });
}

export function clonePath(path: LensPath): LensPath {
  return JSON.parse(JSON.stringify(path)) as LensPath;
}

export function transformPath(
  path: LensPath,
  transform: { dx?: number; dy?: number; sx?: number; sy?: number; origin?: LensPoint },
) {
  const dx = transform.dx ?? 0;
  const dy = transform.dy ?? 0;
  const sx = transform.sx ?? 1;
  const sy = transform.sy ?? 1;
  const origin = transform.origin ?? { x: 0, y: 0 };
  const tx = (p: LensPoint): LensPoint => ({
    x: roundMm(origin.x + (p.x - origin.x) * sx + dx),
    y: roundMm(origin.y + (p.y - origin.y) * sy + dy),
  });
  return {
    ...path,
    anchors: path.anchors.map((anchor) => ({
      ...anchor,
      point: tx(anchor.point),
      inHandle: anchor.inHandle ? tx(anchor.inHandle) : null,
      outHandle: anchor.outHandle ? tx(anchor.outHandle) : null,
    })),
  };
}

export function pathBounds(path: LensPath) {
  const pts = path.anchors.map((a) => a.point);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export function flattenPath(path: LensPath, tolerance = LENS_DESIGN_CONSTANTS.bezierFlatteningToleranceMm) {
  const out: LensPoint[] = [];
  forEachCubic(path, (p0, p1, p2, p3) => {
    const segment = flattenCubic(p0, p1, p2, p3, tolerance);
    if (out.length === 0) out.push(segment[0]);
    out.push(...segment.slice(1));
  });
  return out;
}

export function forEachCubic(path: LensPath, cb: (p0: LensPoint, p1: LensPoint, p2: LensPoint, p3: LensPoint, index: number) => void) {
  path.anchors.forEach((anchor, index) => {
    const next = path.anchors[(index + 1) % path.anchors.length];
    cb(anchor.point, anchor.outHandle ?? anchor.point, next.inHandle ?? next.point, next.point, index);
  });
}

function flattenCubic(p0: LensPoint, p1: LensPoint, p2: LensPoint, p3: LensPoint, tolerance: number): LensPoint[] {
  const flat = Math.max(distanceToLine(p1, p0, p3), distanceToLine(p2, p0, p3)) <= tolerance;
  if (flat) return [p0, p3];
  const [left, right] = splitCubic(p0, p1, p2, p3, 0.5);
  return [...flattenCubic(...left, tolerance).slice(0, -1), ...flattenCubic(...right, tolerance)];
}

export function splitCubic(p0: LensPoint, p1: LensPoint, p2: LensPoint, p3: LensPoint, t: number): [[LensPoint, LensPoint, LensPoint, LensPoint], [LensPoint, LensPoint, LensPoint, LensPoint]] {
  const p01 = lerpPoint(p0, p1, t);
  const p12 = lerpPoint(p1, p2, t);
  const p23 = lerpPoint(p2, p3, t);
  const p012 = lerpPoint(p01, p12, t);
  const p123 = lerpPoint(p12, p23, t);
  const p0123 = lerpPoint(p012, p123, t);
  return [[p0, p01, p012, p0123], [p0123, p123, p23, p3]];
}

function lerpPoint(a: LensPoint, b: LensPoint, t: number) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function distanceToLine(p: LensPoint, a: LensPoint, b: LensPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

export function pointInPolygon(point: LensPoint, polygon: LensPoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const pi = polygon[i];
    const pj = polygon[j];
    const intersect = pi.y > point.y !== pj.y > point.y && point.x < ((pj.x - pi.x) * (point.y - pi.y)) / (pj.y - pi.y) + pi.x;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function minDistancePointToPolyline(point: LensPoint, polyline: LensPoint[]) {
  let best = Infinity;
  for (let i = 0; i < polyline.length; i += 1) {
    const a = polyline[i];
    const b = polyline[(i + 1) % polyline.length];
    best = Math.min(best, distanceToSegment(point, a, b));
  }
  return best;
}

export function distanceToSegment(point: LensPoint, a: LensPoint, b: LensPoint) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / len2));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}
