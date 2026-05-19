import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { polarRadiiToPoints } from "@/lib/trace-geometry";

export interface TwoLensPaths {
  r: string;
  l: string;
  dblX1: number;
  dblX2: number;
  scale: number;
  rCenterX: number;
  lCenterX: number;
}

export function buildTwoLensPaths(trace: DecodedNidekTrace): TwoLensPaths {
  const rPoints = polarRadiiToPoints(trace.radii400);
  const hboxMm = trace.stats.hboxMm;
  const dblMm = trace.metadata.dblMm;
  const vboxMm = trace.stats.vboxMm;

  const totalWidthMm = 2 * hboxMm + dblMm;
  const scale = Math.min(560 / totalWidthMm, 340 / vboxMm);

  // Render as a front-facing frame view: the wearer's right lens is on the
  // viewer's left, matching OMA lab renderers such as Reize.
  const rCenterX = 320 - (dblMm / 2 + hboxMm / 2) * scale;
  const lCenterX = 320 + (dblMm / 2 + hboxMm / 2) * scale;

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
