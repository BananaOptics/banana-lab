import { describe, expect, it } from "vitest";
import type { DecodedNidekTrace } from "@/lib/nidek-native";
import { buildTwoLensPaths } from "@/lib/trace-rendering";
import { summarizeRadii } from "@/lib/trace-geometry";

const asymmetricRadii = [3000, 2200, 2600, 2100, 1800, 2400, 2700, 2300];

describe("buildTwoLensPaths", () => {
  it("renders wearer right on viewer left and wearer left on viewer right", () => {
    const paths = buildTwoLensPaths(fakeTrace());

    expect(paths.rCenterX).toBeLessThan(paths.lCenterX);
  });

  it("renders right raw and left horizontally mirrored", () => {
    const paths = buildTwoLensPaths(fakeTrace());
    const radiusMm = asymmetricRadii[0] / 100;

    expect(firstMove(paths.r)).toEqual({
      x: round2(paths.rCenterX + radiusMm * paths.scale),
      y: 240,
    });
    expect(firstMove(paths.l)).toEqual({
      x: round2(paths.lCenterX - radiusMm * paths.scale),
      y: 240,
    });
  });
});

function fakeTrace(): DecodedNidekTrace {
  const stats = summarizeRadii(asymmetricRadii);

  return {
    rawFrame: new Uint8Array(),
    cleanFrame: new Uint8Array(),
    radii1000: asymmetricRadii,
    radii400: asymmetricRadii,
    metadata: {
      frameType: "partial",
      side: "R",
      encoding: "native",
      fcrv: 4,
      centerDistanceMm: stats.hboxMm + 18,
      dblMm: 18,
      byte2Raw: 0,
    },
    stats,
  };
}

function firstMove(path: string) {
  const match = /^M (-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/.exec(path);
  if (!match) throw new Error(`Path does not start with an M command: ${path}`);

  return {
    x: Number(match[1]),
    y: Number(match[2]),
  };
}

function round2(value: number) {
  return Number(value.toFixed(2));
}
