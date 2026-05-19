export interface TracePoint {
  x: number;
  y: number;
}

export interface TraceStats {
  pointCount: number;
  minRadius: number;
  maxRadius: number;
  hboxMm: number;
  vboxMm: number;
  circMm: number;
  maxAdjacentStep: number;
  points: TracePoint[];
}

export function polarRadiiToPoints(radii: number[]): TracePoint[] {
  return radii.map((radius, index) => {
    const angle = (index / radii.length) * Math.PI * 2;
    return {
      x: (radius / 100) * Math.cos(angle),
      y: (radius / 100) * Math.sin(angle),
    };
  });
}

export function summarizeRadii(radii: number[]): TraceStats {
  const points = polarRadiiToPoints(radii);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  let circMm = 0;
  let maxAdjacentStep = 0;

  for (let index = 0; index < points.length; index += 1) {
    const currentPoint = points[index];
    const nextPoint = points[(index + 1) % points.length];
    circMm += Math.hypot(currentPoint.x - nextPoint.x, currentPoint.y - nextPoint.y);

    const currentRadius = radii[index];
    const nextRadius = radii[(index + 1) % radii.length];
    maxAdjacentStep = Math.max(maxAdjacentStep, Math.abs(currentRadius - nextRadius));
  }

  return {
    pointCount: radii.length,
    minRadius: Math.min(...radii),
    maxRadius: Math.max(...radii),
    hboxMm: roundMm(Math.max(...xs) - Math.min(...xs)),
    vboxMm: roundMm(Math.max(...ys) - Math.min(...ys)),
    circMm: roundMm(circMm),
    maxAdjacentStep,
    points,
  };
}

export function resampleClosedRadii(radii: number[], targetPoints: number) {
  const out: number[] = [];
  const scale = radii.length / targetPoints;

  for (let index = 0; index < targetPoints; index += 1) {
    const position = index * scale;
    const left = Math.floor(position) % radii.length;
    const right = (left + 1) % radii.length;
    const t = position - Math.floor(position);
    out.push(Math.round(radii[left] * (1 - t) + radii[right] * t));
  }

  return out;
}

export function mirrorClosedRadiiHorizontally(radii: number[]) {
  const halfTurn = radii.length / 2;

  return radii.map((_, index) => radii[(halfTurn - index + radii.length) % radii.length]);
}

export function boxCenter(points: TracePoint[]) {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);

  return {
    x: (Math.min(...xs) + Math.max(...xs)) / 2,
    y: (Math.min(...ys) + Math.max(...ys)) / 2,
  };
}

export function pointIsInsideClosedTrace(point: TracePoint, tracePoints: TracePoint[]) {
  if (tracePoints.length < 3) return false;

  const center = boxCenter(tracePoints);
  let inside = false;

  for (let current = 0, previous = tracePoints.length - 1; current < tracePoints.length; previous = current, current += 1) {
    const currentPoint = {
      x: tracePoints[current].x - center.x,
      y: tracePoints[current].y - center.y,
    };
    const previousPoint = {
      x: tracePoints[previous].x - center.x,
      y: tracePoints[previous].y - center.y,
    };
    const crossesY = currentPoint.y > point.y !== previousPoint.y > point.y;

    if (crossesY) {
      const intersectionX =
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
        currentPoint.x;

      if (point.x < intersectionX) inside = !inside;
    }
  }

  return inside;
}

export function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatNumber(value: number, decimals = 2) {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}
