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

export function roundMm(value: number) {
  return Math.round(value * 100) / 100;
}

export function formatNumber(value: number, decimals = 2) {
  return value.toFixed(decimals).replace(/\.?0+$/, "");
}
