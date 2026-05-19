import { describe, expect, it } from "vitest";
import type { DecodedNidekTrace, NidekSide } from "@/lib/nidek-native";
import { buildOmaContent, parseOmaContent, type OmaJobInfo } from "@/lib/oma";
import { mirrorClosedRadiiHorizontally, summarizeRadii } from "@/lib/trace-geometry";

const asymmetricRadii = [3000, 2200, 2600, 2100, 1800, 2400, 2700, 2300];

const jobInfo: OmaJobInfo = {
  job: "regression",
  ven: "",
  model: "",
  wrapang: "",
  panto: "",
};

describe("buildOmaContent", () => {
  it("exports a right-eye source as raw R and mirrored L", () => {
    const oma = buildOmaContent(fakeTrace("R"), 400, jobInfo, [], 18);

    expect(readRadiiRecord(oma, "R")).toEqual(asymmetricRadii);
    expect(readRadiiRecord(oma, "L")).toEqual(
      mirrorClosedRadiiHorizontally(asymmetricRadii),
    );
    expect(oma).toContain("TRCFMT=1;400;E;R;B");
  });

  it("exports a left-eye source as mirrored R and raw L", () => {
    const oma = buildOmaContent(fakeTrace("L"), 400, jobInfo, [], 18);

    expect(readRadiiRecord(oma, "R")).toEqual(
      mirrorClosedRadiiHorizontally(asymmetricRadii),
    );
    expect(readRadiiRecord(oma, "L")).toEqual(asymmetricRadii);
    expect(oma).toContain("TRCFMT=1;400;E;R;B");
  });

  it("exports slots as DRILLE records with start and end coordinates", () => {
    const oma = buildOmaContent(
      fakeTrace("R"),
      400,
      jobInfo,
      [
        {
          id: "slot-1",
          eye: "B",
          reference: "C",
          x1: -17,
          y1: 10.32,
          x2: -15,
          y2: 10.32,
          diameter: 2.3,
        },
      ],
      18,
    );

    expect(oma).toContain("DRILLE=B;C;-17;10.32;2.3;-15;10.32");
    expect(oma).not.toContain("DRILLES=");
  });
});

describe("parseOmaContent", () => {
  it("loads OMA metadata, radii, and drill records into an editable trace document", () => {
    const radii = Array.from({ length: 400 }, (_, index) => 2200 + (index % 17));
    const oma = [
      "JOB=loaded-job",
      "REQ=TRC",
      "VEN=Acme",
      "MODEL=Round",
      "DBL=18.00",
      "FCRV=4.2",
      "WRAPANG=5.0",
      "PANTO=8.0",
      "TRCFMT=1;400;E;R;B",
      `R=${radii.join(";")}`,
      `L=${mirrorClosedRadiiHorizontally(radii).join(";")}`,
      "DRILLE=B;C;1.25;2.5;1.8",
      "",
    ].join("\r\n");

    const parsed = parseOmaContent(oma, "loaded.oma");

    expect(parsed.jobInfo).toEqual({
      job: "loaded-job",
      ven: "Acme",
      model: "Round",
      wrapang: "5.0",
      panto: "8.0",
    });
    expect(parsed.pointCount).toBe(400);
    expect(parsed.trace.radii400).toEqual(radii);
    expect(parsed.trace.radii1000).toHaveLength(1000);
    expect(parsed.trace.metadata.dblMm).toBe(18);
    expect(parsed.drillRecords).toHaveLength(1);
    expect(parsed.drillRecords[0]).toMatchObject({
      eye: "B",
      reference: "C",
      x1: 1.25,
      y1: 2.5,
      diameter: 1.8,
    });
    expect(parsed.warnings).toEqual([]);
  });
});

function fakeTrace(side: NidekSide): DecodedNidekTrace {
  const stats = summarizeRadii(asymmetricRadii);

  return {
    rawFrame: new Uint8Array(),
    cleanFrame: new Uint8Array(),
    radii1000: asymmetricRadii,
    radii400: asymmetricRadii,
    metadata: {
      frameType: "partial",
      side,
      encoding: "native",
      fcrv: 4,
      centerDistanceMm: stats.hboxMm + 18,
      dblMm: 0,
      byte2Raw: 0,
    },
    stats,
  };
}

function readRadiiRecord(oma: string, eye: "R" | "L") {
  const line = oma
    .split(/\r?\n/)
    .find((candidate) => candidate.startsWith(`${eye}=`));

  if (!line) throw new Error(`Missing ${eye}= record`);
  return line.slice(2).split(";").map(Number);
}
