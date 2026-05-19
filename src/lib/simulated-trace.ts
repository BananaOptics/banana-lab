import type { DecodedNidekTrace, NidekMetadata } from "@/lib/nidek-native";
import { resampleClosedRadii, summarizeRadii } from "@/lib/trace-geometry";

export function buildSimulatedNidekTrace(): DecodedNidekTrace {
  const radii1000 = buildSimulatedRadii();
  const radii400 = resampleClosedRadii(radii1000, 400);
  const stats = summarizeRadii(radii1000);
  const metadata: NidekMetadata = {
    frameType: "full",
    side: "R",
    encoding: "native",
    fcrv: 4.2,
    centerDistanceMm: stats.hboxMm + 18,
    dblMm: 18,
    byte2Raw: 0,
  };

  return {
    rawFrame: new Uint8Array(),
    cleanFrame: new Uint8Array(),
    radii1000,
    radii400,
    metadata,
    stats,
  };
}

function buildSimulatedRadii() {
  const pointCount = 1000;
  const halfWidth = 26.5;
  const halfHeight = 18.7;

  return Array.from({ length: pointCount }, (_, index) => {
    const angle = (index / pointCount) * Math.PI * 2;
    const ellipseRadius =
      (halfWidth * halfHeight) /
      Math.sqrt(
        Math.pow(halfHeight * Math.cos(angle), 2) +
          Math.pow(halfWidth * Math.sin(angle), 2),
      );
    const nasalRelief = -1.1 * Math.exp(-Math.pow(angle - Math.PI, 2) / 0.22);
    const browLift = 0.8 * Math.sin(angle + 0.35);
    const lowerSoftening = -0.45 * Math.cos(2 * angle - 0.8);
    const radiusMm = ellipseRadius + nasalRelief + browLift + lowerSoftening;

    return Math.round(radiusMm * 100);
  });
}
